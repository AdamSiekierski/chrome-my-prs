import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  getSettings,
  getHidden,
  setHidden,
  getPrCache,
  adapters,
  prKeyFromUrl,
  COLOR_HEX,
  type Adapter,
  type Message,
  type PR,
  type Settings,
} from '@/utils/shared';

const ALARM = 'my-prs-sync';
const MENU_ID = 'my-prs-hide';
const HIDDEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ERROR_RED = '#D93025';

// ---------- Sync loop ----------
// Several triggers (alarm, settings change, hide toggle, popup) can fire at once.
// Only one sync runs at a time; anything arriving mid-sync schedules exactly one rerun.
let running: Promise<void> | null = null;
let rerun = false;
let rerunRefetch = false;

function requestSync({ refetch = false } = {}) {
  if (running) {
    rerun = true;
    rerunRefetch ||= refetch;
    return running;
  }
  running = (async () => {
    let doRefetch = refetch;
    try {
      do {
        rerun = false;
        await doSync({ refetch: doRefetch });
        doRefetch = rerunRefetch;
        rerunRefetch = false;
      } while (rerun);
    } catch (e) {
      console.error('[my-prs] sync failed', e);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function doSync({ refetch }: { refetch: boolean }) {
  const settings = await getSettings();
  const sources = adapters(settings);

  if (!sources.length) {
    await badge('!', ERROR_RED, 'My PRs: add a GitHub or GitLab token in settings');
    return;
  }

  let prCache = await getPrCache();

  if (refetch || !prCache?.fetchedAt) {
    try {
      // Any source failing fails the whole fetch, so one source's outage can't close another's tabs.
      const results = await Promise.all(sources.map((a) => a.fetch()));
      const prs = results.flatMap((r) => r.prs);
      const blockedOrgs = results.flatMap((r) => r.blockedOrgs ?? []);
      prCache = { prs, blockedOrgs, fetchedAt: Date.now(), error: null };
      await browser.storage.local.set({ prCache });
      await pruneHidden(prs);
    } catch (e) {
      const error = (e as Error).message;
      await browser.storage.local.set({ prCache: { prs: [], ...prCache, error } });
      await badge('!', ERROR_RED, `My PRs: ${error}`);
      // A failed fetch must never be read as "you have no PRs" — leave the tabs alone.
      return;
    }
  }

  const hidden = await getHidden();
  const wanted = new Map(prCache.prs.filter((p) => !hidden[p.key]).map((p) => [p.key, p]));

  if (!settings.enabled) {
    await badge('', COLOR_HEX[settings.groupColor], 'My PRs: paused');
    return;
  }

  await reconcileGroups(settings, sources, wanted);
  await badge(
    wanted.size ? String(wanted.size) : '',
    prCache.error || prCache.blockedOrgs?.length ? ERROR_RED : COLOR_HEX[settings.groupColor],
    prCache.blockedOrgs?.length ? `My PRs: can't see ${prCache.blockedOrgs.join(', ')}` : `My PRs: ${wanted.size} open`,
  );
}

// ---------- Tab group reconciliation ----------

// With "group by repository" each repo gets "<group name>: <repo>"; otherwise every PR shares one group.
// ponytail: repo name only, so same-named repos from different owners share a group.
function titleFor(settings: Settings, pr: PR) {
  return settings.groupByRepo ? `${settings.groupTitle}: ${pr.repo.split('/').pop()}` : settings.groupTitle;
}

async function findGroups(settings: Settings) {
  // Group ids don't survive a browser restart, so storage.session (cleared on restart) is
  // the right home for the cached ids. After a restart we re-find the restored groups by title.
  // Both title shapes match, so switching "group by repository" either way picks up the old groups.
  const { groupIds = [] } = await browser.storage.session.get<{ groupIds?: number[] }>('groupIds');
  const prefix = `${settings.groupTitle}: `;
  return (await browser.tabGroups.query({})).filter(
    (g) => groupIds.includes(g.id) || g.title === settings.groupTitle || g.title?.startsWith(prefix),
  );
}

async function targetWindowId() {
  try {
    const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && !win.incognito) return win.id;
  } catch {
    /* no focused window */
  }
  const wins = await browser.windows.getAll({ windowTypes: ['normal'] });
  return wins.find((w) => !w.incognito)?.id ?? null;
}

// Firefox reports a new tab as about:blank until its page starts loading (Chrome has pendingUrl for that),
// so a sync right after another would miss the tabs it just opened. Remember which PR each one is for.
type OpenedTabs = Record<number, string>;
async function tabKeys(sources: Adapter[]) {
  const { openedTabs = {} } = await browser.storage.session.get<{ openedTabs?: OpenedTabs }>('openedTabs');
  const keyOf = (tab: Browser.tabs.Tab) =>
    prKeyFromUrl(tab.url || tab.pendingUrl, sources) ??
    (tab.url === 'about:blank' ? openedTabs[tab.id!] : null) ??
    null;
  return { keyOf, openedTabs };
}

async function reconcileGroups(settings: Settings, sources: Adapter[], wanted: Map<string, PR>) {
  const { keyOf, openedTabs } = await tabKeys(sources);
  const groups = await findGroups(settings);
  const tabs = (await Promise.all(groups.map((g) => browser.tabs.query({ groupId: g.id })))).flat();

  const present = new Map<string, Browser.tabs.Tab>();
  const toClose: number[] = [];
  const toUngroup: number[] = [];
  for (const tab of tabs) {
    const key = keyOf(tab);
    // Tabs that aren't PR pages (opened from a PR, navigated away, dragged in) are never closed:
    // left alone, or moved out of the group with "move other tabs out".
    if (!key) {
      if (settings.ungroupOthers) toUngroup.push(tab.id!);
      continue;
    }
    if (wanted.has(key) && !present.has(key)) {
      present.set(key, tab);
    } else if (!tab.active) {
      // Merged/closed/hidden PR, or a duplicate. The tab you're looking at is spared
      // until you switch away, so a PR you just merged doesn't vanish under your cursor.
      toClose.push(tab.id!);
    }
  }

  // A PR you already have open in an ungrouped tab moves into its group instead of getting a duplicate.
  // Pinned tabs and tabs in popup or incognito windows stay put.
  if ([...wanted.keys()].some((k) => !present.has(k))) {
    const loose = await browser.tabs.query({
      groupId: browser.tabGroups.TAB_GROUP_ID_NONE,
      pinned: false,
      windowType: 'normal',
      url: sources.flatMap((a) => a.urlPatterns),
    });
    for (const tab of loose) {
      const key = keyOf(tab);
      if (key && !tab.incognito && wanted.has(key) && !present.has(key)) present.set(key, tab);
    }
  }

  const prsByTitle = new Map<string, PR[]>();
  for (const pr of wanted.values()) {
    const title = titleFor(settings, pr);
    if (!prsByTitle.has(title)) prsByTitle.set(title, []);
    prsByTitle.get(title)!.push(pr);
  }

  // Each title reuses the group already named that, else a leftover group holding one of its PRs
  // (renamed below), so renaming the group or toggling "group by repository" keeps groups in place.
  const groupFor = new Map<string, Browser.tabGroups.TabGroup>();
  for (const g of groups) if (g.title && prsByTitle.has(g.title) && !groupFor.has(g.title)) groupFor.set(g.title, g);
  const used = new Set([...groupFor.values()].map((g) => g.id));
  for (const [title, prs] of prsByTitle) {
    if (groupFor.has(title)) continue;
    const leftover = groups.find((g) => !used.has(g.id) && prs.some((p) => present.get(p.key)?.groupId === g.id));
    if (leftover) {
      groupFor.set(title, leftover);
      used.add(leftover.id);
    }
  }

  // Tabs whose entry in openedTabs is still worth keeping.
  const live = new Set(tabs.map((t) => t.id));
  let fallbackWindowId: number | undefined = groups[0]?.windowId;
  for (const [title, prs] of prsByTitle) {
    let group = groupFor.get(title);
    // Tabs sitting in another of our groups move over; missing PRs get a new background tab.
    const ids = prs
      .map((p) => present.get(p.key))
      .filter((t) => t && t.groupId !== group?.id)
      .map((t) => t!.id!);
    const missing = prs.filter((p) => !present.has(p.key));
    const windowId = group?.windowId ?? (fallbackWindowId ??= (await targetWindowId()) ?? undefined);
    if (missing.length && windowId == null) continue; // no browser window open; next alarm will retry
    for (const pr of missing) {
      const tab = await browser.tabs.create({ windowId, url: pr.url, active: false });
      ids.push(tab.id!);
      openedTabs[tab.id!] = pr.key;
      live.add(tab.id!);
    }
    if (ids.length) {
      if (group) {
        await browser.tabs.group({ groupId: group.id, tabIds: ids as [number, ...number[]] });
      } else {
        const groupId = await browser.tabs.group({
          tabIds: ids as [number, ...number[]],
          createProperties: { windowId },
        });
        await browser.tabGroups.update(groupId, { collapsed: true });
        group = await browser.tabGroups.get(groupId);
      }
    }
    if (!group) continue;
    used.add(group.id);
    if (group.title !== title || group.color !== settings.groupColor) {
      await browser.tabGroups.update(group.id, { title, color: settings.groupColor }).catch(() => {});
    }
  }
  await browser.storage.session.set({
    groupIds: [...used],
    openedTabs: Object.fromEntries(Object.entries(openedTabs).filter(([id]) => live.has(Number(id)))),
  });

  // Close after adding: if every tab were closed first, Chrome would delete the group itself.
  // Groups left with no PRs disappear on their own once their last tab closes.
  if (toUngroup.length) await browser.tabs.ungroup(toUngroup as [number, ...number[]]);
  if (toClose.length) await browser.tabs.remove(toClose);
}

// Forget hides for PRs that have been closed for a while, so storage.sync doesn't fill up.
async function pruneHidden(openPrs: PR[]) {
  const hidden = await getHidden();
  const open = new Set(openPrs.map((p) => p.key));
  const cutoff = Date.now() - HIDDEN_TTL_MS;
  let changed = false;
  for (const [key, at] of Object.entries(hidden)) {
    if (!open.has(key) && at < cutoff) {
      delete hidden[key];
      changed = true;
    }
  }
  if (changed) await setHidden(hidden);
}

async function badge(text: string, color: string, title: string) {
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeTextColor({ color: '#FFFFFF' });
  await browser.action.setTitle({ title });
}

async function scheduleAlarm() {
  const { pollMinutes } = await getSettings();
  const period = Math.min(60, Math.max(1, Number(pollMinutes) || 5));
  const existing = await browser.alarms.get(ALARM);
  if (existing?.periodInMinutes !== period) {
    await browser.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: period });
  }
}

// ---------- Popup actions ----------

async function focusPR(key: string, url: string) {
  const settings = await getSettings();
  const sources = adapters(settings);
  const groups = await findGroups(settings);
  const candidates = groups.length
    ? (await Promise.all(groups.map((g) => browser.tabs.query({ groupId: g.id })))).flat()
    : await browser.tabs.query({ url: sources.flatMap((a) => a.urlPatterns) });
  const { keyOf } = await tabKeys(sources);
  const tab = candidates.find((t) => keyOf(t) === key);
  if (tab) await activate(tab);
  else await browser.tabs.create({ url });
}

async function activate(tab: Browser.tabs.Tab) {
  await browser.tabs.update(tab.id!, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

// With "move other tabs out", a group tab leaving PR pages moves out right away, not on the next sync.
// A tab outside our groups landing on a PR that already has a group tab: show the group tab instead.
// The duplicate goes back if it has history (a link followed in the same tab), else it closes.
async function onTabUrl(tabId: number, url: string) {
  const settings = await getSettings();
  // A tab we just opened, before its page starts loading (Firefox).
  if (!settings.enabled || url === 'about:blank') return;
  const sources = adapters(settings);
  const key = prKeyFromUrl(url, sources);
  const groups = await findGroups(settings);
  const groupIds = new Set(groups.map((g) => g.id));
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || tab.incognito) return;
  if (groupIds.has(tab.groupId)) {
    if (!key && settings.ungroupOthers) await browser.tabs.ungroup(tabId);
    return;
  }
  if (!key) return;
  const tabs = (await Promise.all(groups.map((g) => browser.tabs.query({ groupId: g.id })))).flat();
  const { keyOf } = await tabKeys(sources);
  const existing = tabs.find((t) => keyOf(t) === key);
  if (!existing) return;
  // Keep the exact page asked for (e.g. /files or a comment anchor).
  if (existing.url !== url) await browser.tabs.update(existing.id!, { url });
  await activate(existing);
  await browser.tabs.goBack(tabId).catch(() => browser.tabs.remove(tabId).catch(() => {}));
}

// With one group per repo, this opens the first one.
async function focusGroup() {
  const settings = await getSettings();
  const [group] = await findGroups(settings);
  if (!group) return requestSync({ refetch: true });
  const [first] = await browser.tabs.query({ groupId: group.id });
  await browser.tabGroups.update(group.id, { collapsed: false });
  if (first) await browser.tabs.update(first.id!, { active: true });
  await browser.windows.update(group.windowId, { focused: true });
}

// ---------- Event wiring ----------

// Context menus persist across restarts, so this runs on install/update and when the sources change.
async function setupMenu() {
  const patterns = adapters(await getSettings()).flatMap((a) => a.urlPatterns);
  await browser.contextMenus.removeAll();
  if (!patterns.length) return; // an empty pattern list would mean "everywhere"
  browser.contextMenus.create({
    id: MENU_ID,
    title: 'Hide from My PRs group',
    contexts: ['page', 'link'],
    documentUrlPatterns: patterns,
    targetUrlPatterns: patterns,
  });
}

// Listeners are registered synchronously in main() so they survive service worker restarts.
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await setupMenu();
    await scheduleAlarm();
    if (reason === 'install' && !adapters(await getSettings()).length) browser.runtime.openOptionsPage();
    requestSync({ refetch: true });
  });

  browser.runtime.onStartup.addListener(async () => {
    await scheduleAlarm();
    requestSync({ refetch: true });
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) requestSync({ refetch: true });
  });

  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU_ID) return;
    // Right-click on a PR link hides that PR; right-click on a PR page hides the page's PR.
    const sources = adapters(await getSettings());
    const key = prKeyFromUrl(info.linkUrl, sources) ?? prKeyFromUrl(info.pageUrl, sources);
    if (!key) return;
    const hidden = await getHidden();
    hidden[key] = Date.now();
    await setHidden(hidden); // storage.onChanged triggers the sync
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.hidden) {
      requestSync();
      return;
    }
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.includes('pollMinutes')) scheduleAlarm();
    if (keys.some((k) => ['token', 'gitlabInstances'].includes(k))) setupMenu();
    if (keys.some((k) => ['token', 'includeDrafts', 'extraQuery', 'gitlabInstances'].includes(k))) {
      requestSync({ refetch: true });
    } else if (keys.some((k) => ['groupTitle', 'groupColor', 'groupByRepo', 'ungroupOthers', 'enabled'].includes(k))) {
      requestSync();
    }
  });

  browser.tabs.onUpdated.addListener((tabId, { url }) => {
    if (url) onTabUrl(tabId, url).catch((e) => console.error('[my-prs] tab update failed', e));
  });

  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    (async () => {
      if (msg.type === 'sync') await requestSync({ refetch: true });
      else if (msg.type === 'focus-pr') await focusPR(msg.key, msg.url);
      else if (msg.type === 'focus-group') await focusGroup();
      sendResponse({ ok: true });
    })().catch((e: Error) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  });
});
