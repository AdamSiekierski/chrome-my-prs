// Renders the Chrome Web Store images (store/*.png) from the built popup and options pages.
// Serves .output/chrome-mv3 at the root with store/mock.html next to it, then screenshots it with headless Chrome.
import { $ } from 'bun';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = join(import.meta.dir, '..');

await $`bun run build`.cwd(root);

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const path = pathname.startsWith('/store/') ? join(root, pathname) : join(root, '.output/chrome-mv3', pathname);
    const file = Bun.file(path);
    return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
  },
});

const shots = [
  ['popup', '1280,800', 'screenshot-popup.png'],
  ['options', '1280,800', 'screenshot-options.png'],
  ['tile', '440,280', 'promo-small.png'],
] as const;
try {
  for (const [shot, size, file] of shots) {
    await $`${CHROME} --headless=new --hide-scrollbars --force-device-scale-factor=1 --blink-settings=preferredColorScheme=1 --virtual-time-budget=4000 --window-size=${size} --screenshot=${join(root, 'store', file)} ${`${server.url}store/mock.html?shot=${shot}`}`.quiet();
    console.log(`store/${file}`);
  }
} finally {
  server.stop();
}
