// No unit test may reach a real service (the database host, Cloudinary, Google, an email provider): every credential is blanked before a test runs,
// whatever the shell or a local .env holds. (tests/noServices.test.ts checks this file.)
for (const name of [
  "DATABASE_URL",
  "DATABASE_CA_CERT",
  "DATABASE_CA_FILE",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CLOUDINARY_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM",
  "ADMIN_SEED_EMAIL",
  "ADMIN_SEED_PASSWORD",
]) {
  process.env[name] = "";
}
process.env.NUXT_PUBLIC_SYNC_ENABLED = "0";
