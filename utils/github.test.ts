import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubAdapter } from './github';
import { DEFAULTS } from './shared';

const adapter = (extra = {}) => githubAdapter({ ...DEFAULTS, token: 'tok', ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('keyFromUrl', () => {
  const key = adapter().keyFromUrl;
  it.each([
    ['https://github.com/Owner/Repo/pull/12', 'owner/repo#12'],
    ['https://github.com/o/r/pull/12/files', 'o/r#12'],
    ['https://github.com/o/r/pull/12?w=1', 'o/r#12'],
    ['https://github.com/o/r/pull/12#discussion_r1', 'o/r#12'],
  ])('%s → %s', (url, expected) => expect(key(url)).toBe(expected));

  it.each(['https://github.com/o/r/pull/12abc', 'https://github.com/o/r/issues/12', 'http://github.com/o/r/pull/1'])(
    'ignores %s',
    (url) => expect(key(url)).toBeNull(),
  );
});

const item = (n: number) => ({
  repository_url: 'https://api.github.com/repos/Acme/Api',
  number: n,
  html_url: `https://github.com/Acme/Api/pull/${n}`,
  title: `PR ${n}`,
  created_at: '2026-01-01T00:00:00Z',
});

describe('fetch', () => {
  it('builds the search query, pages through results and reports blocked orgs', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('/search/issues')) {
          const page = Number(new URL(url).searchParams.get('page'));
          return json({
            total_count: 101,
            items: page === 1 ? Array.from({ length: 100 }, (_, i) => item(i)) : [item(100)],
          });
        }
        if (url.endsWith('/user/memberships/orgs?state=active&per_page=100')) {
          return json([{ organization: { login: 'open' } }, { organization: { login: 'locked' } }]);
        }
        return json({}, url.endsWith('/locked') ? 403 : 200);
      }),
    );

    const { prs, blockedOrgs } = await adapter({ includeDrafts: false, extraQuery: ' org:acme ' }).fetch();

    expect(prs).toHaveLength(101);
    expect(prs[0]).toMatchObject({ key: 'acme/api#0', repo: 'Acme/Api', ref: '#0', draft: false });
    expect(blockedOrgs).toEqual(['locked']);
    const q = new URL(urls.find((u) => u.includes('/search/issues'))!).searchParams.get('q');
    expect(q).toBe('is:pr is:open author:@me archived:false draft:false org:acme');
  });

  it('looks up stacks in one GraphQL call when grouping by stack', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/search/issues')) {
          return json({ total_count: 2, items: [1, 2].map((n) => ({ ...item(n), node_id: `PR_${n}` })) });
        }
        if (url.endsWith('/graphql')) {
          bodies.push(String(init?.body));
          return json({
            data: {
              nodes: [
                { id: 'PR_1', stack: { number: 9 } },
                { id: 'PR_2', stack: null },
              ],
            },
          });
        }
        return json([]);
      }),
    );

    const { prs } = await adapter({ groupByStack: true }).fetch();

    expect(prs.map((p) => p.stack)).toEqual([9, undefined]);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!).variables).toEqual({ ids: ['PR_1', 'PR_2'] });
  });

  it('skips the stack lookup when not grouping by stack', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.includes('/search/issues') ? json({ total_count: 1, items: [item(1)] }) : json([]);
      }),
    );

    await adapter().fetch();

    expect(urls.some((u) => u.endsWith('/graphql'))).toBe(false);
  });

  it('turns a GraphQL error into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search/issues')) return json({ total_count: 1, items: [{ ...item(1), node_id: 'PR_1' }] });
        if (url.endsWith('/graphql')) return json({ errors: [{ message: 'Something broke' }] });
        return json([]);
      }),
    );
    await expect(adapter({ groupByStack: true }).fetch()).rejects.toThrow('Something broke');
  });

  it('turns a 401 into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Bad credentials' }, 401)),
    );
    await expect(adapter().fetch()).rejects.toThrow('GitHub rejected the token');
  });

  it('turns a network failure into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(adapter().fetch()).rejects.toThrow("Couldn't reach GitHub");
  });
});
