# Publishing to the Chrome Web Store and Firefox Add-ons

Publishing a GitHub release runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml): it builds both
zips, attaches them to the release and submits them to the Chrome Web Store and to Firefox Add-ons (AMO). Each store
reviews a submission before it goes live.

## Releasing

1. Bump `version` in `package.json` in a PR and merge it.
2. Create a GitHub release with tag `vX.Y.Z`, matching `package.json`. The workflow fails on a mismatch.
3. The workflow attaches `chrome.zip`, `firefox.zip` and `firefox-sources.zip` to the release and submits them for
   review. Each goes live once its store approves it.

## One-time setup: Chrome Web Store

### 1. Create the listing

The API can only update an existing item, so the first upload is manual.

1. Pay the one-time fee and turn on 2-step verification for the account at the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Build the zip: `bun run zip` (lands in `.output/`)
3. _Add new item_ → upload it. Fill in the listing from [`store/listing.md`](../store/listing.md), upload the images
   in [`store/`](../store) and submit for review. The item ID is in the dashboard URL
   (`…/devconsole/<publisher-id>/<extension-id>/edit`).

Once that version is approved, the next release goes through the workflow (bump the version first: the store rejects
an upload whose version isn't higher).

### 2. Get API credentials

Follow [Google's guide](https://developer.chrome.com/docs/webstore/using-api) (or
[this walkthrough](https://github.com/fregante/chrome-webstore-upload-keys)):

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Chrome Web Store API**.
2. Configure the OAuth consent screen (External, add yourself as a test user), then **publish the app to production**,
   otherwise the refresh token expires after 7 days.
3. Create an OAuth client ID. Note the client ID and secret.
4. Get a refresh token for the `https://www.googleapis.com/auth/chromewebstore` scope
   (the walkthrough above has a one-command helper).

### 3. Add repository secrets

_Settings → Secrets and variables → Actions_:

| Secret              | Value                                                     |
| ------------------- | --------------------------------------------------------- |
| `CWS_PUBLISHER_ID`  | Dashboard → _Publisher → Settings_ (not the extension ID) |
| `CWS_EXTENSION_ID`  | The item ID (from its dashboard URL)                      |
| `CWS_CLIENT_ID`     | OAuth client ID                                           |
| `CWS_CLIENT_SECRET` | OAuth client secret                                       |
| `CWS_REFRESH_TOKEN` | Refresh token                                             |

## One-time setup: Firefox Add-ons

Until the secrets below exist, the workflow's Firefox job skips itself with a warning.

### 1. Create the listing

The first version is uploaded by hand, which creates the add-on under the gecko id in `wxt.config.ts`
(`@my-prs-tab-group`, never change it).

1. Sign in at the [Developer Hub](https://addons.mozilla.org/developers/) (a Firefox account) and accept the
   distribution agreement.
2. Build: `bun run zip:firefox`. It writes `.output/chrome-my-prs-<version>-firefox.zip` and `…-sources.zip`.
3. _Submit a New Add-on_ → _On this site_ → upload the `-firefox.zip`. Platform: Firefox only (Android has no tab
   groups). When asked whether the code is generated or minified, answer **yes** and upload the `-sources.zip`: it holds
   `SOURCE_CODE_REVIEW.md` with the build steps reviewers follow.
4. Fill in the listing from the AMO section of [`store/listing.md`](../store/listing.md) and submit.

### 2. Get API credentials

[Developer Hub → Tools → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) → _Generate new
credentials_. The JWT issuer looks like `user:12345:67`.

### 3. Add repository secrets

| Secret               | Value      |
| -------------------- | ---------- |
| `FIREFOX_JWT_ISSUER` | JWT issuer |
| `FIREFOX_JWT_SECRET` | JWT secret |

Check them without submitting anything:

```sh
FIREFOX_JWT_ISSUER=… FIREFOX_JWT_SECRET=… bunx wxt submit --dry-run \
  --firefox-zip .output/*-firefox.zip --firefox-sources-zip .output/*-sources.zip --firefox-extension-id '@my-prs-tab-group'
```

## Store images

`store/mock.html` renders the screenshots from the built popup and options pages with fake data. After changing the
UI, regenerate them with `bun run store:images` (builds, then screenshots with headless Chrome; set `CHROME` if it's
not at the default macOS path).
