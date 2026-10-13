# Chrome Web Store listing

Copy-paste source for the Developer Dashboard. Images are in this folder (`screenshot-*.png` are 1280×800,
`promo-small.png` is the 440×280 small promo tile; the store icon is `icons/128.png`).

## Store listing

**Summary** (from `manifest.json` `description`, max 132 chars)

> Keeps a Chrome tab group open with every open GitHub pull request you authored. No tracking, no server.

**Category:** Developer Tools · **Language:** English

**Description**

```
Every open GitHub pull request you authored, kept in one Chrome tab group.

Private by design:
• No tracking, no analytics, no ads. The extension has no server of its own.
• Your GitHub token stays in this browser and is only ever sent to api.github.com. It doesn't sync anywhere.
• The developer never receives any of your data, and nothing is sold or shared. Nothing runs on the pages you visit.
• Open source (MIT), so you can read every line: https://github.com/AdamSiekierski/chrome-my-prs

Safe with your tabs:
• A failed fetch never closes tabs. A network blip doesn't mean "you have no PRs".
• The tab you're looking at is never closed out from under you.
• Other tabs you drag into the group are left alone.

What it does:
• New PRs open as background tabs in the group. Merged and closed ones are removed.
• One GitHub search covers all your repos: personal, org, private.
• Hide a PR from the popup, or right-click a PR page → "Hide from My PRs group". Hides sync across your browsers.
• Optional extra search filter (e.g. org:my-company), draft toggle, group name and color.
• Optionally split PRs into one tab group per repository.
• Pause syncing any time from the popup.

Setup: paste a GitHub personal access token (classic, repo scope), or click "Sign in with GitHub" and approve a code.

GitHub repo: https://github.com/AdamSiekierski/chrome-my-prs
Privacy policy: https://github.com/AdamSiekierski/chrome-my-prs/blob/master/PRIVACY.md
```

## Privacy practices

**Single purpose**

> Keeps one Chrome tab group in sync with the open GitHub pull requests the user authored.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `tabs` | Open PR pages as tabs, close tabs of merged/closed PRs, and read tab URLs to tell which PRs already have a tab. |
| `tabGroups` | Create, find, name and color the tab group that holds the PR tabs. |
| `storage` | Keep the user's GitHub token and settings locally, and sync the list of hidden PRs across the user's browsers. |
| `alarms` | Re-check GitHub on the interval the user picks (default every 5 minutes). |
| `contextMenus` | Add "Hide from My PRs group" when right-clicking a PR page or link. |
| Host `https://api.github.com/*` | Search the user's open pull requests with their token. |
| Host `https://github.com/login/*` | Run GitHub's device sign-in flow for "Sign in with GitHub". |

**Remote code:** No, I am not using remote code.

**Data usage:** tick *Authentication information* (the GitHub token) and *Website content* (PR titles and URLs
fetched from GitHub). Certify all three disclosures (not sold, not used for unrelated purposes, not used for
creditworthiness).

**Privacy policy URL:** `https://github.com/AdamSiekierski/chrome-my-prs/blob/master/PRIVACY.md`
