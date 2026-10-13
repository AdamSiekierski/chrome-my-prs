# Privacy policy

*My PRs Tab Group* has no server, no analytics and no tracking. Its developer never receives any of your data.

## What it stores, and where

- **Your GitHub token** (pasted, or from *Sign in with GitHub*) is kept in Chrome's local extension storage
  (`chrome.storage.local`) on your computer. It does not sync to other machines.
- **Settings** (group name and color, search filter, sync interval) and the **last fetched list of your open PRs**
  are kept in the same local storage.
- **Hidden PRs** (repository name and PR number, plus when you hid it) are kept in `chrome.storage.sync`, so Chrome
  syncs them across your signed-in browsers. Each one is deleted 30 days after the PR closes.

## What it sends, and to whom

The extension talks to GitHub only:

- `api.github.com`: your token, to search your open pull requests and check your organization memberships.
- `github.com/login`: only during *Sign in with GitHub*, to run GitHub's device sign-in flow.

GitHub's own [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
covers those requests. Nothing is sent anywhere else, and no data is sold or shared with anyone.

## Removing your data

Clear the token in the extension's settings, or uninstall the extension, which deletes everything it stored. To revoke
access on GitHub's side, delete the token at <https://github.com/settings/tokens>, or revoke the *My PRs* app at
<https://github.com/settings/applications>.

## Contact

Open an issue at <https://github.com/AdamSiekierski/chrome-my-prs/issues>.
