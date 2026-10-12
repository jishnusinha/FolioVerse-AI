import { defineConfig } from '@playwright/test';

// Locally a system browser can be used instead of downloading Playwright's build: PW_CHANNEL=chrome|msedge.
const channel = process.env.PW_CHANNEL || undefined;
const PORT = Number(process.env.PW_PORT || 4173);

export default defineConfig({
  testDir: './playwright',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' },
  },
  use: {
    channel,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'prototype', testMatch: /prototype\.spec\.js/ },
    { name: 'visual', testMatch: /visual\.spec\.js/, use: { baseURL: `http://localhost:${PORT}` } },
    { name: 'shell', testMatch: /shell\.spec\.js/, use: { baseURL: `http://localhost:${PORT}` } },
    { name: 'auth-upload', testMatch: /auth-upload\.spec\.js/, use: { baseURL: `http://localhost:${PORT}` } },
    { name: 'preview', testMatch: /gate\d+-preview\.spec\.js/, use: { baseURL: `http://localhost:${PORT}` } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
