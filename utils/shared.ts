// Shared between the service worker, popup and options page.
import { browser, type Browser } from 'wxt/browser';
import { githubAdapter } from './github';
import { gitlabAdapter } from './gitlab';

export type Color = `${Browser.tabGroups.Color}`;
export interface GitlabInstance {
  url: string;
  token: string;
}
export type Settings = {
  token: string;
  groupTitle: string;
  groupColor: Color;
  groupByRepo: boolean;
  ungroupOthers: boolean;
  pollMinutes: number;
  includeDrafts: boolean;
  extraQuery: string;
  gitlabInstances: GitlabInstance[];
  enabled: boolean;
};

export const DEFAULTS: Readonly<Settings> = Object.freeze({
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
export const COLOR_HEX: Record<Color, string> = {
  grey: '#5F6368',
  blue: '#1A73E8',
  red: '#D93025',
  yellow: '#F9AB00',
  green: '#188038',
  pink: '#D01884',
  purple: '#A142F4',
  cyan: '#007B83',
  orange: '#FA903E',
};

// Settings (incl. the tokens) live in storage.local: secrets should not sync between machines.
export async function getSettings(): Promise<Settings> {
  return browser.storage.local.get<Settings>({ ...DEFAULTS });
}

// Hidden PRs live in storage.sync so a hide follows you to other machines on the same Chrome account.
// Shape: { "owner/repo#123": hiddenAtMillis }, or "gitlab.com/group/project!123" for GitLab
export type Hidden = Record<string, number>;
export async function getHidden(): Promise<Hidden> {
  const { hidden } = await browser.storage.sync.get<{ hidden?: Hidden }>('hidden');
  return hidden ?? {};
}
export async function setHidden(hidden: Hidden) {
  await browser.storage.sync.set({ hidden });
}

// ---------- Adapters ----------
// One per configured source: GitHub when it has a token, plus each GitLab instance with a token.
// PR keys must be unique across adapters.
export interface PR {
  key: string;
  url: string;
  number: number;
  ref: string; // "#123" or "!123"
  title: string;
  repo: string;
  draft: boolean;
  createdAt: string;
}
export interface Adapter {
  name: string;
  urlPatterns: string[];
  keyFromUrl(url: string | undefined): string | null;
  fetch(): Promise<{ prs: PR[]; blockedOrgs?: string[] }>;
}

// What the service worker last fetched, kept in storage.local for the popup.
export interface PrCache {
  prs: PR[];
  blockedOrgs?: string[];
  fetchedAt?: number;
  error: string | null;
}
export async function getPrCache(): Promise<PrCache | undefined> {
  const { prCache } = await browser.storage.local.get<{ prCache?: PrCache }>('prCache');
  return prCache;
}

// Popup → service worker.
export type Message = { type: 'sync' } | { type: 'focus-group' } | { type: 'focus-pr'; key: string; url: string };

export function adapters(settings: Settings): Adapter[] {
  return [
    ...(settings.token ? [githubAdapter(settings)] : []),
    ...settings.gitlabInstances.filter((i) => i.token).map((i) => gitlabAdapter(i, settings)),
  ];
}

export function prKeyFromUrl(url: string | undefined, list: Adapter[]): string | null {
  for (const a of list) {
    const key = a.keyFromUrl(url);
    if (key) return key;
  }
  return null;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
