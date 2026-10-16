// Firefox: Playwright can't load extensions into Firefox, so this drives it with Selenium (geckodriver),
// still under Playwright's test runner. Selenium Manager downloads Firefox and geckodriver on first run.
// Covers what differs from Chromium; the full behavior suite is sync.spec.ts.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { Builder, type WebDriver } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import type { FakePR } from './fixtures';

const OUTPUT = join(import.meta.dirname, '../.output');
const zip = () => {
  const name = readdirSync(OUTPUT).find((f) => f.endsWith('-firefox.zip'));
  if (!name) throw new Error('No Firefox zip in .output: run `bun run e2e`, which builds it.');
  return join(OUTPUT, name);
};

interface Firefox {
  /** Run `fn` in the extension's settings page (where `browser.*` is available) and return its result. */
  run<A extends unknown[], R>(fn: (...args: A) => Promise<R>, ...args: A): Promise<R>;
  /** Point the fake GitHub API at these PRs. */
  github(prs: FakePR[]): Promise<void>;
  sync(): Promise<void>;
  groupedTabs(): Promise<string[]>;
}

const test = base.extend<{ ff: Firefox }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the destructuring
  ff: async ({}, use) => {
    const options = new firefox.Options().addArguments('-headless');
    options.setBrowserVersion('stable');
    // Lets Selenium run scripts in moz-extension:// pages.
    const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
    const driver = (await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build()) as firefox.Driver & WebDriver;
    try {
      await driver.installAddon(zip(), true);
      // Without a token, installing opens the settings page; it's where the tests run their scripts.
      await expect
        .poll(async () => {
          for (const handle of await driver.getAllWindowHandles()) {
            await driver.switchTo().window(handle);
            if ((await driver.getCurrentUrl()).endsWith('/options.html')) return true;
          }
          return false;
        })
        .toBe(true);

      const ff: Firefox = {
        async run(fn, ...args) {
          const result = await driver.executeAsyncScript(
            `const done = arguments[arguments.length - 1];
             (${fn.toString()})(...Array.from(arguments).slice(0, -1))
               .then(done, (e) => done({ scriptError: String(e) }));`,
            ...args,
          );
          if (result && typeof result === 'object' && 'scriptError' in result)
            throw new Error(String(result.scriptError));
          return result as Awaited<ReturnType<typeof fn>>;
        },
        github: (prs) =>
          ff.run(async (list: FakePR[]) => {
            // Firefox's MV3 background is a page, so its fetch can be swapped from here.
            const bg = (await browser.runtime.getBackgroundPage()) as unknown as typeof globalThis;
            bg.fetch = (async (input: RequestInfo | URL) => {
              const url = new URL(String(input));
              const body =
                url.pathname === '/search/issues'
                  ? {
                      total_count: list.length,
                      items: list.map((pr) => ({
                        repository_url: `https://api.github.com/repos/${pr.repo}`,
                        number: pr.number,
                        html_url: `https://github.com/${pr.repo}/pull/${pr.number}`,
                        title: pr.title ?? `PR ${pr.number}`,
                        created_at: '2026-01-01T00:00:00Z',
                      })),
                    }
                  : [];
              return new bg.Response(JSON.stringify(body), { status: 200 });
            }) as typeof fetch;
          }, prs),
        sync: async () => {
          const res = await ff.run(() => browser.runtime.sendMessage({ type: 'sync' }));
          expect(res).toEqual({ ok: true });
        },
        groupedTabs: () =>
          ff.run(async () => (await browser.tabs.query({})).filter((t) => t.groupId !== -1).map((t) => String(t.id))),
      };
      await use(ff);
    } finally {
      await driver.quit();
    }
  },
});

const API_1: FakePR = { repo: 'acme/api', number: 1 };
const API_2: FakePR = { repo: 'acme/api', number: 2 };

// Firefox shows new tabs as about:blank until their page starts loading. A sync right after another
// (here: the token save, then the explicit sync) must still recognize the tabs the first one opened.
test('back-to-back syncs open each PR once, and merged PRs close', async ({ ff }) => {
  await ff.github([API_1, API_2]);
  await ff.run(() => browser.storage.local.set({ token: 'fake' }));
  await ff.sync();
  await ff.sync();
  expect(await ff.groupedTabs()).toHaveLength(2);
  expect(await ff.run(() => browser.action.getBadgeText({}))).toBe('2');

  await ff.github([API_2]);
  await ff.sync();
  expect(await ff.groupedTabs()).toHaveLength(1);
});

test('names and colors the group from settings', async ({ ff }) => {
  await ff.github([API_1]);
  await ff.run(() =>
    browser.storage.local.set({ token: 'fake', groupTitle: 'Mine', groupColor: 'cyan', groupByRepo: true }),
  );
  await ff.sync();
  expect(
    await ff.run(async () => (await browser.tabGroups.query({})).map((g) => ({ title: g.title, color: g.color }))),
  ).toEqual([{ title: 'Mine: api', color: 'cyan' }]);
});
