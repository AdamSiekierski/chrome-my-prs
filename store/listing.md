# Store listings

Chrome Web Store first, Firefox Add-ons (AMO) below.

Copy-paste source for the Developer Dashboard. Images are in this folder (`screenshot-*.png` are 1280×800,
`promo-small.png` is the 440×280 small promo tile; the store icon is `icons/128.png`).

## Store listing

**Summary** (from the `description` in `wxt.config.ts`, max 132 chars)

> Keeps a tab group open with every open GitHub pull request and GitLab merge request you authored. No tracking.

**Category:** Developer Tools · **Language:** English

**Description**

```
Every open GitHub pull request and GitLab merge request you authored, kept in one Chrome tab group.

Private by design:
• No tracking, no analytics, no ads. The extension has no server of its own.
• Your GitHub token stays in this browser and is only ever sent to api.github.com. Each GitLab token is only sent to its own GitLab instance. Neither syncs anywhere.
• The developer never receives any of your data, and nothing is sold or shared. Nothing runs on the pages you visit.
• Open source (MIT), so you can read every line: https://github.com/AdamSiekierski/chrome-my-prs

Safe with your tabs:
• A failed fetch never closes tabs. A network blip doesn't mean "you have no PRs".
• The tab you're looking at is never closed out from under you.
• Other tabs in the group are never closed: left alone, or moved out of the group if you turn that on.

What it does:
• New PRs open as background tabs in the group. Merged and closed ones are removed.
• One GitHub search covers all your repos: personal, org, private.
• GitLab merge requests too, from gitlab.com and any number of self-hosted GitLab instances.
• Hide a PR from the popup, or right-click a PR page → "Hide from My PRs group". Hides sync across your browsers.
• Optional extra search filter (e.g. org:my-company), draft toggle, group name and color.
• Optionally split PRs into one tab group per repository.
• Pause syncing any time from the popup.

Setup: paste a GitHub personal access token (classic, repo scope), or click "Sign in with GitHub" and approve a code. For GitLab, add each instance's URL and a token with the read_api scope.

GitHub repo: https://github.com/AdamSiekierski/chrome-my-prs
Privacy policy: https://github.com/AdamSiekierski/chrome-my-prs/blob/master/PRIVACY.md
```

## Privacy practices

**Single purpose**

> Keeps one Chrome tab group in sync with the open GitHub pull requests and GitLab merge requests the user authored.

**Permission justifications**

| Permission                                | Justification                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                                    | Open PR pages as tabs, close tabs of merged/closed PRs, and read tab URLs to tell which PRs already have a tab.                                                                        |
| `tabGroups`                               | Create, find, name and color the tab group that holds the PR tabs.                                                                                                                     |
| `storage`                                 | Keep the user's GitHub token and settings locally, and sync the list of hidden PRs across the user's browsers.                                                                         |
| `alarms`                                  | Re-check GitHub on the interval the user picks (default every 5 minutes).                                                                                                              |
| `contextMenus`                            | Add "Hide from My PRs group" when right-clicking a PR page or link.                                                                                                                    |
| Host `https://api.github.com/*`           | Search the user's open pull requests with their token.                                                                                                                                 |
| Host `https://github.com/login/*`         | Run GitHub's device sign-in flow for "Sign in with GitHub".                                                                                                                            |
| Optional host `https://*/*`, `http://*/*` | Only requested if the user sets up GitLab, and only for the GitLab instances they add (gitlab.com or self-hosted, at any address), to list their open merge requests with their token. |

**Remote code:** No, I am not using remote code.

**Data usage:** tick _Authentication information_ (the GitHub and GitLab tokens) and _Website content_ (PR titles and URLs
fetched from GitHub and GitLab). Certify all three disclosures (not sold, not used for unrelated purposes, not used for
creditworthiness).

**Privacy policy URL:** `https://github.com/AdamSiekierski/chrome-my-prs/blob/master/PRIVACY.md`

## Firefox Add-ons (AMO)

Paste into the [Developer Hub](https://addons.mozilla.org/developers/) listing. Use the same images.

**Name:** My PRs Tab Group · **Summary:** the `description` from `wxt.config.ts` (same as Chrome's summary above)

**Categories:** Tabs, Other · **Platform:** Firefox only

**Description:** the Chrome description above, with "Chrome tab group" → "tab group" and "Hides sync across your
browsers" → "Hides sync across your Firefox installs (Firefox Sync)". Needs Firefox 140 or later.

**Privacy policy:** paste the text of [`PRIVACY.md`](../PRIVACY.md) (AMO takes the policy text, not a link).

**Data collection** (declared in the manifest, shown at install): _Authentication information_. The tokens are sent to
GitHub and the user's GitLab instances to list their PRs. Nothing goes to the developer.

**Notes to reviewer:**

```
Built with WXT (Vite) from TypeScript; build steps are in SOURCE_CODE_REVIEW.md in the sources zip
(mise install && bun install --frozen-lockfile && bun run zip:firefox). No remote code.

To test without a GitHub account's PRs: settings → paste any GitHub token with repo scope, or use
"Sign in with GitHub". The extension then opens your open PRs as tabs in a tab group named "My PRs".
Network requests go only to api.github.com, github.com/login (device sign-in) and GitLab instances the user adds
(optional host permission, requested per instance).
```
