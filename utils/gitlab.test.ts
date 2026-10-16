import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { gitlabAdapter, gitlabOrigin } from './gitlab';
import { DEFAULTS } from './shared';

const adapter = (url = 'https://gitlab.example.com') => gitlabAdapter({ url, token: 'tok' }, DEFAULTS);

// permissions.contains is overloaded (promise and callback); spyOn types it by the callback one.
const grantAccess = (granted: boolean) =>
  vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation((async () => granted) as never);

beforeEach(() => {
  fakeBrowser.reset();
  grantAccess(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['', 'https://gitlab.com'],
  [undefined, 'https://gitlab.com'],
  ['https://GitLab.Example.com/some/path', 'https://gitlab.example.com'],
  ['not a url', null],
])('gitlabOrigin(%j) → %j', (input, expected) => expect(gitlabOrigin(input)).toBe(expected));

describe('keyFromUrl', () => {
  const key = adapter().keyFromUrl;
  it.each([
    ['https://gitlab.example.com/group/project/-/merge_requests/7', 'gitlab.example.com/group/project!7'],
    ['https://gitlab.example.com/a/b/c/-/merge_requests/7/diffs', 'gitlab.example.com/a/b/c!7'],
  ])('%s → %s', (url, expected) => expect(key(url)).toBe(expected));

  it.each([
    'https://gitlab.com/group/project/-/merge_requests/7',
    'https://gitlab.example.com/group/project/-/issues/7',
  ])('ignores %s', (url) => expect(key(url)).toBeNull());
});

describe('fetch', () => {
  it('maps merge requests to PRs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json([
        {
          references: { full: 'group/sub/project!3' },
          web_url: 'https://gitlab.example.com/group/sub/project/-/merge_requests/3',
          iid: 3,
          title: 'MR',
          draft: true,
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetch);

    const { prs } = await adapter().fetch();

    expect(prs).toEqual([
      expect.objectContaining({
        key: 'gitlab.example.com/group/sub/project!3',
        repo: 'gitlab.example.com/group/sub/project',
        ref: '!3',
        draft: true,
      }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/gitlab\.example\.com\/api\/v4\/merge_requests\?scope=created_by_me&state=opened&/,
      ),
      expect.objectContaining({ headers: { 'PRIVATE-TOKEN': 'tok' } }),
    );
  });

  it('refuses to fetch without host access', async () => {
    grantAccess(false);
    await expect(adapter().fetch()).rejects.toThrow('No access to gitlab.example.com');
  });
});
