import { DEFAULTS, COLOR_HEX, getSettings } from './lib/shared.js';
import { getViewer, deviceLogin } from './lib/github.js';
import { getGitlabUser, gitlabOrigin } from './lib/gitlab.js';

const $ = (id) => document.getElementById(id);
const form = $('form');

function renderSwatches(selected) {
  const box = $('swatches');
  box.replaceChildren();
  for (const [name, hex] of Object.entries(COLOR_HEX)) {
    const label = document.createElement('label');
    label.className = 'swatch';
    label.title = name[0].toUpperCase() + name.slice(1);
    label.style.setProperty('--c', hex);
    label.innerHTML = `<input type="radio" name="groupColor" value="${name}" aria-label="${label.title}"><span></span>`;
    const input = label.querySelector('input');
    input.checked = name === selected;
    input.addEventListener('change', () => document.documentElement.style.setProperty('--group', hex));
    box.append(label);
  }
}

async function load() {
  const s = await getSettings();
  $('token').value = s.token;
  $('groupTitle').value = s.groupTitle;
  $('groupByRepo').checked = s.groupByRepo;
  $('includeDrafts').checked = s.includeDrafts;
  $('extraQuery').value = s.extraQuery;
  $('pollMinutes').value = s.pollMinutes;
  $('gitlab-list').replaceChildren(...s.gitlabInstances.map(gitlabRow));
  renderSwatches(s.groupColor);
  document.documentElement.style.setProperty('--group', COLOR_HEX[s.groupColor]);
}

$('reveal').addEventListener('click', () => {
  const input = $('token');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('reveal').textContent = show ? 'Hide' : 'Show';
});

// ---------- GitLab instances ----------

let rowCount = 0;

function setStatus(node, text, kind) {
  node.className = `hint${kind ? ` ${kind}` : ''}`;
  node.textContent = text;
}

function gitlabRow({ url = 'https://gitlab.com', token = '' } = {}) {
  const row = $('gitlab-row').content.firstElementChild.cloneNode(true);
  const field = (name) => row.querySelector(`[data-field="${name}"]`);
  const n = ++rowCount;
  for (const name of ['url', 'token']) {
    field(name).id = `gitlab-${name}-${n}`;
    row.querySelector(`[data-for="${name}"]`).htmlFor = field(name).id;
  }
  field('url').value = url;
  field('token').value = token;
  const updateLink = () => {
    const origin = gitlabOrigin(field('url').value.trim()) ?? 'https://gitlab.com';
    field('link').href = `${origin}/-/user_settings/personal_access_tokens?name=My%20PRs%20Tab%20Group&scopes=read_api`;
  };
  updateLink();
  field('url').addEventListener('input', updateLink);

  row.querySelector('[data-action="reveal"]').addEventListener('click', (e) => {
    const show = field('token').type === 'password';
    field('token').type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Hide' : 'Show';
  });
  row.querySelector('[data-action="remove"]').addEventListener('click', () => row.remove());
  row.querySelector('[data-action="check"]').addEventListener('click', async () => {
    const instance = { url: field('url').value.trim(), token: field('token').value.trim() };
    if (!instance.token) return setStatus(field('status'), 'Paste a token first.', 'err');
    if (!(await requestAccess([instance], field('status')))) return;
    setStatus(field('status'), 'Checking…');
    try {
      const user = await getGitlabUser(instance);
      setStatus(field('status'), `Works. Signed in as @${user.username}.`, 'ok');
    } catch (e) {
      setStatus(field('status'), e.message, 'err');
    }
  });
  return row;
}

$('gitlab-add').addEventListener('click', () => {
  const row = gitlabRow({ url: '' });
  $('gitlab-list').append(row);
  row.querySelector('input').focus();
});

