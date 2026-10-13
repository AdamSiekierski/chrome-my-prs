# My PRs Tab Group

A Chrome extension that keeps one tab group filled with every open GitHub pull request you authored.

## Install

```sh
git clone https://github.com/AdamSiekierski/chrome-my-prs.git
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick the `chrome-my-prs` folder. The settings page opens on first install.
3. [Create a classic token with `repo` scope](https://github.com/settings/tokens/new?scopes=repo&description=My%20PRs%20Tab%20Group),
   paste it, press **Check token**, then **Save changes**.

To update: `git pull`, then press the reload icon on the extension's card in `chrome://extensions`.

A token reaches every repo you can, so it's the recommended way. A
[fine-grained token](https://github.com/settings/personal-access-tokens/new) works too: Pull requests + Metadata
read-only on the repos you work in. If your org enforces SAML SSO, authorize the token for it, or those PRs
silently won't appear in search.

Alternatively, **Sign in with GitHub** skips the token: approve a code on github.com and you're done. But orgs
that restrict third-party apps hide their PRs until an org owner approves the app; the popup warns when that happens.

## How it behaves

- Every N minutes (default 5) it runs one GitHub search: `is:pr is:open author:@me archived:false`
  plus your optional extra filter (e.g. `org:my-company`).
- Missing PRs get opened as background tabs in the group; merged, closed and hidden ones get closed.
- **Hide**: the Hide button in the popup, or right-click a PR page/link → *Hide from My PRs group*.
  Hides sync across machines through your Chrome account and are forgotten 30 days after the PR closes.
- Clicking a PR in the popup jumps to its tab; clicking the group label opens the group.

### Deliberate choices

- **A failed fetch never closes tabs.** A network blip or expired token must not read as "you have no PRs".
- **The active tab is never closed.** A PR you just merged stays put until you switch away; the next sync removes it.
- **Non-PR tabs inside the group are left alone**, and a tab you navigated within a PR (`/files`, `/commits`) still
  counts as that PR's tab, so no duplicates.
- **Closing a PR tab by hand doesn't hide it**, so it comes back on the next sync. Hide is the explicit way to remove one;
  pausing (the toggle in the popup) stops all changes.
- **The group is found by name after a restart** (Chrome doesn't keep group ids), so keep the name unique.
  Settings are the source of truth: renaming the group in Chrome's UI gets reverted, rename it in settings instead.
- **The token stays in `storage.local`** and is sent only to `api.github.com`; hides go in `storage.sync`.

## Files

- `background.js`: sync loop, tab group reconciliation, context menu
- `lib/shared.js`: settings, GitHub API, PR URL parsing
- `popup.*`, `options.*`, `ui.css`: UI
