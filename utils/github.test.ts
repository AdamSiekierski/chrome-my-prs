import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubAdapter, githubStatus } from './github';
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

  it('adds statuses from one GraphQL call without asking for stacks', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/search/issues')) {
          return json({
            total_count: 2,
            items: [
              { ...item(1), node_id: 'PR_1' },
              { ...item(2), node_id: 'PR_2', draft: true },
            ],
          });
        }
        if (url.endsWith('/graphql')) {
          bodies.push(String(init?.body));
          return json({
            data: {
              nodes: [
                { id: 'PR_1', mergeStateStatus: 'CLEAN' },
                { id: 'PR_2', mergeStateStatus: 'CLEAN' },
              ],
            },
          });
        }
        return json([]);
      }),
    );

    const { prs } = await adapter().fetch();

    expect(prs.map((p) => p.status)).toEqual(['ready', undefined]);
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!).query).not.toContain('stack');
  });

  it.each([
    ['an HTTP error', () => json({ message: 'boom' }, 500)],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a GraphQL error', () => json({ errors: [{ message: 'Resource not accessible' }] })],
  ])('keeps syncing without statuses after %s when not grouping by stack', async (_, graphql) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search/issues')) return json({ total_count: 1, items: [{ ...item(1), node_id: 'PR_1' }] });
        if (url.endsWith('/graphql')) return graphql();
        return json([]);
      }),
    );

    const { prs } = await adapter().fetch();

    expect(prs).toHaveLength(1);
    expect(prs[0]!.status).toBeUndefined();
  });

  it('uses partial GraphQL data when some fields error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search/issues')) {
          return json({ total_count: 2, items: [1, 2].map((n) => ({ ...item(n), node_id: `PR_${n}` })) });
        }
        if (url.endsWith('/graphql')) {
          return json({
            data: { nodes: [{ id: 'PR_1', reviewDecision: 'APPROVED', mergeStateStatus: 'BLOCKED' }, null] },
            errors: [{ message: 'Resource not accessible by personal access token' }],
          });
        }
        return json([]);
      }),
    );

    const { prs } = await adapter().fetch();

    expect(prs.map((p) => p.status)).toEqual(['approved', undefined]);
  });

  it('keeps stacks and syncs when only status fields error while grouping by stack', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search/issues')) return json({ total_count: 1, items: [{ ...item(1), node_id: 'PR_1' }] });
        if (url.endsWith('/graphql')) {
          return json({
            data: {
              nodes: [
                {
                  id: 'PR_1',
                  stack: { number: 9 },
                  mergeStateStatus: 'BLOCKED',
                  reviewDecision: 'APPROVED',
                  commits: null,
                },
              ],
            },
            errors: [{ message: 'Resource not accessible by personal access token', path: ['nodes', 0, 'commits'] }],
          });
        }
        return json([]);
      }),
    );

    const { prs } = await adapter({ groupByStack: true }).fetch();

    expect(prs.map((p) => [p.stack, p.status])).toEqual([[9, 'approved']]);
  });

  it('fails the sync when the stack field itself errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search/issues')) return json({ total_count: 1, items: [{ ...item(1), node_id: 'PR_1' }] });
        if (url.endsWith('/graphql')) {
          return json({
            data: { nodes: [{ id: 'PR_1', stack: null, mergeStateStatus: 'CLEAN' }] },
            errors: [{ message: 'Stacks unavailable', path: ['nodes', 0, 'stack'] }],
          });
        }
        return json([]);
      }),
    );
    await expect(adapter({ groupByStack: true }).fetch()).rejects.toThrow('Stacks unavailable');
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

const rollup = (state: string | null) => ({
  nodes: [{ commit: { statusCheckRollup: state ? { state } : null } }],
});

describe('githubStatus', () => {
  it.each([
    [{ mergeStateStatus: 'DIRTY', reviewDecision: 'APPROVED', commits: rollup('FAILURE') }, 'conflicts'],
    [{ mergeStateStatus: 'CLEAN', commits: rollup('FAILURE') }, 'ci-failing'],
    [{ mergeStateStatus: 'BLOCKED', commits: rollup('ERROR') }, 'ci-failing'],
    [{ mergeStateStatus: 'BEHIND', reviewDecision: 'CHANGES_REQUESTED' }, 'changes-requested'],
    [{ mergeStateStatus: 'BEHIND', commits: rollup('PENDING') }, 'behind'],
    [{ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', commits: rollup('PENDING') }, 'ci-running'],
    [{ mergeStateStatus: 'BLOCKED', commits: rollup('EXPECTED') }, 'ci-running'],
    [{ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', commits: rollup('SUCCESS') }, 'needs-review'],
    [{ mergeStateStatus: 'CLEAN', reviewDecision: null, commits: rollup(null) }, 'ready'],
    [{ mergeStateStatus: 'BLOCKED', reviewDecision: 'APPROVED' }, 'approved'],
    [{ mergeStateStatus: 'UNKNOWN' }, undefined],
    [{ mergeStateStatus: 'UNKNOWN', reviewDecision: 'APPROVED' }, undefined],
    [{}, undefined],
  ])('%j → %s', (node, expected) => expect(githubStatus(node)).toBe(expected));
});
