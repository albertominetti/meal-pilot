// ConfigModule reads the environment when AppModule is imported, so the
// database URLs must be set here, before any test file loads.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  // Startup migrations run over the direct URL, as on Render's free plan.
  process.env.DATABASE_URL_DIRECT = process.env.TEST_DATABASE_URL;
}
