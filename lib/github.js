// GitHub adapter: github.com only, one token. See adapters() in shared.js for the adapter shape.

// Matches the PR page and any sub-page (/files, /commits, ?w=1, #discussion…), so a tab
// you navigated within the PR still counts as that PR's tab.
const PR_URL_RE = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)(?:[/?#]|$)/i;

export function githubAdapter(settings) {
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

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function errorMessage(res) {
  let detail = '';
  try { detail = (await res.json()).message ?? ''; } catch { /* non-JSON body */ }
  if (res.status === 401) return 'GitHub rejected the token. Check it in settings.';
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    return 'GitHub rate limit reached. Syncing resumes on its own.';
  }
  if (res.status === 422) return `GitHub couldn't run the search. Check the extra filter in settings. ${detail}`.trim();
  return `GitHub returned ${res.status}${detail ? `: ${detail}` : '.'}`;
}

async function get(path, token) {
  let res;
  try {
    res = await fetch(`${API}${path}`, { headers: headers(token), cache: 'no-store' });
  } catch {
    throw new Error("Couldn't reach GitHub. Check your connection.");
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export async function getViewer(token) {
  return get('/user', token);
}

// OAuth App client id (public, not a secret). Register one at github.com/settings/applications/new
// with "Enable Device Flow" ticked; the callback URL is unused, any https URL works.
export const GITHUB_CLIENT_ID = 'Ov23liVLiijXdAEIQ0lI';

async function postForm(url, body) {
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description ?? `GitHub returned ${res.status}.`);
  return data;
}

// Device flow: GitHub shows a code, you approve it on github.com in the session you're already
// signed in to, and we poll until the token arrives. onCode gets { user_code, verification_uri }.
export async function deviceLogin(onCode) {
  const start = await postForm('https://github.com/login/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'repo read:org' });
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
async function findBlockedOrgs(token) {
  let orgs;
  try {
    orgs = await get('/user/memberships/orgs?state=active&per_page=100', token);
  } catch {
    return []; // needs read:org; pasted tokens and pre-read:org sign-ins just skip the check
  }
  const blocked = [];
  await Promise.all(orgs.map(async ({ organization: { login } }) => {
    const res = await fetch(`${API}/user/memberships/orgs/${login}`, { headers: headers(token), cache: 'no-store' }).catch(() => null);
    if (res?.status === 403) blocked.push(login);
  }));
  return blocked.sort();
}

// One search query covers every repo the token can see, which is why we use
// the search API instead of walking repos. GitHub caps search at 1000 results.
async function fetchMyPRs({ token, includeDrafts, extraQuery }) {
  const terms = ['is:pr', 'is:open', 'author:@me', 'archived:false'];
  if (!includeDrafts) terms.push('draft:false');
  if (extraQuery?.trim()) terms.push(extraQuery.trim());
  const q = encodeURIComponent(terms.join(' '));

  const prs = [];
  for (let page = 1; page <= 10; page++) {
    const data = await get(`/search/issues?q=${q}&sort=created&order=asc&per_page=100&page=${page}`, token);
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
