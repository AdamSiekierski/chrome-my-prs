// GitLab adapter, one per configured instance (gitlab.com or self-hosted).
// Any instance works, so host access is an optional permission the settings page requests per instance.

// ponytail: origin only, so a GitLab served under a sub-path (example.com/gitlab) isn't supported.
export function gitlabOrigin(url) {
  try { return url ? new URL(url).origin.toLowerCase() : null; } catch { return null; }
}

// MRs live at <origin>/group/sub/project/-/merge_requests/123[/diffs…]; groups can nest.
// Keys look like "gitlab.com/group/sub/project!123": the host keeps two instances' MRs apart,
// and the "!" keeps them apart from GitHub's "owner/repo#123".
export function gitlabAdapter(instance, settings) {
  const origin = gitlabOrigin(instance.url);
  const host = origin ? new URL(origin).host : instance.url;
  return {
    name: host,
    urlPatterns: origin ? [`${origin}/*/-/merge_requests/*`] : [],
    keyFromUrl(url) {
      if (!origin || !url?.toLowerCase().startsWith(`${origin}/`)) return null;
      const m = url.slice(origin.length).match(/^\/([^?#]+?)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/);
      return m ? `${host}/${m[1]}!${m[2]}`.toLowerCase() : null;
    },
    async fetch() {
      return { prs: await fetchMyMRs(instance, settings) };
    },
  };
}

async function gitlabGet(path, { url, token }) {
  const origin = gitlabOrigin(url);
  if (!origin) throw new Error(`"${url}" is not a valid GitLab URL. Fix it in settings.`);
  const host = new URL(origin).host;
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    throw new Error(`No access to ${host}. Save the settings again to allow it.`);
  }
  let res;
  try {
    res = await fetch(`${origin}/api/v4${path}`, { headers: { 'PRIVATE-TOKEN': token }, cache: 'no-store' });
  } catch {
    throw new Error(`Couldn't reach ${host}. Check your connection.`);
  }
  if (res.status === 401) throw new Error(`${host} rejected the token. Check it in settings.`);
  if (res.status === 429) throw new Error(`${host} rate limit reached. Syncing resumes on its own.`);
  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body.message ?? body.error ?? ''; } catch { /* non-JSON body */ }
    throw new Error(`${host} returned ${res.status}${detail ? `: ${detail}` : '.'}`);
  }
  return res.json();
}

export async function getGitlabUser(instance) {
  return gitlabGet('/user', instance);
}

// Like the GitHub search, one call covers every project the token can see.
async function fetchMyMRs(instance, { includeDrafts }) {
  const host = new URL(gitlabOrigin(instance.url)).host;
  const draft = includeDrafts ? '' : '&wip=no';
  const prs = [];
  for (let page = 1; page <= 10; page++) {
    const items = await gitlabGet(
      `/merge_requests?scope=created_by_me&state=opened${draft}&order_by=created_at&sort=asc&per_page=100&page=${page}`,
      instance,
    );
    for (const mr of items) {
      const [path] = mr.references.full.split('!');
      prs.push({
        key: `${host}/${mr.references.full}`.toLowerCase(),
        url: mr.web_url,
        number: mr.iid,
        ref: `!${mr.iid}`,
        title: mr.title,
        repo: `${host}/${path}`,
        draft: Boolean(mr.draft),
        createdAt: mr.created_at,
      });
    }
    if (items.length < 100) break;
  }
  return prs;
}
