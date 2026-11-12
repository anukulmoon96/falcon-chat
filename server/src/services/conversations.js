import { col } from '../db/mongo.js';
import { oid } from '../lib/http.js';
import { can } from '../auth/permissions.js';
import { evidenceUrl } from '../media/tokens.js';

// Keeps the original Falcon fields (project, question, rephrased_question, query,
// response, input_tokens, output_tokens, created_at, message_id, user_id, username)
// and adds what the new console and channels need.
export async function saveConversation({ task, payload, account, project, result, meta = {}, status, error = null, startedAt = new Date() }) {
  const doc = {
    project: project?.name || null,
    project_id: project?._id || oid(payload.project_id),
    account_id: account?._id || oid(payload.account_id),
    question: payload.question,
    rephrased_question: meta.rephrased || payload.question,
    query: meta.sql ?? null,
    executed_sql: meta.executedSql ?? null,
    response: result.text,
    input_tokens: meta.usage?.input || 0,
    output_tokens: meta.usage?.output || 0,
    created_at: startedAt,
    message_id: payload.message_id || null,
    user_id: payload.user_id || String(payload.account_id),
    username: account?.username || null,
    platform: payload.platform,
    thread_id: payload.thread_id ? oid(payload.thread_id) : null,
    task_id: task?.task_id || null,
    status,
    error,
    latency_ms: Date.now() - startedAt.getTime(),
    query_ms: meta.queryMs ?? null,
    rows: meta.rows ?? null,
    result,
    attachments: payload.attachments || [],
    feedback: null,
  };
  const { insertedId } = await col.conversations().insertOne(doc);
  return { ...doc, _id: insertedId };
}

const inferPlatform = (c) => c.platform || (String(c.message_id || '').startsWith('wamid.') ? 'WhatsApp' : 'Unknown');

export async function serializeMessage(conv, viewer) {
  const r = conv.result || { kind: 'message', summary: conv.response, text: conv.response };
  const evidence = conv.project_id
    ? await Promise.all((r.evidence || []).map(async (e) => ({ ...e, src: await evidenceUrl(conv.project_id, e.alert_id) })))
    : [];
  const message = {
    id: String(conv._id),
    threadId: conv.thread_id ? String(conv.thread_id) : null,
    projectId: conv.project_id ? String(conv.project_id) : null,
    question: conv.question,
    attachments: (conv.attachments || []).map((a) => ({ ...a, url: `/api/chat/uploads/${a.id}` })),
    createdAt: conv.created_at,
    platform: inferPlatform(conv),
    status: conv.status || 'answered',
    kind: r.kind || 'message',
    headline: r.headline || null,
    summary: r.summary || null,
    text: r.text || conv.response || '',
    filters: r.filters || [],
    chart: r.chart || null,
    table: r.table || null,
    evidence,
    findings: r.findings || [],
    followups: r.followups || [],
    clarification: r.clarification || null,
    feedback: conv.feedback?.value || null,
    meta: {
      rows: conv.rows ?? r.table?.rowCount ?? null,
      latencyMs: conv.latency_ms ?? null,
      tokens: (conv.input_tokens || 0) + (conv.output_tokens || 0),
    },
  };
  if (viewer && can(viewer, 'sql.view')) {
    Object.assign(message, { sql: conv.executed_sql || conv.query || null, rephrased: conv.rephrased_question || null, error: conv.error || null });
  }
  return message;
}

export { inferPlatform };
