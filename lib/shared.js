// Shared between the service worker, popup and options page.
import { githubAdapter } from './github.js';
import { gitlabAdapter } from './gitlab.js';

export const DEFAULTS = Object.freeze({
  token: '',
  groupTitle: 'My PRs',
  groupColor: 'purple',
  groupByRepo: false,
  ungroupOthers: false,
  pollMinutes: 5,
  includeDrafts: true,
  extraQuery: '',
  gitlabInstances: [], // [{ url, token }], each its own adapter
  enabled: true,
});

// Chrome's tab group palette (light theme values).
export const COLOR_HEX = {
  grey: '#5F6368', blue: '#1A73E8', red: '#D93025', yellow: '#F9AB00', green: '#188038',
  pink: '#D01884', purple: '#A142F4', cyan: '#007B83', orange: '#FA903E',
};

// Settings (incl. the tokens) live in storage.local: secrets should not sync between machines.
export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

// Hidden PRs live in storage.sync so a hide follows you to other machines on the same Chrome account.
// Shape: { "owner/repo#123": hiddenAtMillis }, or "gitlab.com/group/project!123" for GitLab
export async function getHidden() {
  const { hidden } = await chrome.storage.sync.get('hidden');
  return hidden ?? {};
}
export async function setHidden(hidden) {
  await chrome.storage.sync.set({ hidden });
}

// ---------- Adapters ----------
// One per configured source: GitHub when it has a token, plus each GitLab instance with a token.
// An adapter is { name, urlPatterns, keyFromUrl(url), fetch() → { prs, blockedOrgs? } };
// a PR is { key, url, number, ref, title, repo, draft, createdAt }, and keys must be unique across adapters.
export function adapters(settings) {
  return [
    ...(settings.token ? [githubAdapter(settings)] : []),
    ...settings.gitlabInstances.filter((i) => i.token).map((i) => gitlabAdapter(i, settings)),
  ];
}

export function prKeyFromUrl(url, list) {
  for (const a of list) {
    const key = a.keyFromUrl(url);
    if (key) return key;
  }
  return null;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
