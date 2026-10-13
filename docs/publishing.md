# Publishing to the Chrome Web Store

[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) ships two listings:

| Trigger | Listing | Version | Who sees it |
| --- | --- | --- | --- |
| Push to `master` touching extension files | *My PRs Tab Group (Beta)* | `X.Y.Z.<run number>` | Trusted testers |
| GitHub release published | *My PRs Tab Group* | `X.Y.Z` from `manifest.json` | Everyone |

The Web Store API (v2) can't pick testers vs public per upload; visibility is a setting on each listing, so testers
get their own beta listing. Every upload still goes through Google's review before it reaches anyone.

## Releasing

1. Bump `version` in `manifest.json` in a PR and merge it (testers get it as `X.Y.Z.<n>`).
2. Create a GitHub release with tag `vX.Y.Z`, matching the manifest. The workflow fails on a mismatch.
3. The workflow attaches `extension.zip` to the release and submits it for review. It goes live once approved.

## One-time setup

### 1. Create both listings

The API can only update existing items, so the first upload is manual.

1. Pay the one-time fee and turn on 2-step verification for the account at the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Publish a GitHub release `v1.0.0`. The upload step is skipped (no secrets yet), but `extension.zip` gets attached.
3. **Public:** *Add new item* → upload that zip. Fill in the listing from [`store/listing.md`](../store/listing.md)
   and upload the images in [`store/`](../store). Visibility: *Public*. Submit for review.
4. **Beta:** *Add new item* → upload the same zip again. Same listing, name it as beta in the description.
   Visibility: *Private* → *Trusted testers*, and add tester emails (or a Google Group) under
   *Account → Trusted testers* in the dashboard. Submit for review.
   Testers install it from its store link; it can be installed next to the public one.

After changing a listing's visibility in the dashboard, publish it once by hand there; the API refuses until you do.

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
| `CWS_EXTENSION_ID` | Public item's ID (from its dashboard URL) |
| `CWS_BETA_EXTENSION_ID` | Beta item's ID |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token |

Until an extension ID secret is set, the matching upload step is skipped instead of failing.

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
