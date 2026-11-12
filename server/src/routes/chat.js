import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { col } from '../db/mongo.js';
import { HttpError, oid, parse, sleep, truncate } from '../lib/http.js';
import { requirePermission } from '../auth/session.js';
import { can, canUseProject, platformAllowed } from '../auth/permissions.js';
import { enqueue } from '../services/queue.js';
import { saveConversation, serializeMessage } from '../services/conversations.js';
import { defaultSuggestions, getKnowledge } from '../services/knowledge.js';
import { greetingText, helpText, parseCommand } from '../channels/commands.js';
import { messageResult } from '../ai/pipeline.js';
import {
  MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, findUploadForViewer, findUploads, markAttached, openUploadStream, publicUpload, saveUpload,
} from '../services/uploads.js';

export const chatRouter = express.Router();
chatRouter.use(requirePermission('chat.use'));

const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { error: "You're asking very quickly. Wait a moment and try again." },
});

async function projectFor(user, projectId) {
  const project = await col.projects().findOne({ _id: oid(projectId, 'project') });
  if (!project || project.isActive === false || !canUseProject(user, project._id)) throw new HttpError(403, "You don't have access to that project.");
  return project;
}

const publicThread = (t) => ({ id: String(t._id), title: t.title, projectId: String(t.project_id), updatedAt: t.updated_at });

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A short excerpt of `text` centred on the first match of `re`.
function snippet(text, re) {
  const at = text.search(re);
  if (at < 0) return null;
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + 90);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

chatRouter.get('/threads', async (req, res) => {
  const { projectId, q } = parse(z.object({ projectId: z.string().optional(), q: z.string().trim().max(100).optional() }), req.query);
  const filter = { account_id: req.user._id, archived: { $ne: true } };
  if (projectId) filter.project_id = oid(projectId, 'project');
  if (!q) {
    const threads = await col.threads().find(filter).sort({ updated_at: -1 }).limit(100).toArray();
    return res.json(threads.map(publicThread));
  }

  // Search matches chat titles and the questions and answers inside each chat.
  const re = new RegExp(escapeRegex(q), 'i');
  const hits = await col.conversations()
    .find(
      { account_id: req.user._id, thread_id: { $ne: null }, ...(filter.project_id && { project_id: filter.project_id }), $or: [{ question: re }, { response: re }] },
      { projection: { thread_id: 1, question: 1, response: 1 } },
    )
    .sort({ created_at: -1 }).limit(500).toArray();
  const matches = new Map();
  for (const h of hits) {
    const key = String(h.thread_id);
    if (matches.has(key)) continue;
    matches.set(key, snippet(String(h.question || ''), re) || (typeof h.response === 'string' ? snippet(h.response, re) : null));
  }
  filter.$or = [{ title: re }, { _id: { $in: [...matches.keys()].map((id) => new ObjectId(id)) } }];
  const threads = await col.threads().find(filter).sort({ updated_at: -1 }).limit(50).toArray();
  res.json(threads.map((t) => ({ ...publicThread(t), match: re.test(t.title) ? null : matches.get(String(t._id)) || null })));
});

chatRouter.get('/threads/:id/messages', async (req, res) => {
  const thread = await col.threads().findOne({ _id: oid(req.params.id, 'thread'), account_id: req.user._id });
  if (!thread) throw new HttpError(404, 'That conversation was not found.');
  const docs = await col.conversations().find({ thread_id: thread._id }).sort({ created_at: 1 }).limit(200).toArray();
  res.json({ thread: publicThread(thread), messages: await Promise.all(docs.map((d) => serializeMessage(d, req.user))) });
});

chatRouter.patch('/threads/:id', async (req, res) => {
  const { title } = parse(z.object({ title: z.string().trim().min(1).max(120) }), req.body);
  const { matchedCount } = await col.threads().updateOne({ _id: oid(req.params.id, 'thread'), account_id: req.user._id }, { $set: { title } });
  if (!matchedCount) throw new HttpError(404, 'That conversation was not found.');
  res.json({ ok: true });
});

