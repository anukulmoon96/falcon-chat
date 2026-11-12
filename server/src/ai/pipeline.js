import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { readQuery } from '../db/mysql.js';
import { UserFacingError, logger, oid, truncate } from '../lib/http.js';
import { canUseProject, platformAllowed, scopeFor } from '../auth/permissions.js';
import { getKnowledge, nameIndex, scopeEntities } from '../services/knowledge.js';
import { GuardError, guardSql } from '../sql/guard.js';
import { extractEvidence, publicTable, resolveChart, shapeResult, summarize } from '../sql/shape.js';
import { greetingText, helpText } from '../channels/commands.js';
import { TYPES, readUpload } from '../services/uploads.js';
import { llm } from './gemini.js';
import {
  ATTACHMENT_SCHEMA, PLAN_SCHEMA, PRESENT_SCHEMA, attachmentSystem, attachmentValidator, planValidator, plannerPrompt,
  plannerSystem, presentValidator, presenterPrompt, presenterSystem,
} from './prompts.js';

export function messageResult(text, extra = {}) {
  return { kind: 'message', headline: null, summary: text, text, filters: [], chart: null, table: null, evidence: [], followups: [], ...extra };
}

async function recentTurns(payload) {
  const filter = { account_id: oid(payload.account_id), project_id: oid(payload.project_id), status: 'answered' };
  if (payload.thread_id) filter.thread_id = oid(payload.thread_id);
  else Object.assign(filter, { platform: payload.platform, created_at: { $gte: new Date(Date.now() - 6 * 3600_000) } });
  const docs = await col.conversations()
    .find(filter, { projection: { question: 1, rephrased_question: 1, query: 1, response: 1 } })
    .sort({ created_at: -1 })
    .limit(4)
    .toArray();
  return docs.reverse().map((d) => ({
    question: d.rephrased_question || d.question,
    sql: d.query && d.query !== 'SELECT 1' ? truncate(d.query, 600) : null,
    answer: truncate(d.response, 300),
  }));
}

