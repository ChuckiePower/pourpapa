import { defineConfig, devices } from '@playwright/test'

/**
 * Tests de bout en bout en rendu mobile, sur une base Postgres locale
 * (voir README, « Tests »). L'heure est figée au mardi 20 octobre 2026, 15h40.
 */
const API_PORT = 54329
const APP_PORT = 4179
const DB = 'visites_e2e'
const PG = process.env.TEST_PG_ADMIN_URL ?? 'postgres://dev:dev@127.0.0.1:5432/postgres'
const dbUrl = (() => {
  const u = new URL(PG)
  u.pathname = `/${DB}`
  return u.toString()
})()

export const E2E_ENV = { DEV_DB_NAME: DB, TEST_PG_ADMIN_URL: PG }
export const API = `http://127.0.0.1:${API_PORT}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    ...devices['iPhone 13'],
    deviceScaleFactor: 2,
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    serviceWorkers: 'allow',
  },
  webServer: [
    {
      command: 'node scripts/seed-dev.mjs && node scripts/dev-api.mjs',
      url: `${API}/health`,
      reuseExistingServer: false,
      env: { ...E2E_ENV, DEV_DATABASE_URL: dbUrl, DEV_API_PORT: String(API_PORT), DEV_NOW: '2026-10-20 15:40:00' },
      timeout: 60_000,
    },
    {
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${APP_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: 'e2e-anon-key', VITE_REALTIME: 'off' },
      timeout: 120_000,
    },
  ],
})
