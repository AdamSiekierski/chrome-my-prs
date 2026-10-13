# My PRs Tab Group

A Chrome extension that keeps one tab group filled with every open GitHub pull request you authored.

## Install

1. Unzip, open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → pick this folder. The settings page opens on first install.
3. Press **Sign in with GitHub**, approve the code on the github.com tab that opens. Done.

Sign-in needs an OAuth App client id, one-time: create one at
<https://github.com/settings/applications/new> (any homepage/callback URL), tick **Enable Device Flow**,
and put its Client ID in `GITHUB_CLIENT_ID` in `lib/shared.js`. If your org restricts third-party apps,
an org owner has to approve it once, or use a pasted token instead.

Pasted token (fallback): a classic token with `repo` scope (private repos), or a fine-grained token with
Pull requests + Metadata read-only on the repos you work in. If your org enforces SAML SSO,
authorize the token for it, or those PRs silently won't appear in search.

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
