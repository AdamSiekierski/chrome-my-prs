import { getSettings, getHidden, setHidden, fetchMyPRs, findBlockedOrgs, prKeyFromUrl, COLOR_HEX } from './lib/shared.js';

const ALARM = 'my-prs-sync';
const MENU_ID = 'my-prs-hide';
const HIDDEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ERROR_RED = '#D93025';

// ---------- Sync loop ----------
// Several triggers (alarm, settings change, hide toggle, popup) can fire at once.
// Only one sync runs at a time; anything arriving mid-sync schedules exactly one rerun.
let running = null;
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

async function doSync({ refetch }) {
  const settings = await getSettings();

  if (!settings.token) {
    await badge('!', ERROR_RED, 'My PRs: add a GitHub token in settings');
    return;
  }

  let { prCache } = await chrome.storage.local.get('prCache');

  if (refetch || !prCache?.fetchedAt) {
    try {
      const [prs, blockedOrgs] = await Promise.all([fetchMyPRs(settings), findBlockedOrgs(settings.token)]);
      prCache = { prs, blockedOrgs, fetchedAt: Date.now(), error: null };
      await chrome.storage.local.set({ prCache });
      await pruneHidden(prs);
    } catch (e) {
      await chrome.storage.local.set({ prCache: { prs: [], ...prCache, error: e.message } });
      await badge('!', ERROR_RED, `My PRs: ${e.message}`);
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

  await reconcileGroups(settings, wanted);
  await badge(
    wanted.size ? String(wanted.size) : '',
    prCache.error || prCache.blockedOrgs?.length ? ERROR_RED : COLOR_HEX[settings.groupColor],
    prCache.blockedOrgs?.length ? `My PRs: can't see ${prCache.blockedOrgs.join(', ')}` : `My PRs: ${wanted.size} open`,
  );
}

// ---------- Tab group reconciliation ----------

// With "group by repository" each repo gets "<group name>: <repo>"; otherwise every PR shares one group.
// ponytail: repo name only, so same-named repos from different owners share a group.
function titleFor(settings, pr) {
  return settings.groupByRepo ? `${settings.groupTitle}: ${pr.repo.split('/')[1]}` : settings.groupTitle;
}

async function findGroups(settings) {
  // Group ids don't survive a browser restart, so storage.session (cleared on restart) is
  // the right home for the cached ids. After a restart we re-find the restored groups by title.
  // Both title shapes match, so switching "group by repository" either way picks up the old groups.
  const { groupIds = [] } = await chrome.storage.session.get('groupIds');
  const prefix = `${settings.groupTitle}: `;
  return (await chrome.tabGroups.query({})).filter(
    (g) => groupIds.includes(g.id) || g.title === settings.groupTitle || g.title?.startsWith(prefix),
  );
}

async function targetWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && !win.incognito) return win.id;
  } catch { /* no focused window */ }
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  return wins.find((w) => !w.incognito)?.id ?? null;
}

