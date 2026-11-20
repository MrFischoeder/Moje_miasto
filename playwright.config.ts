import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1000, height: 650 } },
  webServer: [
    { command: 'npm run dev -w client -- --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npx tsx server/src/main.ts --port 8788', url: 'http://localhost:8788/api/sessions', reuseExistingServer: true, timeout: 60_000 },
  ],
});
