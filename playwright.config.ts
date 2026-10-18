import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
if (existsSync('.env')) process.loadEnvFile('.env');
export default defineConfig({
  testDir: './tests/e2e', timeout: 45000, workers: 1,
  webServer: { command: 'npm run dev', url: 'http://localhost:3001/api/health', reuseExistingServer: !process.env.CI, timeout: 60000 },
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
