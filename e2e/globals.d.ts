import type { Browser } from 'wxt/browser';

declare global {
  // The extension APIs, inside callbacks that run in the extension (sw.evaluate(), page.evaluate(), ff.run()).
  const chrome: typeof Browser;
  const browser: typeof Browser;
}
