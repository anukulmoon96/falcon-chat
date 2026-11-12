import { config } from './config.js';
import { logger } from './lib/http.js';
import { closeMongo, connectMongo } from './db/mongo.js';
import { closeMysql } from './db/mysql.js';
import { createApp } from './app.js';
import { startWorker } from './services/queue.js';

await connectMongo();
const server = createApp().listen(config.port, () => {
  logger.info({ port: config.port, whatsapp: config.whatsapp.enabled, teams: config.teams.enabled }, 'Falcon server listening');
});
// Run the worker in-process by default. For scale, set WORKER_ENABLED=false here
// and run `npm run worker` as separate processes.
const stopWorker = config.worker.enabled ? startWorker() : null;

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  stopWorker?.();
  server.close();
  await Promise.allSettled([closeMongo(), closeMysql()]);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
