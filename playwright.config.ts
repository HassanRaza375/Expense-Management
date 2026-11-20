import { defineConfig, devices } from "@playwright/test";

// The servers under test can reach no real service, whatever the shell or a local .env holds. `.invalid` never resolves and every service key is blank
// (tests/noServices.test.ts and e2e/services.spec.ts check this file's intent).
const NO_SERVICES = {
  DATABASE_URL: "postgres://blocked.invalid:5432/none",
  DATABASE_CA_CERT: "",
  DATABASE_CA_FILE: "",
  BETTER_AUTH_SECRET: "",
  BETTER_AUTH_URL: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  CLOUDINARY_URL: "",
  CLOUDINARY_CLOUD_NAME: "",
  CLOUDINARY_API_KEY: "",
  CLOUDINARY_API_SECRET: "",
  RESEND_API_KEY: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  EMAIL_FROM: "",
  ADMIN_SEED_EMAIL: "",
  ADMIN_SEED_PASSWORD: "",
};

// Runs against the PRODUCTION build (offline and the service worker do not work in dev):
//   NUXT_PUBLIC_SYNC_ENABLED=0 npm run build && npm run test:e2e        (or simply `npm run verify`)
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker, fixed, and no retries: a test that passes only on a second try is a flake we want to see. Run it on an idle machine.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  use: {
    // the installed Chrome, so no browser download is needed
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:3011",
    timezoneId: "Asia/Karachi",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  webServer: [
    {
      // the app as production runs it today: sync off
      command: "node .output/server/index.mjs",
      env: { PORT: "3011", NITRO_PORT: "3011", NUXT_PUBLIC_SYNC_ENABLED: "false", ...NO_SERVICES },
      url: "http://localhost:3011",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // the same build with the SERVER's sync flag on (read at request time), for the API routes only. Its database cannot resolve.
      command: "node .output/server/index.mjs",
      env: { PORT: "3013", NITRO_PORT: "3013", NUXT_PUBLIC_SYNC_ENABLED: "1", ...NO_SERVICES },
      url: "http://localhost:3013",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