// Reads the rows, skipping empty ones. Returns null after flagging the first bad row.
function readInstances() {
  const instances = [];
  for (const row of $('gitlab-list').children) {
    const url = row.querySelector('[data-field="url"]').value.trim();
    const token = row.querySelector('[data-field="token"]').value.trim();
    const status = row.querySelector('[data-field="status"]');
    if (!token && (!url || url === 'https://gitlab.com')) continue;
    const origin = gitlabOrigin(url);
    let error = null;
    if (!origin) error = 'Enter a valid GitLab URL, like https://gitlab.example.com.';
    else if (!token) error = 'Paste a token, or remove this instance.';
    else if (instances.some((i) => i.url === origin)) error = 'This instance is already in the list.';
    if (error) {
      setStatus(status, error, 'err');
      return null;
    }
    instances.push({ url: origin, token });
  }
  return instances;
}

// Must run before any other await in a click/submit handler: Chrome only prompts during a user gesture.
async function requestAccess(instances, status) {
  const origins = instances.map((i) => gitlabOrigin(i.url));
  if (origins.includes(null)) {
    setStatus(status, 'Enter a valid GitLab URL, like https://gitlab.example.com.', 'err');
    return false;
  }
  if (!origins.length) return true;
  const granted = await chrome.permissions.request({ origins: origins.map((o) => `${o}/*`) }).catch(() => false);
  if (!granted) setStatus(status, 'Chrome access to the GitLab instance was not allowed, so it can\'t be used.', 'err');
  return granted;
}

$('check').addEventListener('click', async () => {
  const status = $('token-status');
  const token = $('token').value.trim();
  status.className = 'hint';
  if (!token) {
    status.textContent = 'Paste a token first.';
    status.classList.add('err');
    return;
  }
  status.textContent = 'Checking…';
  try {
    const user = await getViewer(token);
    status.textContent = `Works. Signed in as @${user.login}.`;
    status.classList.add('ok');
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('err');
  }
});

$('signin').addEventListener('click', async () => {
  const btn = $('signin');
  const status = $('signin-status');
  status.className = 'hint';
  btn.disabled = true;
  try {
    const token = await deviceLogin(({ user_code, verification_uri }) => {
      navigator.clipboard.writeText(user_code).catch(() => {});
      status.textContent = `Enter code ${user_code} on GitHub (copied to clipboard). Waiting…`;
      chrome.tabs.create({ url: verification_uri });
    });
    const user = await getViewer(token);
    await chrome.storage.local.set({ token }); // background picks this up and syncs
    $('token').value = token;
    status.textContent = `Signed in as @${user.login}. Syncing now.`;
    status.classList.add('ok');
  } catch (e) {
    status.textContent = e.message;
    status.classList.add('err');
  } finally {
    btn.disabled = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('saved').textContent = '';
  const gitlabInstances = readInstances();
  if (!gitlabInstances) return setStatus($('saved'), 'Not saved: fix the GitLab instance marked above.', 'err');
  if (!(await requestAccess(gitlabInstances, $('saved')))) return;
  const { gitlabInstances: before } = await getSettings();
  const poll = Math.round(Number($('pollMinutes').value));
  await chrome.storage.local.set({
    token: $('token').value.trim(),
    groupTitle: $('groupTitle').value.trim() || DEFAULTS.groupTitle,
    groupColor: form.querySelector('input[name="groupColor"]:checked')?.value ?? DEFAULTS.groupColor,
    groupByRepo: $('groupByRepo').checked,
    includeDrafts: $('includeDrafts').checked,
    extraQuery: $('extraQuery').value.trim(),
    gitlabInstances,
    pollMinutes: Number.isFinite(poll) ? Math.min(60, Math.max(1, poll)) : DEFAULTS.pollMinutes,
  });
  // Give back access to instances that were removed.
  const gone = before.map((i) => `${i.url}/*`).filter((o) => !gitlabInstances.some((i) => `${i.url}/*` === o));
  if (gone.length) await chrome.permissions.remove({ origins: gone }).catch(() => {});
  await load();
  $('saved').className = '';
  $('saved').textContent = 'Saved. Syncing now.';
  setTimeout(() => { $('saved').textContent = ''; }, 3000);
});

load();