chatRouter.delete('/threads/:id', async (req, res) => {
  await col.threads().updateOne({ _id: oid(req.params.id, 'thread'), account_id: req.user._id }, { $set: { archived: true } });
  res.json({ ok: true });
});

chatRouter.get('/suggestions', async (req, res) => {
  const project = await projectFor(req.user, req.query.projectId);
  res.json(defaultSuggestions(await getKnowledge(project._id)));
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user._id),
  message: { error: "You're uploading a lot of files. Wait a few minutes and try again." },
});

// The file is the raw request body (sent as application/octet-stream so the global
// JSON parser leaves it alone); its name and real type travel in headers.
const rawBody = express.raw({ type: () => true, limit: MAX_FILE_BYTES });
const readFile = (req, res, next) => rawBody(req, res, (err) => next(
  err?.type === 'entity.too.large' ? new HttpError(413, `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`) : err,
));

chatRouter.post('/uploads', uploadLimiter, readFile, async (req, res) => {
  const { projectId } = parse(z.object({ projectId: z.string() }), req.query);
  const project = await projectFor(req.user, projectId);
  let filename = req.get('X-File-Name') || 'file';
  try { filename = decodeURIComponent(filename); } catch { /* keep as sent */ }
  const upload = await saveUpload({
    account: req.user,
    projectId: project._id,
    filename,
    declaredType: String(req.get('X-File-Type') || '').split(';')[0].trim().toLowerCase(),
    body: Buffer.isBuffer(req.body) ? req.body : null,
  });
  res.status(201).json(upload);
});

