import { loadConfig } from './config/env.js';
import { createDatabase } from './infrastructure/database.js';
import { createApp } from './app.js';
import { createAttemptEngine } from './modules/attempts/engine.js';
import { createAiWorker } from './modules/ai/worker.js';
import { createGeminiProvider } from './modules/ai/provider.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  const { app, ready } = createApp(db, config);
  await ready;
  const stopAi = createAiWorker(db, config, createGeminiProvider(config)).start();
  const engine = createAttemptEngine(db);
  let expiring = false;
  const expiryTimer = setInterval(() => {
    if (expiring) return;
    expiring = true;
    void engine.expire().catch(() => console.error('Attempt expiry sweep failed; it will retry.')).finally(() => { expiring = false; });
  }, 15_000);
  expiryTimer.unref();
  const server = app.listen(config.PORT, config.HOST, () => console.log(`API listening on http://${config.HOST}:${config.PORT}`));
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    stopAi();
    clearInterval(expiryTimer);
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
