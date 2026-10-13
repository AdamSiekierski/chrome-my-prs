# Publishing to the Chrome Web Store

Publishing a GitHub release runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml): it zips the
extension, attaches the zip to the release and submits it to the Chrome Web Store. Google reviews it before it goes live.

## Releasing

1. Bump `version` in `manifest.json` in a PR and merge it.
2. Create a GitHub release with tag `vX.Y.Z`, matching the manifest. The workflow fails on a mismatch.
3. The workflow attaches `extension.zip` to the release and submits it for review. It goes live once approved.

## One-time setup

### 1. Create the listing

The API can only update an existing item, so the first upload is manual.

1. Pay the one-time fee and turn on 2-step verification for the account at the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Build the zip: `zip -r extension.zip manifest.json *.js *.html *.css icons lib`
3. *Add new item* → upload it. Fill in the listing from [`store/listing.md`](../store/listing.md), upload the images
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

*Settings → Secrets and variables → Actions*:

| Secret | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | Dashboard → *Publisher → Settings* (not the extension ID) |
| `CWS_EXTENSION_ID` | The item ID (from its dashboard URL) |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token |

## Store images

`store/mock.html` renders the screenshots from the real popup and options pages with fake data. After changing the
UI, regenerate them:

```sh
python3 -m http.server 8765 &
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shoot() { "$C" --headless=new --hide-scrollbars --force-device-scale-factor=1 --blink-settings=preferredColorScheme=1 \
  --virtual-time-budget=4000 --window-size=$2 --screenshot="$PWD/store/$3" "http://localhost:8765/store/mock.html?shot=$1"; }
shoot popup 1280,800 screenshot-popup.png
shoot options 1280,800 screenshot-options.png
shoot tile 440,280 promo-small.png
kill %1
```
