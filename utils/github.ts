// GitHub adapter: github.com only, one token.
import type { Adapter, PR, Settings } from './shared';

// Matches the PR page and any sub-page (/files, /commits, ?w=1, #discussion…), so a tab
// you navigated within the PR still counts as that PR's tab.
const PR_URL_RE = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)(?:[/?#]|$)/i;

export function githubAdapter(settings: Settings): Adapter {
  return {
    name: 'GitHub',
    urlPatterns: ['https://github.com/*/*/pull/*'],
    keyFromUrl(url) {
      const m = url?.match(PR_URL_RE);
      return m ? `${m[1]}/${m[2]}#${m[3]}`.toLowerCase() : null;
    },
    async fetch() {
      const [prs, blockedOrgs] = await Promise.all([fetchMyPRs(settings), findBlockedOrgs(settings.token)]);
      return { prs, blockedOrgs };
    },
  };
}

const API = 'https://api.github.com';

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function errorMessage(res: Response) {
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401) return 'GitHub rejected the token. Check it in settings.';
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    return 'GitHub rate limit reached. Syncing resumes on its own.';
  }
  if (res.status === 422) return `GitHub couldn't run the search. Check the extra filter in settings. ${detail}`.trim();
  return `GitHub returned ${res.status}${detail ? `: ${detail}` : '.'}`;
}

async function get<T>(path: string, token: string): Promise<T> {
  let res;
  try {
    res = await fetch(`${API}${path}`, { headers: headers(token), cache: 'no-store' });
  } catch {
    throw new Error("Couldn't reach GitHub. Check your connection.");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function getViewer(token: string) {
  return get<{ login: string }>('/user', token);
}

// OAuth App client id (public, not a secret). Register one at github.com/settings/applications/new
// with "Enable Device Flow" ticked; the callback URL is unused, any https URL works.
export const GITHUB_CLIENT_ID = 'Ov23liVLiijXdAEIQ0lI';

// Fields GitHub's OAuth endpoints can answer with, success and error alike.
interface OAuthResponse {
  error?: string;
  error_description?: string;
  interval: number;
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  access_token?: string;
}

async function postForm(url: string, body: Record<string, string>): Promise<OAuthResponse> {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new Error("Couldn't reach GitHub. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as OAuthResponse;
  if (!res.ok) throw new Error(data.error_description ?? `GitHub returned ${res.status}.`);
  return data;
}

// Device flow: GitHub shows a code, you approve it on github.com in the session you're already
// signed in to, and we poll until the token arrives. onCode gets { user_code, verification_uri }.
export async function deviceLogin(onCode: (start: OAuthResponse) => void): Promise<string> {
  const start = await postForm('https://github.com/login/device/code', {
    client_id: GITHUB_CLIENT_ID,
    scope: 'repo read:org',
  });
  if (start.error) throw new Error(start.error_description ?? start.error);
  onCode(start);

  let interval = start.interval * 1000;
  const deadline = Date.now() + start.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await postForm('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      device_code: start.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (res.access_token) return res.access_token;
    if (res.error === 'slow_down') interval = res.interval * 1000;
    else if (res.error !== 'authorization_pending') throw new Error(res.error_description ?? res.error);
  }
  throw new Error('The sign-in code expired. Try again.');
}

// Search silently drops repos from orgs that block this OAuth app, so ask each org directly:
// a blocked org answers 403 ("...has enabled OAuth App access restrictions...").
async function findBlockedOrgs(token: string) {
  let orgs: { organization: { login: string } }[];
  try {
    orgs = await get('/user/memberships/orgs?state=active&per_page=100', token);
  } catch {
    return []; // needs read:org; pasted tokens and pre-read:org sign-ins just skip the check
  }
  const blocked: string[] = [];
  await Promise.all(
    orgs.map(async ({ organization: { login } }) => {
      const res = await fetch(`${API}/user/memberships/orgs/${login}`, {
        headers: headers(token),
        cache: 'no-store',
      }).catch(() => null);
      if (res?.status === 403) blocked.push(login);
    }),
  );
  return blocked.toSorted();
}

// One search query covers every repo the token can see, which is why we use
// the search API instead of walking repos. GitHub caps search at 1000 results.
interface SearchResponse {
  total_count: number;
  items: {
    repository_url: string;
    number: number;
    html_url: string;
    title: string;
    draft?: boolean;
    created_at: string;
  }[];
}

async function fetchMyPRs({ token, includeDrafts, extraQuery }: Settings) {
  const terms = ['is:pr', 'is:open', 'author:@me', 'archived:false'];
  if (!includeDrafts) terms.push('draft:false');
  if (extraQuery?.trim()) terms.push(extraQuery.trim());
  const q = encodeURIComponent(terms.join(' '));

  const prs: PR[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await get<SearchResponse>(
      `/search/issues?q=${q}&sort=created&order=asc&per_page=100&page=${page}`,
      token,
    );
    for (const item of data.items) {
      const [owner, repo] = item.repository_url.split('/').slice(-2);
      prs.push({
        key: `${owner}/${repo}#${item.number}`.toLowerCase(),
        url: item.html_url,
        number: item.number,
        ref: `#${item.number}`,
        title: item.title,
        repo: `${owner}/${repo}`,
        draft: Boolean(item.draft),
        createdAt: item.created_at,
      });
    }
    if (data.items.length < 100 || prs.length >= data.total_count) break;
  }
  return prs;
}
