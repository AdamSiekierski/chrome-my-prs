# Building from source (for Firefox Add-ons reviewers)

The add-on is built with [WXT](https://wxt.dev) (Vite) from the TypeScript in this archive. Nothing is fetched at
runtime: no remote code.

Requirements: macOS or Linux, [mise](https://mise.jdx.dev) (it installs the bun version pinned in `mise.toml`).
Without mise, install [bun](https://bun.sh) 1.4.3 directly.

```sh
mise install            # bun, pinned in mise.toml
bun install --frozen-lockfile
bun run zip:firefox     # → .output/chrome-my-prs-<version>-firefox.zip, unpacked in .output/firefox-mv3/
```

The contents of `.output/firefox-mv3/` are the files in the submitted add-on.

- `entrypoints/background.ts`: background script (sync loop, tab groups)
- `entrypoints/popup/`, `entrypoints/options/`: the toolbar popup and the settings page
- `utils/`: settings storage and the GitHub/GitLab API clients
- `wxt.config.ts`: the manifest
