# Agent notes

MV3 browser extension for Chrome and Firefox, built with [WXT](https://wxt.dev) and TypeScript. `README.md` covers how
it behaves.

## Setup and checks

Tools are pinned in `mise.toml` (bun, plus node for Playwright's runner); dependencies are managed with bun only (no
npm/yarn/pnpm).

```sh
mise install && bun install   # also runs `wxt prepare`, which generates .wxt/ (types, tsconfig)
bun run dev                   # opens Chrome with the extension loaded, hot reload (dev:firefox for Firefox)
bun run check                 # oxlint, oxfmt --check, tsc, vitest
bun run e2e                   # builds, then runs the extension in real Chromium and Firefox
bun run lint:firefox          # Mozilla's add-on linter on the Firefox build (what AMO runs on upload)
bun run fmt                   # fix formatting
```

Run `bun run check` before committing, and `bun run e2e` when a change touches tabs, groups, sync, the popup or the
settings page. CI (`.github/workflows/ci.yml`) runs all of these and fails on any lint warning.

How to run, debug and write e2e tests: `.claude/skills/e2e-testing/SKILL.md`. Read it before touching `e2e/`.

## Layout

- `entrypoints/`: one per manifest entry (`background.ts`, `popup/`, `options/`). WXT generates the manifest from these
  plus `wxt.config.ts`, which holds the permissions and other manifest fields.
- `utils/`: shared code and the GitHub/GitLab adapters, with `*.test.ts` next to them. Tests use WXT's `fakeBrowser`
  for `browser.*` and `vi.stubGlobal('fetch', …)` for the network.
- `public/`: copied as-is (icons). `assets/ui.css`: styles shared by the popup and options page.
- `e2e/`: Playwright end-to-end tests (see the skill above). `store/`: store listing text, images, image script.
- Auto-imports are off (`imports: false`): import `browser` from `wxt/browser` and everything else explicitly.

## Two browsers

The same code ships to Chrome (`.output/chrome-mv3`) and Firefox (`.output/firefox-mv3`, MV3, Firefox 140+).
`wxt.config.ts` adds the per-browser manifest keys (Firefox's gecko id is permanent, never change it). Before using an
extension API, check that Firefox supports it the same way (MDN's compatibility table), and keep UI copy
browser-neutral ("your browser", not "Chrome"). Known difference: Firefox has no `tab.pendingUrl`, so a new tab reads
`about:blank` until it starts loading; `tabKeys()` in `background.ts` covers that.

## Releasing

A published GitHub release `vX.Y.Z` triggers `.github/workflows/publish.yml`. It checks the tag against
`package.json`, runs the checks, attaches `chrome.zip`, `firefox.zip` and `firefox-sources.zip` to the release, then
submits to the Chrome Web Store and Firefox Add-ons (AMO) in two separate jobs, so one store failing doesn't block the
other. Both stores review every submission (hours to a few days) before users get it. Full setup: `docs/publishing.md`.
The Firefox job skips itself with a warning until its secrets are set.

`package.json` `version` is the only version number (WXT copies it into the manifest). There is no changelog file.

### 1. Pick the version

Look at what changed since the last release:

```sh
git fetch --tags && last=$(git describe --tags --abbrev=0) && git log --oneline "$last"..origin/master
```

No tags yet → the first release is the current `package.json` version (`1.0.0`), skip to step 3.

- **Patch** (`1.2.3` → `1.2.4`): bug fixes, copy tweaks.
- **Minor** (`1.2.3` → `1.3.0`): new features or settings.
- **Major** (`1.2.3` → `2.0.0`): changes users must act on, e.g. a stored-settings format change.

New entries in `permissions` or `host_permissions` (in `wxt.config.ts`; check `.output/chrome-mv3/manifest.json` after `bun run build`) make Chrome **disable the extension for existing users until they
accept the new permission** (Firefox asks too). Call this out to the user before releasing, and add a justification for
it to `store/listing.md` (it must also be entered in the Chrome dashboard's Privacy tab).

Versions must be strictly higher than the one in the store, or the upload is rejected. Never reuse or lower one.

### 2. Bump the version

Change only the `"version"` field in `package.json`. If you're also making the changes being released, put the bump in the same PR as those changes, not a separate
one. The release can only be created once that PR is merged to master.

### 3. Create the release

This publishes to every user once Google and Mozilla approve it, so **confirm with the user before running it**.

```sh
git fetch && git show origin/master:package.json | grep '"version"'   # must equal X.Y.Z
gh release create vX.Y.Z --target master --title "vX.Y.Z" --generate-notes
```

Then follow the run until it finishes and report the result:

```sh
gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Success means "submitted for review", not "live". Tell the user it's in review.

### When the run fails

Read the log: `gh run view --log-failed`.

| Symptom                                              | Fix                                                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Release tag ... doesn't match package.json version` | package.json wasn't bumped on master. Delete the release and tag (`gh release delete vX.Y.Z --cleanup-tag`), do step 2, release again.                                                        |
| Upload rejected: version must be greater             | That version (or higher) is already in the store. Bump again.                                                                                                                                 |
| Item is pending review / submission in progress      | A previous version is still in review. Wait for it, or cancel the pending submission in the dashboard, then re-run the job (`gh run rerun <id>`).                                             |
| `invalid_grant` / 401 from Google                    | Refresh token expired or revoked (tokens die after 7 days if the OAuth app is still in "Testing"). Regenerate with `npx chrome-webstore-upload-keys`, then `gh secret set CWS_REFRESH_TOKEN`. |
| Publish refused after a visibility change            | Publish once by hand in the dashboard, then re-run.                                                                                                                                           |
| Firefox: 401 / `Unauthorized`                        | AMO API key revoked or wrong. New one at https://addons.mozilla.org/developers/addon/api/key/, then `gh secret set FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET`.                              |
| Firefox: add-on not found / no permission            | The first version was never uploaded by hand (`docs/publishing.md`), or the gecko id in `wxt.config.ts` changed.                                                                              |
| Firefox: version already exists                      | That version is already on AMO. Bump again.                                                                                                                                                   |
| Firefox: validation errors                           | Run `bun run lint:firefox` locally; it's the same linter. Fix, bump, release again.                                                                                                           |

Re-running a failed job is safe (`gh run rerun <id> --failed`): the zip upload to the release uses `--clobber`.

### Listing text and images

The workflow only uploads the code. Store description, screenshots and privacy answers are edited by hand in the
[Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/) and the
[AMO Developer Hub](https://addons.mozilla.org/developers/); `store/listing.md` and `store/*.png` are the source to
paste from. If a release changes the UI or what the extension does, update those files in the release PR,
regenerate the images (`bun run store:images`), and remind the user to paste them into both
dashboards.
