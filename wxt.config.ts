import { defineConfig } from 'wxt';

// Manifest fields WXT can't infer. The version comes from package.json.
export default defineConfig({
  // Explicit imports keep every file readable (and lintable) without generated globals.
  imports: false,
  // Firefox too: its tab group APIs are MV3-era, and one manifest shape keeps the browsers alike.
  manifestVersion: 3,
  // The Firefox sources zip (for AMO review) holds what's needed to rebuild, not tests or store assets.
  zip: { excludeSources: ['e2e/**', 'store/**', 'docs/**', 'test-results/**', 'playwright.config.ts'] },
  manifest: ({ browser }) => ({
    name: 'My PRs Tab Group',
    description:
      'Keeps a tab group open with every open GitHub pull request and GitLab merge request you authored. No tracking.',
    permissions: ['tabs', 'tabGroups', 'storage', 'alarms', 'contextMenus'],
    host_permissions: ['https://api.github.com/*', 'https://github.com/login/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    homepage_url: 'https://github.com/AdamSiekierski/chrome-my-prs',
    action: {
      default_title: 'My PRs',
      default_icon: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' },
    },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // Permanent: AMO ties the listing, updates and storage.sync to this id.
              id: '@my-prs-tab-group',
              // tabGroups API: 139. data_collection_permissions: 140 (also the current ESR).
              strict_min_version: '140.0',
              // The tokens leave the browser, to GitHub/GitLab. Same answer as the Chrome Web Store privacy form.
              data_collection_permissions: { required: ['authenticationInfo'] },
            },
          },
        }
      : { minimum_chrome_version: '120' }),
  }),
});
