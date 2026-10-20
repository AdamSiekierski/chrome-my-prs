import { expect, prUrl, test, type FakePR } from './fixtures';

const API_1: FakePR = { repo: 'acme/api', number: 1, title: 'Rate-limit search' };
const API_2: FakePR = { repo: 'acme/api', number: 2, title: 'Bump driver' };
const WEB_7: FakePR = { repo: 'acme/web', number: 7, title: 'Add Apple Pay', draft: true };

const urls = async (ext: { groupedTabs(): Promise<{ url: string }[]> }) =>
  (await ext.groupedTabs()).map((t) => t.url).toSorted();

test('first install opens the settings page and flags the missing token', async ({ ext }) => {
  await expect
    .poll(() => ext.context.pages().map((p) => p.url()))
    .toContain(`chrome-extension://${ext.id}/options.html`);
  await expect.poll(() => ext.badge()).toBe('!');
});

test('opens every PR in one collapsed group and counts them on the badge', async ({ ext }) => {
  await ext.github({ prs: [API_1, API_2, WEB_7] });
  await ext.setSettings({ token: 'fake' });
  await ext.sync();

  expect(await urls(ext)).toEqual([API_1, API_2, WEB_7].map(prUrl));
  expect(await ext.groups()).toEqual([{ title: 'My PRs', color: 'purple', collapsed: true }]);
  expect(await ext.badge()).toBe('3');
});

test('closes the tabs of merged PRs and opens new ones', async ({ ext }) => {
  await ext.github({ prs: [API_1, API_2] });
  await ext.setSettings({ token: 'fake' });
  await ext.sync();

  await ext.github({ prs: [API_2, WEB_7] });
  await ext.sync();

  expect(await urls(ext)).toEqual([API_2, WEB_7].map(prUrl));
});

test('a failed fetch leaves the tabs alone and shows the error', async ({ ext }) => {
  await ext.github({ prs: [API_1] });
  await ext.setSettings({ token: 'fake' });
  await ext.sync();

  await ext.github({ status: 401 });
  await ext.sync();

  expect(await urls(ext)).toEqual([prUrl(API_1)]);
  expect(await ext.badge()).toBe('!');
  const popup = await ext.open('popup.html');
  await expect(popup.locator('#status')).toHaveText('GitHub rejected the token. Check it in settings.');
});

test('hiding a PR from the popup closes its tab, and showing it brings it back', async ({ ext }) => {
  await ext.github({ prs: [API_1, API_2] });
  await ext.setSettings({ token: 'fake' });
  await ext.sync();

  const popup = await ext.open('popup.html');
  await popup.locator('#list .row', { hasText: API_1.title }).getByRole('button', { name: 'Hide' }).click();

  await expect.poll(() => urls(ext)).toEqual([prUrl(API_2)]);
  await expect(popup.locator('#hidden-wrap')).toBeVisible();
  await expect(popup.locator('#hidden-count')).toHaveText('1');

  await popup.locator('#hidden-wrap summary').click();
  await popup.locator('#hidden-list .row', { hasText: API_1.title }).getByRole('button', { name: 'Show' }).click();
  await expect.poll(() => urls(ext)).toEqual([API_1, API_2].map(prUrl));
});

test('moves a PR that is already open in an ungrouped tab into the group', async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`${prUrl(API_1)}/files`);

  await ext.github({ prs: [API_1] });
  await ext.setSettings({ token: 'fake' });
  await ext.sync();

  expect(await urls(ext)).toEqual([`${prUrl(API_1)}/files`]);
});

test('one group per repository', async ({ ext }) => {
  await ext.github({ prs: [API_1, API_2, WEB_7] });
  await ext.setSettings({ token: 'fake', groupByRepo: true });
  await ext.sync();

  expect(await ext.groupedTabs()).toEqual(
    expect.arrayContaining([
      { url: prUrl(API_1), group: 'My PRs: api' },
      { url: prUrl(API_2), group: 'My PRs: api' },
      { url: prUrl(WEB_7), group: 'My PRs: web' },
    ]),
  );
  expect((await ext.groups()).map((g) => g.title).toSorted()).toEqual(['My PRs: api', 'My PRs: web']);
});

test('one group per stack, next to the other groups', async ({ ext }) => {
  await ext.github({ prs: [{ ...API_1, stack: 4 }, { ...API_2, stack: 4 }, WEB_7] });
  await ext.setSettings({ token: 'fake', groupByStack: true });
  await ext.sync();

  expect(await ext.groupedTabs()).toEqual(
    expect.arrayContaining([
      { url: prUrl(API_1), group: 'My PRs: api stack #4' },
      { url: prUrl(API_2), group: 'My PRs: api stack #4' },
      { url: prUrl(WEB_7), group: 'My PRs' },
    ]),
  );
  expect((await ext.groups()).map((g) => g.title).toSorted()).toEqual(['My PRs', 'My PRs: api stack #4']);

  await ext.setSettings({ groupByStack: false });
  await ext.sync();
  expect((await ext.groups()).map((g) => g.title)).toEqual(['My PRs']);
});

test('opening a PR that already has a tab switches to that tab instead', async ({ ext }) => {
  await ext.github({ prs: [API_1] });
  await ext.setSettings({ token: 'fake' });
  await ext.sync();

  const page = await ext.context.newPage();
  await page.goto(prUrl(API_1));

  // The new tab goes back to where it came from; the grouped tab stays the only one on the PR.
  await expect.poll(() => page.url()).toBe('about:blank');
  const active = await ext.sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]?.groupId);
  expect(active).not.toBe(-1);
});
