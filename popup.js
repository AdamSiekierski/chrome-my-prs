import { getSettings, getHidden, setHidden, COLOR_HEX, timeAgo } from './lib/shared.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text; // titles come from GitHub: never innerHTML
  return node;
}

const send = (msg) => chrome.runtime.sendMessage(msg);

async function toggleHidden(key, hide) {
  const hidden = await getHidden();
  if (hide) hidden[key] = Date.now();
  else delete hidden[key];
  await setHidden(hidden); // the service worker reacts and updates the group
}

function prRow(pr, isHidden) {
  const row = el('div', 'row');
  const main = el('button', 'row-main');
  main.title = isHidden ? `Open ${pr.title}` : `Go to ${pr.title}`;
  main.append(el('span', 'num', `#${pr.number}`), el('span', 'title', pr.title));
  if (pr.draft) main.append(el('span', 'tag', 'Draft'));
  main.addEventListener('click', async () => {
    if (isHidden) await chrome.tabs.create({ url: pr.url });
    else await send({ type: 'focus-pr', key: pr.key, url: pr.url });
    window.close();
  });

  const action = el('button', 'row-action', isHidden ? 'Show' : 'Hide');
  action.title = isHidden ? 'Put this PR back in the group' : 'Remove this PR from the group and keep it out';
  action.addEventListener('click', () => toggleHidden(pr.key, !isHidden));

  row.append(main, action);
  return row;
}

function byRepo(prs) {
  const sorted = [...prs].sort((a, b) => a.repo.localeCompare(b.repo) || b.number - a.number);
  const groups = new Map();
  for (const pr of sorted) {
    if (!groups.has(pr.repo)) groups.set(pr.repo, []);
    groups.get(pr.repo).push(pr);
  }
  return groups;
}

function renderList(container, prs, isHidden) {
  container.replaceChildren();
  for (const [repo, items] of byRepo(prs)) {
    container.append(el('div', 'repo', repo));
    for (const pr of items) container.append(prRow(pr, isHidden));
  }
}

function emptyState(text, buttonLabel, onClick) {
  const box = el('div', 'empty');
  box.append(el('p', null, text));
  if (buttonLabel) {
    const btn = el('button', 'btn primary', buttonLabel);
    btn.addEventListener('click', onClick);
    box.append(btn);
  }
  return box;
}

async function render() {
  const [settings, hidden, { prCache }] = await Promise.all([
    getSettings(), getHidden(), chrome.storage.local.get('prCache'),
  ]);

  document.documentElement.style.setProperty('--group', COLOR_HEX[settings.groupColor] ?? COLOR_HEX.purple);
  $('chip-title').textContent = settings.groupTitle;
  $('enabled').checked = settings.enabled;

  const prs = prCache?.prs ?? [];
  const visible = prs.filter((p) => !hidden[p.key]);
  const hiddenPrs = prs.filter((p) => hidden[p.key]);
  $('chip-count').textContent = visible.length;

  const status = $('status');
  status.className = 'status';
  const list = $('list');

  if (!settings.token) {
    status.textContent = '';
    list.replaceChildren(emptyState(
      'Sign in to GitHub so the extension can find the pull requests you opened.',
      'Sign in',
      () => chrome.runtime.openOptionsPage(),
    ));
    $('hidden-wrap').hidden = true;
    return;
  }

  if (prCache?.error) {
    status.classList.add('error');
    status.textContent = prCache.error;
  } else if (prCache?.blockedOrgs?.length) {
    status.classList.add('error');
    status.textContent = `${prCache.blockedOrgs.join(', ')} blocks this extension, so its PRs are missing. `
      + 'Ask an org owner to approve "My PRs", or paste a personal access token in settings: it reaches every repo you can.';
  } else if (prCache?.fetchedAt) {
    status.textContent = `Synced ${timeAgo(prCache.fetchedAt)}${settings.enabled ? '' : '. Paused, tabs stay as they are.'}`;
  } else {
    status.textContent = 'Fetching your pull requests…';
  }

  if (visible.length) renderList(list, visible, false);
  else if (prCache?.fetchedAt) {
    list.replaceChildren(emptyState(
      hiddenPrs.length ? 'Every open PR is hidden. Show one below to bring it back.' : 'You have no open pull requests.',
    ));
  } else list.replaceChildren();

  $('hidden-wrap').hidden = hiddenPrs.length === 0;
  $('hidden-count').textContent = hiddenPrs.length;
  renderList($('hidden-list'), hiddenPrs, true);
}

$('sync').addEventListener('click', async () => {
  const btn = $('sync');
  btn.classList.add('spinning');
  btn.disabled = true;
  try { await send({ type: 'sync' }); } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
});
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('chip').addEventListener('click', async () => {
  await send({ type: 'focus-group' });
  window.close();
});
$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));

chrome.storage.onChanged.addListener(render);
render();
