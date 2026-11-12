import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { UserFacingError, logger, oid } from '../lib/http.js';
import { answerQuestion, messageResult } from '../ai/pipeline.js';
import { saveConversation } from './conversations.js';
import { deliver } from '../channels/deliver.js';
import { removeAbandonedUploads } from './uploads.js';

// Only tasks created by this service are picked up, so anything else that
// writes to the shared `tasks` collection is left alone.
const SOURCE = 'falcon-v2';
let wake = () => {};

export async function enqueue(payload, { externalId } = {}) {
  const now = new Date();
  const task = {
    task_id: randomUUID(),
    source: SOURCE,
    type: 'question',
    status: 'Pending',
    stage: 'queued',
    payload,
    attempts: 0,
    result: null,
    created_at: now,
    updated_at: now,
  };
  if (externalId) task.external_id = externalId; // WhatsApp/Teams message id, for de-duplication
  try {
    await col.tasks().insertOne(task);
  } catch (err) {
    if (err.code === 11000) return null; // a redelivered webhook
    throw err;
  }
  wake();
  return task;
}

const update = (taskId, fields) => col.tasks().updateOne({ task_id: taskId }, { $set: { ...fields, updated_at: new Date() } });
export const setStage = (taskId, stage) => update(taskId, { stage });

function claim() {
  return col.tasks().findOneAndUpdate(
    { source: SOURCE, status: 'Pending' },
    { $set: { status: 'Processing', stage: 'starting', locked_at: new Date(), updated_at: new Date() }, $inc: { attempts: 1 } },
    { sort: { created_at: 1 }, returnDocument: 'after' },
  );
}

function recoverStale() {
  return col.tasks().updateMany(
    { source: SOURCE, status: 'Processing', locked_at: { $lt: new Date(Date.now() - 5 * 60_000) }, attempts: { $lt: 3 } },
    { $set: { status: 'Pending', stage: 'queued' } },
  );
}

const FRIENDLY_ERROR = "I couldn't answer that one. Try rephrasing it, or ask again in a moment.";

async function processTask(task) {
  const startedAt = new Date();
  const payload = task.payload;
  const [account, project] = await Promise.all([
    col.accounts().findOne({ _id: oid(payload.account_id) }),
    col.projects().findOne({ _id: oid(payload.project_id) }),
  ]);

  let conversation;
  try {
    const { result, meta } = await answerQuestion(task, { onStage: (stage) => setStage(task.task_id, stage) });
    conversation = await saveConversation({ task, payload, account, project, result, meta, status: 'answered', startedAt });
    await update(task.task_id, { status: 'Completed', stage: 'done', result: result.text, conversation_id: conversation._id });
  } catch (err) {
    const userFacing = err instanceof UserFacingError;
    logger.error({ err: err.message, sql: err.sql, taskId: task.task_id }, 'Task failed');
    const result = messageResult(userFacing ? err.message : FRIENDLY_ERROR, { kind: 'error' });
    conversation = await saveConversation({
      task, payload, account, project, result, status: 'failed', error: err.sqlMessage || err.message, startedAt,
    }).catch(() => null);
    await update(task.task_id, { status: 'Failed', stage: 'done', result: result.text, error: result.text, conversation_id: conversation?._id || null });
  }

  try {
    if (conversation) await deliver(task, conversation);
  } catch (err) {
    logger.error({ err: err.message, platform: payload.platform, taskId: task.task_id }, 'Delivery failed');
  }
}

export function startWorker() {
  let active = 0;
  let running = true;
  const tick = async () => {
    while (running && active < config.worker.concurrency) {
      const task = await claim();
      if (!task) return;
      active += 1;
      processTask(task)
        .catch((err) => logger.error({ err: err.message }, 'Worker error'))
        .finally(() => {
          active -= 1;
          wake();
        });
    }
  };
  wake = () => { tick().catch((err) => logger.error({ err: err.message }, 'Queue poll failed')); };
  recoverStale().catch(() => {});
  const timer = setInterval(wake, 750);
  const staleTimer = setInterval(() => {
    recoverStale().catch(() => {});
    removeAbandonedUploads().catch((err) => logger.warn({ err: err.message }, 'Upload cleanup failed'));
  }, 60_000);
  wake();
  logger.info({ concurrency: config.worker.concurrency }, 'Worker started');
  return () => {
    running = false;
    clearInterval(timer);
    clearInterval(staleTimer);
  };
}