async function reconcileGroups(settings, wanted) {
  const groups = await findGroups(settings);
  const tabs = (await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })))).flat();

  const present = new Map();
  const toClose = [];
  for (const tab of tabs) {
    const key = prKeyFromUrl(tab.url || tab.pendingUrl);
    // Tabs that aren't PR pages are yours (you dragged them in or navigated away): never touch them.
    if (!key) continue;
    if (wanted.has(key) && !present.has(key)) {
      present.set(key, tab);
    } else if (!tab.active) {
      // Merged/closed/hidden PR, or a duplicate. The tab you're looking at is spared
      // until you switch away, so a PR you just merged doesn't vanish under your cursor.
      toClose.push(tab.id);
    }
  }

  const prsByTitle = new Map();
  for (const pr of wanted.values()) {
    const title = titleFor(settings, pr);
    if (!prsByTitle.has(title)) prsByTitle.set(title, []);
    prsByTitle.get(title).push(pr);
  }

  // Each title reuses the group already named that, else a leftover group holding one of its PRs
  // (renamed below), so renaming the group or toggling "group by repository" keeps groups in place.
  const groupFor = new Map();
  for (const g of groups) if (prsByTitle.has(g.title) && !groupFor.has(g.title)) groupFor.set(g.title, g);
  const used = new Set([...groupFor.values()].map((g) => g.id));
  for (const [title, prs] of prsByTitle) {
    if (groupFor.has(title)) continue;
    const g = groups.find((g) => !used.has(g.id) && prs.some((p) => present.get(p.key)?.groupId === g.id));
    if (g) { groupFor.set(title, g); used.add(g.id); }
  }

  let fallbackWindowId = groups[0]?.windowId;
  for (const [title, prs] of prsByTitle) {
    let group = groupFor.get(title);
    // Tabs sitting in another of our groups move over; missing PRs get a new background tab.
    const ids = prs.map((p) => present.get(p.key)).filter((t) => t && t.groupId !== group?.id).map((t) => t.id);
    const missing = prs.filter((p) => !present.has(p.key));
    const windowId = group?.windowId ?? (fallbackWindowId ??= await targetWindowId());
    if (missing.length && windowId == null) continue; // no browser window open; next alarm will retry
    for (const pr of missing) {
      const tab = await chrome.tabs.create({ windowId, url: pr.url, active: false });
      ids.push(tab.id);
    }
    if (ids.length) {
      if (group) {
        await chrome.tabs.group({ groupId: group.id, tabIds: ids });
      } else {
        const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
        await chrome.tabGroups.update(groupId, { collapsed: true });
        group = await chrome.tabGroups.get(groupId);
      }
    }
    if (!group) continue;
    used.add(group.id);
    if (group.title !== title || group.color !== settings.groupColor) {
      await chrome.tabGroups.update(group.id, { title, color: settings.groupColor }).catch(() => {});
    }
  }
  await chrome.storage.session.set({ groupIds: [...used] });

  // Close after adding: if every tab were closed first, Chrome would delete the group itself.
  // Groups left with no PRs disappear on their own once their last tab closes.
  if (toClose.length) await chrome.tabs.remove(toClose);
}

// Forget hides for PRs that have been closed for a while, so storage.sync doesn't fill up.
async function pruneHidden(openPrs) {
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

async function badge(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setTitle({ title });
}

async function scheduleAlarm() {
  const { pollMinutes } = await getSettings();
  const period = Math.min(60, Math.max(1, Number(pollMinutes) || 5));
  const existing = await chrome.alarms.get(ALARM);
  if (existing?.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: period });
  }
}

// ---------- Popup actions ----------

async function focusPR(key, url) {
  const settings = await getSettings();
  const groups = await findGroups(settings);
  const candidates = groups.length
    ? (await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })))).flat()
    : await chrome.tabs.query({ url: 'https://github.com/*/*/pull/*' });
  const tab = candidates.find((t) => prKeyFromUrl(t.url || t.pendingUrl) === key);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// With one group per repo, this opens the first one.
async function focusGroup() {
  const settings = await getSettings();
  const [group] = await findGroups(settings);
  if (!group) return requestSync({ refetch: true });
  const [first] = await chrome.tabs.query({ groupId: group.id });
  await chrome.tabGroups.update(group.id, { collapsed: false });
  if (first) await chrome.tabs.update(first.id, { active: true });
  await chrome.windows.update(group.windowId, { focused: true });
}

// ---------- Event wiring ----------
// Listeners are registered at the top level so they survive service worker restarts.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Hide from My PRs group',
    contexts: ['page', 'link'],
    documentUrlPatterns: ['https://github.com/*'],
    targetUrlPatterns: ['https://github.com/*/*/pull/*'],
  });
  await scheduleAlarm();
  const { token } = await getSettings();
  if (reason === 'install' && !token) chrome.runtime.openOptionsPage();
  requestSync({ refetch: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  requestSync({ refetch: true });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) requestSync({ refetch: true });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  // Right-click on a PR link hides that PR; right-click on a PR page hides the page's PR.
  const key = prKeyFromUrl(info.linkUrl) ?? prKeyFromUrl(info.pageUrl);
  if (!key) return;
  const hidden = await getHidden();
  hidden[key] = Date.now();
  await setHidden(hidden); // storage.onChanged triggers the sync
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.hidden) {
    requestSync();
    return;
  }
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.includes('pollMinutes')) scheduleAlarm();
  if (keys.some((k) => ['token', 'includeDrafts', 'extraQuery'].includes(k))) {
    requestSync({ refetch: true });
  } else if (keys.some((k) => ['groupTitle', 'groupColor', 'groupByRepo', 'enabled'].includes(k))) {
    requestSync();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'sync') await requestSync({ refetch: true });
    else if (msg.type === 'focus-pr') await focusPR(msg.key, msg.url);
    else if (msg.type === 'focus-group') await focusGroup();
    sendResponse({ ok: true });
  })().catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});
