// Loads the built extension into Chromium and fakes GitHub, so tests drive the real extension end to end.
import { join } from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';

const EXTENSION = join(import.meta.dirname, '../.output/chrome-mv3');

export interface FakePR {
  repo: string; // "owner/name"
  number: number;
  title?: string;
  draft?: boolean;
}

export const prUrl = (pr: FakePR) => `https://github.com/${pr.repo}/pull/${pr.number}`;

// What the fake GitHub API answers, stored on the service worker's global scope.
interface FakeState {
  prs: FakePR[];
  status: number;
}

export interface Extension {
  context: BrowserContext;
  sw: Worker;
  id: string;
  /** Set the PRs the fake GitHub search returns, or make every API call fail with `status`. */
  github(state: Partial<FakeState>): Promise<void>;
  /** Save a GitHub token, as the settings page would. Triggers a sync. */
  setSettings(settings: Record<string, unknown>): Promise<void>;
  /** Run a full sync (refetch + reconcile) and wait for it to finish, as the popup's sync button does. */
  sync(): Promise<void>;
  /** Open an extension page (popup.html, options.html) in a tab. */
  open(path: string): Promise<Page>;
  /** Tabs in any of our groups: url and group title, in tab strip order. */
  groupedTabs(): Promise<{ url: string; group: string }[]>;
  groups(): Promise<{ title: string; color: string; collapsed: boolean }[]>;
  badge(): Promise<string>;
}

export const test = base.extend<{ ext: Extension }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the destructuring
  ext: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // the full browser: headless shell can't load extensions
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    // PR tabs load real github.com pages otherwise.
    await context.route('https://github.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Fake PR</title>' }),
    );

    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;
    // Without a token, installing opens the settings page. Wait for it, so it can't take over a test's tab.
    await expect.poll(() => context.pages().some((p) => p.url().endsWith('/options.html'))).toBe(true);
    await sw.evaluate(() => {
      const state = { prs: [] as FakePR[], status: 200 };
      Object.assign(globalThis, { fakeGitHub: state });
      // Everything here runs inside the service worker, so it can't use helpers from this file.
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- serialized into the worker
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
        if (state.status !== 200) return json({ message: 'Fake failure' }, state.status);
        if (url.pathname === '/search/issues') {
          return json({
            total_count: state.prs.length,
            items: state.prs.map((pr) => ({
              repository_url: `https://api.github.com/repos/${pr.repo}`,
              number: pr.number,
              html_url: `https://github.com/${pr.repo}/pull/${pr.number}`,
              title: pr.title ?? `PR ${pr.number}`,
              draft: pr.draft ?? false,
              created_at: '2026-01-01T00:00:00Z',
            })),
          });
        }
        if (url.pathname === '/user') return json({ login: 'octo' });
        if (url.pathname.startsWith('/user/memberships/orgs')) return json([]);
        return json({ message: 'Not Found' }, 404);
      }) as typeof fetch;
    });

    let driver: Page | undefined;
    const ext: Extension = {
      context,
      sw,
      id,
      github: (state) =>
        sw.evaluate((s) => {
          Object.assign((globalThis as unknown as { fakeGitHub: FakeState }).fakeGitHub, s);
        }, state),
      setSettings: (settings) => sw.evaluate((s) => chrome.storage.local.set(s), settings),
      async sync() {
        // Messages must come from an extension page. The popup, opened as a tab, also refetches once on load.
        driver ??= await ext.open('popup.html');
        const res = await driver.evaluate(() => chrome.runtime.sendMessage({ type: 'sync' }));
        if (!res?.ok) throw new Error(`sync failed: ${JSON.stringify(res)}`);
      },
      async open(path) {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${id}/${path}`);
        return page;
      },
      groupedTabs: () =>
        sw.evaluate(async () => {
          const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title ?? '']));
          return (await chrome.tabs.query({}))
            .filter((t) => groups.has(t.groupId))
            .map((t) => ({ url: t.pendingUrl || t.url || '', group: groups.get(t.groupId)! }));
        }),
      groups: () =>
        sw.evaluate(async () =>
          (await chrome.tabGroups.query({})).map((g) => ({
            title: g.title ?? '',
            color: g.color,
            collapsed: g.collapsed,
          })),
        ),
      badge: () => sw.evaluate(() => chrome.action.getBadgeText({})),
    };
    await use(ext);
    await context.close();
  },
});

export { expect };
