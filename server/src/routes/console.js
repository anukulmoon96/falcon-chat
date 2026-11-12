import express from 'express';
import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { HttpError, escapeRegex, oid, toObjectIds } from '../lib/http.js';
import { requirePermission } from '../auth/session.js';
import { canUseProject, isAdmin } from '../auth/permissions.js';
import { displayName } from '../services/accounts.js';
import { inferPlatform, serializeMessage } from '../services/conversations.js';

export const consoleRouter = express.Router();
consoleRouter.use(requirePermission('console.view'));

// Sub-admins only ever see conversations from their own projects.
function baseMatch(user, projectId) {
  if (projectId) {
    if (!canUseProject(user, projectId)) throw new HttpError(403, "You don't have access to that project.");
    return { project_id: oid(projectId, 'project') };
  }
  return isAdmin(user) ? {} : { project_id: { $in: toObjectIds(user.projects) } };
}

const platformExpr = {
  $ifNull: ['$platform', {
    $cond: [{ $regexMatch: { input: { $ifNull: ['$message_id', ''] }, regex: '^wamid\\.' } }, 'WhatsApp', 'Unknown'],
  }],
};

consoleRouter.get('/overview', requirePermission('usage.view'), async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 180);
  const since = new Date(Date.now() - days * 86400_000);
  const match = { ...baseMatch(req.user, req.query.projectId), created_at: { $gte: since } };

  const [totals = {}] = await col.conversations().aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        questions: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        inputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
        avgLatencyMs: { $avg: '$latency_ms' },
        users: { $addToSet: '$user_id' },
        helpful: { $sum: { $cond: [{ $eq: ['$feedback.value', 'up'] }, 1, 0] } },
        unhelpful: { $sum: { $cond: [{ $eq: ['$feedback.value', 'down'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, questions: 1, failed: 1, inputTokens: 1, outputTokens: 1, avgLatencyMs: 1, helpful: 1, unhelpful: 1, activeUsers: { $size: '$users' } } },
  ]).toArray();

  const daily = await col.conversations().aggregate([
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: config.defaultTimezone } }, questions: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, day: '$_id', questions: 1 } },
  ]).toArray();

  const byPlatform = await col.conversations().aggregate([
    { $match: match },
    { $group: { _id: platformExpr, questions: { $sum: 1 } } },
    { $sort: { questions: -1 } },
    { $project: { _id: 0, platform: '$_id', questions: 1 } },
  ]).toArray();

  const byProject = await col.conversations().aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ['$project_id', '$project'] },
        name: { $last: '$project' },
        questions: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        tokens: { $sum: { $add: [{ $ifNull: ['$input_tokens', 0] }, { $ifNull: ['$output_tokens', 0] }] } },
        users: { $addToSet: '$user_id' },
      },
    },
    { $sort: { questions: -1 } },
    { $limit: 50 },
    { $project: { _id: 0, project: { $ifNull: ['$name', 'Unknown'] }, questions: 1, failed: 1, tokens: 1, users: { $size: '$users' } } },
  ]).toArray();

  res.json({ days, totals, daily, byPlatform, byProject });
});

consoleRouter.get('/conversations', requirePermission('conversations.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const filter = baseMatch(req.user, req.query.projectId);
  if (req.query.platform) filter.platform = req.query.platform;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.question = { $regex: escapeRegex(req.query.q), $options: 'i' };

  const [docs, total] = await Promise.all([
    col.conversations()
      .find(filter, { projection: { result: 0, executed_sql: 0 } })
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    col.conversations().countDocuments(filter),
  ]);
  const accountIds = [...new Set(docs.map((d) => String(d.account_id || '')).filter(Boolean))];
  const accounts = await col.accounts().find({ _id: { $in: toObjectIds(accountIds) } }, { projection: { firstName: 1, lastName: 1, username: 1, email: 1 } }).toArray();
  const names = new Map(accounts.map((a) => [String(a._id), displayName(a)]));

  res.json({
    total,
    page,
    items: docs.map((d) => ({
      id: String(d._id),
      createdAt: d.created_at,
      user: names.get(String(d.account_id)) || d.username || d.user_id || 'Unknown',
      platform: inferPlatform(d),
      project: d.project || 'Unknown',
      question: d.question,
      status: d.status || 'answered',
      latencyMs: d.latency_ms ?? null,
      tokens: (d.input_tokens || 0) + (d.output_tokens || 0),
      feedback: d.feedback?.value || null,
    })),
  });
});

consoleRouter.get('/conversations/:id', requirePermission('conversations.view'), async (req, res) => {
  const doc = await col.conversations().findOne({ _id: oid(req.params.id, 'conversation') });
  if (!doc) throw new HttpError(404, 'That conversation was not found.');
  if (!isAdmin(req.user) && !(doc.project_id && canUseProject(req.user, doc.project_id))) throw new HttpError(404, 'That conversation was not found.');
  res.json({
    message: await serializeMessage(doc, req.user),
    detail: {
      question: doc.question,
      rephrased: doc.rephrased_question || null,
      sql: doc.query || null,
      executedSql: doc.executed_sql || null,
      error: doc.error || null,
      inputTokens: doc.input_tokens || 0,
      outputTokens: doc.output_tokens || 0,
      latencyMs: doc.latency_ms ?? null,
      queryMs: doc.query_ms ?? null,
      platform: inferPlatform(doc),
      username: doc.username || null,
      feedback: doc.feedback || null,
    },
  });
});

consoleRouter.get('/audit', requirePermission('audit.view'), async (_req, res) => {
  const items = await col.audit().find({}).sort({ created_at: -1 }).limit(200).toArray();
  res.json(items.map((a) => ({ id: String(a._id), actor: a.actor, action: a.action, target: a.target, details: a.details, createdAt: a.created_at })));
});
