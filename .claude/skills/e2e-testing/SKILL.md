---
name: e2e-testing
description: Run, debug and write the end-to-end tests that load the built extension into real Chromium and Firefox (Playwright + Selenium, fake GitHub API). Use when changing tab/group/sync behavior, the popup or settings page, anything browser-specific, when an e2e test fails locally or in CI, or when asked to "test it in the browser".
---

# E2E tests

`e2e/` loads the **built** extension into a real browser with a fresh profile per test and fakes the GitHub API, so
tests exercise the real service worker, tab groups, badge, popup and settings page. No network, no token.

| File                  | Browser                         | Driven by                                         | Scope                        |
| --------------------- | ------------------------------- | ------------------------------------------------- | ---------------------------- |
| `e2e/sync.spec.ts`    | Chromium (Playwright's bundled) | Playwright, fixture in `e2e/fixtures.ts`          | All behavior                 |
| `e2e/firefox.spec.ts` | Firefox stable                  | Selenium (geckodriver), under Playwright's runner | What differs in Firefox only |

Unit tests (`utils/*.test.ts`, vitest, `bun run test`) cover pure logic and API parsing. Put a test in e2e when it
needs real tabs, groups, storage events or pages.

## Running

```sh
bunx playwright install chromium        # once per machine
bun run e2e                             # builds Chrome + Firefox, runs both projects
bun run e2e --project=chromium          # one browser
bun run e2e -g "hiding a PR"            # one test by name
bun run e2e --project=chromium --headed # watch it (Chromium only)
```

`bun run e2e` always rebuilds first. When calling `bunx playwright test` directly, run `bun run build` (Chromium) or
`bun run zip:firefox` (Firefox) first, or the tests run the stale `.output/`.

The first Firefox run downloads Firefox and geckodriver through Selenium Manager (into `~/.cache/selenium`), so it's
slow once.

## Writing a Chromium test

Use the `ext` fixture from `./fixtures`. Pattern: fake GitHub's answer, save settings, sync, assert on browser state.

```ts
import { expect, prUrl, test, type FakePR } from './fixtures';

const PR: FakePR = { repo: 'acme/api', number: 1, title: 'Fix it' };

test('describes the behavior, not the implementation', async ({ ext }) => {
  await ext.github({ prs: [PR] }); // what the fake search returns; { status: 401 } makes every call fail
  await ext.setSettings({ token: 'fake' }); // writes storage.local, like the settings page
  await ext.sync(); // full refetch + reconcile, resolves when done
  expect(await ext.groupedTabs()).toEqual([{ url: prUrl(PR), group: 'My PRs' }]);
});
```

- **Fixture API:** `github()`, `setSettings()`, `sync()`, `open('popup.html' | 'options.html')` (a Page),
  `groupedTabs()`, `groups()`, `badge()`. Lower-level access goes through `ext.sw.evaluate(() => chrome.…)` for the
  service worker, and `ext.context` for pages.
- **Code inside `evaluate()` runs in the browser.** It can't use imports or variables from the test file; pass data as
  the second argument. `chrome` is typed there (`e2e/globals.d.ts`).
- **Add a fixture helper** when two tests need the same browser query, rather than repeating `evaluate` blocks.
- **Synchronize on `ext.sync()`, never on timeouts.** For things that settle on their own (storage-triggered syncs,
  UI after a click) use `await expect.poll(() => …).toEqual(…)` or Playwright's auto-waiting `expect(locator)`.
- **github.com pages are stubbed** by a context route, so PR tabs load instantly. Pages opened by the test count as
  tabs: the extension may group, close or redirect them.
- **The extension's own pages are tabs too.** The fixture's driver page (`popup.html`) is the active tab. Tabs created
  by the extension are background tabs. The active tab is never closed by a sync.
- **Each test gets a fresh profile,** so on start the settings page is already open (no token yet).

## Writing a Firefox test

Only for behavior that can differ in Firefox, such as the tabs API, background page lifecycle or manifest keys. Use
`ff.run(fn, ...args)` to run code in the extension's settings page, where `browser.*` is available. `ff.github(prs)`
replaces `fetch` in the background page (Firefox's MV3 background is a page, reachable with
`browser.runtime.getBackgroundPage()`). Firefox-specific gotcha already covered: new tabs read `about:blank` until their
page starts loading (there's no `pendingUrl`).

## When a test fails

1. Read the assertion diff. Most failures are real behavior changes. Fix the code, or update the test if the change
   was intended.
2. Chromium: `test-results/<test>/trace.zip` → `bunx playwright show-trace test-results/…/trace.zip` (DOM, console,
   network per step). In CI the `e2e-traces` artifact holds the same files.
3. Service worker errors: add `ext.sw.on('console', (m) => console.log(m.text()))` temporarily.
4. "Navigation interrupted by … options.html": a test opened a page before the install tab appeared. The fixture
   waits for it, so check that a new helper doesn't race it.
5. Before calling a test flaky, run it ten times: `bun run e2e -g "name" --repeat-each 10`.

## Checking that a test can fail

After writing a test, break the behavior it covers (comment out the line) and confirm the test goes red, then
restore. A test that passes against broken code tests nothing.
