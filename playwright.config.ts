import { defineConfig } from '@playwright/test';

// Runs against the built extension: `bun run e2e` builds both browsers first. See .claude/skills/e2e-testing.
export default defineConfig({
  testDir: 'e2e',
  // Every test launches its own browser with a fresh profile, so they can run side by side.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: 'firefox.spec.ts' },
    { name: 'firefox', testMatch: 'firefox.spec.ts', timeout: 60_000 },
  ],
});
