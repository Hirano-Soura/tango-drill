// Screen checks (Playwright). Outside the three always-run checks (CLAUDE.md section 1): run at milestones.
// Usage: npm run e2e   Report: Temp/tango-drill_e2e.json (+ list output on the console).
// The browser is the Edge installed on the machine (no browser download). Set PW_CHANNEL to use another
// installed channel (e.g. chrome), or PW_CHANNEL=chromium after `npx playwright install chromium`.
// Keep this file ASCII-only (UE-1).
import { defineConfig } from '@playwright/test';

const channel = process.env.PW_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  outputDir: 'Temp/e2e-results',
  reporter: [['list'], ['json', { outputFile: 'Temp/tango-drill_e2e.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:8766',
    ...(channel === 'chromium' ? {} : { channel }),
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1000, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node Tools/Dev/serve.mjs 8766',
    url: 'http://127.0.0.1:8766/index.html',
    reuseExistingServer: false,
  },
});
