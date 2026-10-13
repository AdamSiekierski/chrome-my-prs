import { DEFAULTS, COLOR_HEX, getSettings, getViewer } from './lib/shared.js';

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
  $('includeDrafts').checked = s.includeDrafts;
  $('extraQuery').value = s.extraQuery;
  $('pollMinutes').value = s.pollMinutes;
  renderSwatches(s.groupColor);
  document.documentElement.style.setProperty('--group', COLOR_HEX[s.groupColor]);
}

$('reveal').addEventListener('click', () => {
  const input = $('token');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('reveal').textContent = show ? 'Hide' : 'Show';
});

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const poll = Math.round(Number($('pollMinutes').value));
  await chrome.storage.local.set({
    token: $('token').value.trim(),
    groupTitle: $('groupTitle').value.trim() || DEFAULTS.groupTitle,
    groupColor: form.querySelector('input[name="groupColor"]:checked')?.value ?? DEFAULTS.groupColor,
    includeDrafts: $('includeDrafts').checked,
    extraQuery: $('extraQuery').value.trim(),
    pollMinutes: Number.isFinite(poll) ? Math.min(60, Math.max(1, poll)) : DEFAULTS.pollMinutes,
  });
  await load();
  $('saved').textContent = 'Saved. Syncing now.';
  setTimeout(() => { $('saved').textContent = ''; }, 3000);
});

load();
