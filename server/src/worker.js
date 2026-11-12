// Standalone worker: `npm run worker`. Answers queued questions for every channel.
import { connectMongo, closeMongo } from './db/mongo.js';
import { closeMysql } from './db/mysql.js';
import { startWorker } from './services/queue.js';

await connectMongo();
const stop = startWorker();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stop();
    await Promise.allSettled([closeMongo(), closeMysql()]);
    process.exit(0);
  });
}