// Owners can open their own files; reviewers with conversation access can open files in projects they can see.
chatRouter.get('/uploads/:id', async (req, res) => {
  oid(req.params.id, 'file');
  let file = await findUploadForViewer(req.params.id, req.user);
  if (!file && can(req.user, 'conversations.view')) {
    const any = await findUploadForViewer(req.params.id, null);
    if (any && canUseProject(req.user, any.metadata.project_id)) file = any;
  }
  if (!file) throw new HttpError(404, 'That file was not found.');
  const { kind } = publicUpload(file);
  res.set({
    'Content-Type': file.metadata.contentType,
    'Content-Length': String(file.length),
    'Content-Disposition': `${kind === 'text' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'Cache-Control': 'private, max-age=86400',
  });
  // Lock the response down; PDFs are left on the app's normal policy because a sandboxed
  // document can't use the browser's built-in PDF viewer.
  if (kind !== 'document') res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  openUploadStream(file._id).on('error', () => res.destroy()).pipe(res);
});

const defaultQuestion = (files) => {
  const images = files.every((f) => publicUpload(f).kind === 'image');
  if (images) return files.length > 1 ? 'What can you see in these images? Point out any safety issues.' : 'What can you see in this image? Point out any safety issues.';
  return files.length > 1 ? 'Summarise these files.' : 'Summarise this file.';
};

chatRouter.post('/ask', askLimiter, async (req, res) => {
  const body = parse(z.object({
    projectId: z.string(),
    question: z.string().trim().max(1000).default(''),
    threadId: z.string().optional(),
    attachments: z.array(z.string()).max(MAX_FILES, `Attach up to ${MAX_FILES} files per question.`).default([]),
  }), req.body);
  if (!platformAllowed(req.user, 'Web Portal')) throw new HttpError(403, "Web Portal access isn't enabled for your account.");
  const project = await projectFor(req.user, body.projectId);

  const files = body.attachments.length ? await findUploads(req.user, [...new Set(body.attachments)]) : [];
  if (files.reduce((sum, f) => sum + f.length, 0) > MAX_TOTAL_BYTES) {
    throw new HttpError(413, `Attachments can add up to ${MAX_TOTAL_BYTES / 1024 / 1024} MB per question.`);
  }
  if (!body.question && !files.length) throw new HttpError(400, 'Type a question or attach a file.');
  const question = body.question || defaultQuestion(files);
  const attachments = files.map(publicUpload);

  const now = new Date();
  let thread;
  if (body.threadId) {
    thread = await col.threads().findOne({ _id: oid(body.threadId, 'thread'), account_id: req.user._id });
    if (!thread) throw new HttpError(404, 'That conversation was not found.');
    if (String(thread.project_id) !== String(project._id)) throw new HttpError(400, 'This conversation belongs to another project.');
    await col.threads().updateOne({ _id: thread._id }, { $set: { updated_at: now } });
  } else {
    thread = { _id: new ObjectId(), account_id: req.user._id, project_id: project._id, title: truncate(body.question || attachments[0]?.name || question, 80), created_at: now, updated_at: now };
    await col.threads().insertOne(thread);
  }

  const payload = {
    platform: 'Web Portal',
    account_id: String(req.user._id),
    project_id: String(project._id),
    thread_id: String(thread._id),
    question,
    user_id: String(req.user._id),
    ...(attachments.length && { attachments }),
  };
  if (files.length) await markAttached(files.map((f) => f._id));

  // Greetings and help are answered instantly, without spending tokens.
  const command = files.length ? null : parseCommand(question);
  if (command === 'greeting' || command === 'help' || command === 'current') {
    const text = command === 'greeting' ? greetingText(req.user, project)
      : command === 'help' ? helpText('Web Portal', project)
        : `You're on ${project.name}. Use the project menu to switch.`;
    const doc = await saveConversation({ payload, account: req.user, project, result: messageResult(text), status: 'answered' });
    return res.json({ threadId: String(thread._id), message: await serializeMessage(doc, req.user) });
  }

  const task = await enqueue(payload);
  return res.status(202).json({ threadId: String(thread._id), taskId: task.task_id });
});

// Server-sent events: stage updates while the worker runs, then the finished message.
chatRouter.get('/tasks/:taskId/events', async (req, res) => {
  const task = await col.tasks().findOne({ task_id: req.params.taskId });
  if (!task || task.payload?.account_id !== String(req.user._id)) throw new HttpError(404, 'Not found.');

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let closed = false;
  req.on('close', () => { closed = true; });
  const deadline = Date.now() + 180_000;
  let lastStage = null;
  let lastPing = Date.now();

  while (!closed) {
    const t = await col.tasks().findOne({ task_id: task.task_id }, { projection: { status: 1, stage: 1, conversation_id: 1, error: 1 } });
    if (t.stage !== lastStage) {
      lastStage = t.stage;
      send('stage', { stage: t.stage });
    }
    if (t.status === 'Completed' || t.status === 'Failed') {
      const conversation = t.conversation_id ? await col.conversations().findOne({ _id: t.conversation_id }) : null;
      if (conversation) send('result', await serializeMessage(conversation, req.user));
      else send('failure', { message: t.error || 'Something went wrong. Try again.' });
      break;
    }
    if (Date.now() > deadline) {
      send('failure', { message: 'This is taking longer than expected. Refresh in a moment to see the answer.' });
      break;
    }
    if (Date.now() - lastPing > 15_000) {
      res.write(': ping\n\n');
      lastPing = Date.now();
    }
    await sleep(500);
  }
  res.end();
});

chatRouter.post('/messages/:id/feedback', async (req, res) => {
  const { value, comment } = parse(z.object({
    value: z.enum(['up', 'down']).nullable(),
    comment: z.string().trim().max(500).optional(),
  }), req.body);
  const { matchedCount } = await col.conversations().updateOne(
    { _id: oid(req.params.id, 'message'), account_id: req.user._id },
    { $set: { feedback: value ? { value, comment: comment || null, at: new Date() } : null } },
  );
  if (!matchedCount) throw new HttpError(404, 'That message was not found.');
  res.json({ ok: true });
});
