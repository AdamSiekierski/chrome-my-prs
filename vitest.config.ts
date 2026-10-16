import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // e2e/ is Playwright's (bun run e2e).
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
});
