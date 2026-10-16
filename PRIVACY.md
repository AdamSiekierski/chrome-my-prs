# Privacy policy

_My PRs Tab Group_ has no server, no analytics and no tracking. Its developer never receives any of your data.

## What it stores, and where

- **Your GitHub token** (pasted, or from _Sign in with GitHub_) and **GitLab tokens** are kept in the browser's local extension storage
  (`storage.local`) on your computer. It does not sync to other machines.
- **Settings** (group name and color, search filter, sync interval) and the **last fetched list of your open PRs**
  are kept in the same local storage.
- **Hidden PRs** (repository name and PR number, plus when you hid it) are kept in `storage.sync`, so your browser
  syncs them across your signed-in browsers (Chrome sync, or Firefox Sync). Each one is deleted 30 days after the PR closes.

## What it sends, and to whom

The extension talks to GitHub, and to GitLab only if you set it up:

- `api.github.com`: your token, to search your open pull requests and check your organization memberships.
- `github.com/login`: only during _Sign in with GitHub_, to run GitHub's device sign-in flow.
- Each GitLab instance you add in settings (gitlab.com or your own): that instance's token, to list your open merge
  requests there.

GitHub's own [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
covers the GitHub requests; your GitLab provider's policy covers the GitLab ones. Nothing is sent anywhere else, and no data is sold or shared with anyone.

## Removing your data

Clear the tokens in the extension's settings, or uninstall the extension, which deletes everything it stored. To revoke
access on GitHub's side, delete the token at <https://github.com/settings/tokens>, or revoke the _My PRs_ app at
<https://github.com/settings/applications>. GitLab tokens are revoked under _User settings → Access tokens_.

## Contact

Open an issue at <https://github.com/AdamSiekierski/chrome-my-prs/issues>.
