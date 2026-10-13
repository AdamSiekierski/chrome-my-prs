# Agent notes

Plain MV3 Chrome extension: no build step, no dependencies, no package.json. `README.md` covers how it behaves.

## Releasing


A published GitHub release `vX.Y.Z` triggers `.github/workflows/publish.yml`, which checks the tag against
`manifest.json`, attaches `extension.zip` to the release, and uploads + submits it to the Chrome Web Store.
Google reviews every submission (hours to a few days) before users get it. Full setup: `docs/publishing.md`.

`manifest.json` `version` is the only version number. There is no changelog file.

### 1. Pick the version

Look at what changed since the last release:

```sh
git fetch --tags && last=$(git describe --tags --abbrev=0) && git log --oneline "$last"..origin/master
```

No tags yet → the first release is the current manifest version (`1.0.0`), skip to step 3.

- **Patch** (`1.2.3` → `1.2.4`): bug fixes, copy tweaks.
- **Minor** (`1.2.3` → `1.3.0`): new features or settings.
- **Major** (`1.2.3` → `2.0.0`): changes users must act on, e.g. a stored-settings format change.

New entries in `permissions` or `host_permissions` make Chrome **disable the extension for existing users until they
accept the new permission**. Call this out to the user before releasing, and add a justification for it to
`store/listing.md` (it must also be entered in the dashboard's Privacy tab).

Versions must be strictly higher than the one in the store, or the upload is rejected. Never reuse or lower one.

### 2. Bump in a PR

```sh
git checkout -b release-X.Y.Z origin/master
# edit only the "version" field in manifest.json; keep the file's compact formatting (don't pipe it through jq)
git commit -am "Release vX.Y.Z"
git push -u origin release-X.Y.Z
gh pr create --base master --title "Release vX.Y.Z" --body "<summary of user-facing changes since the last tag>"
```

Wait for it to be merged (ask the user; don't merge it yourself unless told to).

### 3. Create the release

This publishes to every user once Google approves it, so **confirm with the user before running it**.

```sh
git fetch && git show origin/master:manifest.json | grep '"version"'   # must equal X.Y.Z
gh release create vX.Y.Z --target master --title "vX.Y.Z" --generate-notes
```

Then follow the run until it finishes and report the result:

```sh
gh run watch "$(gh run list --workflow publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Success means "submitted for review", not "live". Tell the user it's in review.

### When the run fails

Read the log: `gh run view --log-failed`.

| Symptom | Fix |
| --- | --- |
| `Release tag ... doesn't match manifest.json version` | Manifest wasn't bumped on master. Delete the release and tag (`gh release delete vX.Y.Z --cleanup-tag`), do step 2, release again. |
| Upload rejected: version must be greater | That version (or higher) is already in the store. Bump again. |
| Item is pending review / submission in progress | A previous version is still in review. Wait for it, or cancel the pending submission in the dashboard, then re-run the job (`gh run rerun <id>`). |
| `invalid_grant` / 401 from Google | Refresh token expired or revoked (tokens die after 7 days if the OAuth app is still in "Testing"). Regenerate with `npx chrome-webstore-upload-keys`, then `gh secret set CWS_REFRESH_TOKEN`. |
| Publish refused after a visibility change | Publish once by hand in the dashboard, then re-run. |

Re-running the job is safe: the zip upload to the release uses `--clobber`.

### Listing text and images

The workflow only uploads the code. Store description, screenshots and privacy answers are edited by hand in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole/); `store/listing.md` and `store/*.png` are the
source to paste from. If a release changes the UI or what the extension does, update those files in the release PR,
regenerate the images (command in `docs/publishing.md`, "Store images"), and remind the user to paste them into the
dashboard.
