import { loadConfig } from './config/env.js';
import { createDatabase } from './infrastructure/database.js';
import { createApp } from './app.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  const { app, ready } = createApp(db, config);
  await ready;
  const server = app.listen(config.PORT, '127.0.0.1', () => console.log(`API listening on http://127.0.0.1:${config.PORT}`));
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    server.close(() => { void db.$disconnect().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error && error.message.startsWith('Invalid environment') ? error.message : 'API startup failed. Check database access and configuration.');
  process.exitCode = 1;
});
