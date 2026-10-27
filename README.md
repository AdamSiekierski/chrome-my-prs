# My PRs Tab Group

A Chrome and Firefox extension that keeps one tab group filled with every open GitHub pull request and GitLab merge request you authored.

![The popup listing open PRs next to the PR tab group](store/screenshot-popup.png)

## Install

**Chrome Web Store:** _listing in review, link coming soon._
**Firefox Add-ons:** _coming soon_ (Firefox 140 or later).

### From source

Needs [mise](https://mise.jdx.dev) (it installs the pinned [bun](https://bun.sh)):

```sh
git clone https://github.com/AdamSiekierski/chrome-my-prs.git && cd chrome-my-prs
mise install && bun install && bun run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick `chrome-my-prs/.output/chrome-mv3`. The settings page opens on first install.
3. [Create a classic token with `repo` scope](https://github.com/settings/tokens/new?scopes=repo&description=My%20PRs%20Tab%20Group),
   paste it, press **Check token**, then **Save changes**.

To update: `git pull && bun install && bun run build`, then press the reload icon on the extension's card in `chrome://extensions`.

Firefox: `bun run build:firefox`, then `about:debugging` → _This Firefox_ → _Load Temporary Add-on_ → pick
`.output/firefox-mv3/manifest.json`. It stays until Firefox restarts.

A token reaches every repo you can, so it's the recommended way. A
[fine-grained token](https://github.com/settings/personal-access-tokens/new) works too: Pull requests + Metadata
read-only on the repos you work in. If your org enforces SAML SSO, authorize the token for it, or those PRs
silently won't appear in search.

Alternatively, **Sign in with GitHub** skips the token: approve a code on github.com and you're done. But orgs
that restrict third-party apps hide their PRs until an org owner approves the app; the popup warns when that happens.

### GitLab

In settings, under **GitLab instances**, add each GitLab you use (leave the URL empty for gitlab.com, or enter a self-hosted one), each
with its own personal access token with the `read_api` scope. On save, Chrome asks to allow access to those instances,
and gives access back for ones you remove. GitHub and GitLab are independent; set up any combination.

## How it behaves

- Every N minutes (default 5) it runs one GitHub search: `is:pr is:open author:@me archived:false`
  plus your optional extra filter (e.g. `org:my-company`). Each GitLab instance adds one
  `GET /api/v4/merge_requests?scope=created_by_me&state=opened` (the extra filter doesn't apply to it).
- Missing PRs get opened as background tabs in the group; merged, closed and hidden ones get closed.
  A PR you already have open in an ungrouped tab is moved into the group instead of opened again.
- **One group per repository** (off by default, in settings): each repo gets a group named `<group name>: <repo>`,
  created with its first PR and gone once its last PR tab closes.
- **One group per stack** (off by default, in settings, GitHub only): PRs in a
  [stack](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs) get their own group named
  `<group name>: <repo> stack #<n>`, next to the other groups. Costs one extra GitHub API call per sync.
- **Move other tabs out of the group** (off by default, in settings): a tab in the group that isn't a PR page is
  ungrouped as soon as it leaves the PR (and on every sync), so the group holds only PRs.
- **Hide**: the Hide button in the popup, or right-click a PR page/link → _Hide from My PRs group_.
  Hides sync across machines through your Chrome account and are forgotten 30 days after the PR closes.
- Clicking a PR in the popup jumps to its tab; clicking the group label opens the group.
- Opening a PR that already has a tab in the group (a link, a bookmark, typing the URL) switches to that tab instead of
  duplicating it. A new tab closes; a tab you followed a link in goes back to where it was.

### Deliberate choices

- **A failed fetch never closes tabs.** A network blip or expired token must not read as "you have no PRs".
  With several sources set up, any one failing skips the whole sync.
- **The active tab is never closed.** A PR you just merged stays put until you switch away; the next sync removes it.
- **Non-PR tabs inside the group are never closed.** By default they're left alone; with **Move other tabs out of
  the group** (in settings) they're moved next to the group: a link opened from a PR, a tab navigated away, one you
  dragged in. A tab you navigated within a PR (`/files`, `/commits`) still
  counts as that PR's tab, so no duplicates.
- **Closing a PR tab by hand doesn't hide it**, so it comes back on the next sync. Hide is the explicit way to remove one;
  pausing (the toggle in the popup) stops all changes.
- **The group is found by name after a restart** (Chrome doesn't keep group ids), so keep the name unique.
  Settings are the source of truth: renaming the group in Chrome's UI gets reverted, rename it in settings instead.
- **Tokens stay in `storage.local`**: the GitHub one is sent only to `api.github.com`, each GitLab one only to its own
  instance. Hides go in `storage.sync`.
- **GitLab access is an optional permission**, requested for just the instances you add, so adding GitLab support didn't
  make Chrome disable the extension for existing users.

## Privacy

No server, no analytics. The token stays in this browser and goes only to GitHub. See [PRIVACY.md](PRIVACY.md).

## Releasing

Publishing a GitHub release `vX.Y.Z` ships it to the Chrome Web Store and Firefox Add-ons.
Setup and steps: [docs/publishing.md](docs/publishing.md).

## Development

Built with [WXT](https://wxt.dev) and TypeScript. `bun run dev` (or `dev:firefox`) opens the browser with the
extension loaded and reloads on change; `bun run check` runs oxlint, oxfmt, tsc and the vitest unit tests;
`bun run e2e` runs the built extension in real Chromium and Firefox against a fake GitHub (see
[the e2e skill](.claude/skills/e2e-testing/SKILL.md)). CI runs all of them.

- `entrypoints/background.ts`: sync loop, tab group reconciliation, context menu
- `utils/shared.ts`: settings, hides, the list of active sources (adapters)
- `utils/github.ts`, `utils/gitlab.ts`: one adapter per source: fetch your open PRs/MRs, recognize their URLs
- `entrypoints/popup/`, `entrypoints/options/`, `assets/ui.css`: UI
- `wxt.config.ts`: manifest fields and permissions; the version comes from `package.json`
- `e2e/`: end-to-end tests
- `store/`: store listing text and images (`bun run store:images` regenerates the images)

## License

[MIT](LICENSE)
