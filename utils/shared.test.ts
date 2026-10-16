import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULTS, adapters, getHidden, getSettings, prKeyFromUrl, setHidden, timeAgo } from './shared';

beforeEach(() => fakeBrowser.reset());

describe('getSettings', () => {
  it('fills in defaults', async () => {
    expect(await getSettings()).toEqual(DEFAULTS);
  });

  it('prefers stored values', async () => {
    await fakeBrowser.storage.local.set({ token: 't', groupColor: 'blue' });
    expect(await getSettings()).toMatchObject({ token: 't', groupColor: 'blue', groupTitle: 'My PRs' });
  });
});

it('round-trips hides through storage.sync', async () => {
  expect(await getHidden()).toEqual({});
  await setHidden({ 'a/b#1': 5 });
  expect(await fakeBrowser.storage.sync.get('hidden')).toEqual({ hidden: { 'a/b#1': 5 } });
});

describe('adapters', () => {
  it('skips sources without a token', () => {
    const list = adapters({
      ...DEFAULTS,
      gitlabInstances: [
        { url: 'https://gitlab.com', token: 'x' },
        { url: 'https://gitlab.example.com', token: '' },
      ],
    });
    expect(list.map((a) => a.name)).toEqual(['gitlab.com']);
  });

  it('puts GitHub first and resolves keys across sources', () => {
    const list = adapters({ ...DEFAULTS, token: 't', gitlabInstances: [{ url: 'https://gitlab.com', token: 'x' }] });
    expect(list.map((a) => a.name)).toEqual(['GitHub', 'gitlab.com']);
    expect(prKeyFromUrl('https://github.com/o/r/pull/1', list)).toBe('o/r#1');
    expect(prKeyFromUrl('https://gitlab.com/g/p/-/merge_requests/2', list)).toBe('gitlab.com/g/p!2');
    expect(prKeyFromUrl('https://example.com/', list)).toBeNull();
    expect(prKeyFromUrl(undefined, list)).toBeNull();
  });
});

const ago = (s: number) => timeAgo(Date.now() - s * 1000);

it('timeAgo', () => {
  vi.useFakeTimers({ now: 10_000_000_000 });
  expect(ago(10)).toBe('just now');
  expect(ago(5 * 60)).toBe('5 min ago');
  expect(ago(3 * 3600)).toBe('3 h ago');
  expect(ago(2 * 86400)).toBe('2 d ago');
  vi.useRealTimers();
});
