import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/server',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.MODELBOARD_SERVER_URL || 'http://127.0.0.2:8080',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
