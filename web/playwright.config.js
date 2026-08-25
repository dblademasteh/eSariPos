import { defineConfig } from '@playwright/test';

// In CI the API server serves the built SPA on port 4000.
// Locally the Vite dev server runs on port 5173.
const baseURL = process.env.NOVAPOS_URL
  ? process.env.NOVAPOS_URL.replace(/\/api\/?$/, '')
  : 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CI
    ? undefined // API already running from prior CI step
    : {
        command: 'npm run dev',
        port: 5173,
        reuseExistingServer: true,
        timeout: 15_000,
      },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