function nonDataResult(plan, account, project, platform) {
  if (plan.intent === 'clarify' && plan.clarification?.options?.length) {
    const { question, options } = plan.clarification;
    return {
      ...messageResult(question),
      kind: 'clarification',
      text: `${question}\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
      clarification: { question, options: options.slice(0, 6) },
    };
  }
  if (plan.intent === 'greeting') return messageResult(plan.reply || greetingText(account, project));
  if (plan.intent === 'help') return messageResult(helpText(platform, project));
  return messageResult(plan.reply || `I can only answer questions about alerts in ${project.name}.`);
}

async function present(input, track) {
  try {
    const { data, usage } = await llm.generateJson({
      model: config.gemini.fastModel,
      system: presenterSystem(),
      prompt: presenterPrompt(input),
      schema: PRESENT_SCHEMA,
    });
    track(usage);
    return presentValidator.parse(data);
  } catch (err) {
    logger.warn({ err: err.message }, 'Presenter failed; using a plain summary');
    const n = input.stats.rows;
    return {
      headline: n ? `Found ${n} matching row${n === 1 ? '' : 's'}.` : 'No alerts matched this question.',
      summary: n ? '' : 'Try a longer period or fewer filters.',
      followups: [],
    };
  }
}

const MAX_TEXT_CHARS = 200_000;

// Images and PDFs go to the model inline; text files go as text.
async function attachmentParts(attachments) {
  const parts = [];
  for (const a of attachments) {
    const body = await readUpload(a.id).catch(() => null);
    if (!body) throw new UserFacingError(`I couldn't open "${a.name}". Attach it again and resend.`);
    if (TYPES[a.type]?.kind === 'text') {
      const text = body.toString('utf8');
      const clipped = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[…file truncated]` : text;
      parts.push({ text: `File "${a.name}" (${a.type}):\n${clipped}` });
    } else {
      parts.push({ text: `Attachment "${a.name}":` }, { inlineData: { mimeType: a.type, data: body.toString('base64') } });
    }
  }
  return parts;
}

async function answerWithAttachments({ p, project, timeZone, history, onStage }) {
  await onStage('analysing');
  const turns = history.length
    ? history.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n')
    : '(no earlier turns)';
  const { data, usage } = await llm.generateJson({
    model: config.gemini.sqlModel,
    system: attachmentSystem({ assistantName: config.assistantName, project, timeZone }),
    prompt: [
      { text: `Earlier turns in this conversation (oldest first):\n${turns}` },
      ...(await attachmentParts(p.attachments)),
      { text: `Question: ${p.question}` },
    ],
    schema: ATTACHMENT_SCHEMA,
  });
  const parsed = attachmentValidator.safeParse(data);
  if (!parsed.success) throw new Error(`Attachment answer had an unexpected shape: ${parsed.error.message.slice(0, 300)}`);
  const a = parsed.data;
  return {
    result: {
      ...messageResult(''),
      kind: 'analysis',
      headline: a.headline,
      summary: a.summary,
      text: [a.headline, a.summary, ...a.findings.map((f) => `• ${f.label}: ${f.detail}`)].filter(Boolean).join('\n\n'),
      findings: a.findings,
      followups: a.followups.slice(0, 3),
    },
    meta: { rephrased: p.question, usage, sql: null },
  };
}

// Returns { result, meta }. `result` is what every channel renders;
// `meta` is stored on the conversation for admins (SQL, tokens, rows).
export async function answerQuestion(task, { onStage = async () => {} } = {}) {
  const p = task.payload;
  const [account, project] = await Promise.all([
    col.accounts().findOne({ _id: oid(p.account_id) }),
    col.projects().findOne({ _id: oid(p.project_id) }),
  ]);
  if (!account || account.isActive === false) throw new UserFacingError('Your account is inactive. Contact your administrator.');
  if (!project || project.isActive === false) throw new UserFacingError('That project is no longer available.');
  if (!canUseProject(account, project._id)) throw new UserFacingError("You don't have access to this project anymore.");
  if (!platformAllowed(account, p.platform)) throw new UserFacingError(`${p.platform} access isn't enabled for your account.`);

  const timeZone = project.timezone || config.defaultTimezone;
  const scope = scopeFor(account, project._id);
  const knowledge = await getKnowledge(project._id);
  const entities = scopeEntities(knowledge.entities, scope);
  const names = nameIndex(knowledge.entities);
  const history = await recentTurns(p);
  if (p.attachments?.length) return answerWithAttachments({ p, project, timeZone, history, onStage });

  const usage = { input: 0, output: 0 };
  const track = (u) => { usage.input += u.input; usage.output += u.output; };
  const system = plannerSystem({ assistantName: config.assistantName, project, timeZone, entities, knowledge });

  const plan = async (retry) => {
    const { data, usage: u } = await llm.generateJson({
      model: config.gemini.sqlModel,
      system,
      prompt: plannerPrompt({ question: p.question, history, retry }),
      schema: PLAN_SCHEMA,
    });
    track(u);
    const parsed = planValidator.safeParse(data);
    if (!parsed.success) throw new Error(`Planner returned an unexpected shape: ${parsed.error.message.slice(0, 300)}`);
    return parsed.data;
  };

  await onStage('understanding');
  let current = await plan();
  const nonData = () => ({
    result: nonDataResult(current, account, project, p.platform),
    meta: { rephrased: current.rephrased_question || p.question, usage, sql: null },
  });
  if (current.intent !== 'data' || !current.sql) return nonData();

  let guarded;
  let execution;
  for (let attempt = 1; ; attempt += 1) {
    try {
      guarded = guardSql(current.sql, { dbName: project.db_name, scope, maxRows: config.mysql.maxRows });
      await onStage('querying');
      execution = await readQuery(project.db_name, guarded.sql, { timeZone });
      break;
    } catch (err) {
      const fixable = err instanceof GuardError || Boolean(err.sqlMessage);
      if (!fixable || attempt >= 2) throw err;
      logger.info({ err: err.sqlMessage || err.message }, 'Retrying with the error fed back to the model');
      await onStage('retrying');
      current = await plan({ sql: current.sql, error: err.sqlMessage || err.message });
      if (current.intent !== 'data' || !current.sql) return nonData();
    }
  }

  await onStage('presenting');
  const table = shapeResult(execution, { names, maxRows: config.mysql.maxRows });
  const chart = resolveChart(current.visualization, table);
  const stats = summarize(table, chart);
  const text = await present({
    question: current.rephrased_question || p.question,
    filters: current.filters,
    chart,
    stats,
    sample: publicTable(table, 15).rows,
  }, track);

  return {
    result: {
      kind: 'answer',
      headline: text.headline,
      summary: text.summary,
      text: [text.headline, text.summary].filter(Boolean).join('\n\n'),
      filters: current.filters,
      chart,
      table: publicTable(table),
      evidence: extractEvidence(table),
      followups: text.followups.slice(0, 3),
      clarification: null,
    },
    meta: {
      rephrased: current.rephrased_question || p.question,
      usage,
      sql: current.sql,
      executedSql: guarded.sql,
      rows: table.rowCount,
      queryMs: execution.ms,
    },
  };
}
