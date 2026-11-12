// Talks to Teams through the Azure Bot Service "Bot Connector" REST API directly.
// The Bot Framework SDK is archived, and this protocol is what every newer SDK
// uses underneath, so there is no SDK churn to track here.
import express from 'express';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { config, hasPublicMedia } from '../config.js';
import { col } from '../db/mongo.js';
import { logger, truncate } from '../lib/http.js';
import { platformAllowed } from '../auth/permissions.js';
import {
  accessibleProjects, currentProject, findByEmail, setSelectedProject,
} from '../services/accounts.js';
import { enqueue } from '../services/queue.js';
import { greetingText, helpText, parseCommand } from './commands.js';
import { evidenceCaption, formatValue } from './format.js';
import { chartUrl, evidenceUrl } from '../media/tokens.js';
import { isChartable } from '../../../shared/chart-option.js';

const PLATFORM = 'Teams';
const ISSUER = 'https://api.botframework.com';
const KEYS_URL = 'https://login.botframework.com/v1/.well-known/keys';

let keyCache = { keys: [], at: 0 };
async function signingKeys(force = false) {
  if (!force && keyCache.keys.length && Date.now() - keyCache.at < 12 * 3600_000) return keyCache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error(`Could not load Bot Framework signing keys (${res.status})`);
  keyCache = { keys: (await res.json()).keys || [], at: Date.now() };
  return keyCache.keys;
}

async function verifyInbound(req) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Error('missing bearer token');
  const token = header.slice(7);
  const { kid, alg = 'RS256' } = decodeProtectedHeader(token);
  let jwk = (await signingKeys()).find((k) => k.kid === kid);
  if (!jwk) jwk = (await signingKeys(true)).find((k) => k.kid === kid); // key rotation
  if (!jwk) throw new Error('unknown signing key');
  const activity = req.body || {};
  if (Array.isArray(jwk.endorsements) && activity.channelId && !jwk.endorsements.includes(activity.channelId)) {
    throw new Error('signing key not endorsed for this channel');
  }
  const key = await importJWK({ kty: jwk.kty, n: jwk.n, e: jwk.e }, alg);
  const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: config.teams.appId, clockTolerance: 300 });
  const claimedUrl = payload.serviceurl || payload.serviceUrl;
  if (!claimedUrl || claimedUrl !== activity.serviceUrl || !/^https:\/\//.test(claimedUrl)) throw new Error('serviceUrl mismatch');
}

let botToken = { value: null, expires: 0 };
async function connectorToken() {
  if (botToken.value && Date.now() < botToken.expires - 60_000) return botToken.value;
  const tenant = config.teams.tenantId || 'botframework.com';
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.teams.appId,
      client_secret: config.teams.appPassword,
      scope: 'https://api.botframework.com/.default',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Teams token request failed: ${json.error_description || res.status}`);
  botToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return botToken.value;
}

async function connector(serviceUrl, path, { method = 'POST', body } = {}) {
  const res = await fetch(`${serviceUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await connectorToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Teams connector ${res.status}: ${truncate(await res.text(), 300)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

export function sendActivity(ref, activity) {
  const conversation = encodeURIComponent(ref.conversationId);
  const path = ref.activityId
    ? `/v3/conversations/${conversation}/activities/${encodeURIComponent(ref.activityId)}`
    : `/v3/conversations/${conversation}/activities`;
  return connector(ref.serviceUrl, path, { body: { type: 'message', ...activity } });
}

const card = (body, actions = []) => ({
  attachments: [{
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      msteams: { width: 'Full' },
      body,
      actions,
    },
  }],
});

function projectPickerCard(projects, current) {
  return card([
    { type: 'TextBlock', text: 'Choose a project', weight: 'Bolder', size: 'Medium' },
    { type: 'TextBlock', text: current ? `You're on ${current.name}.` : 'Pick the project you want to ask about.', wrap: true, isSubtle: true },
    {
      type: 'Input.ChoiceSet',
      id: 'projectId',
      style: 'compact',
      value: current ? String(current._id) : String(projects[0]._id),
      choices: projects.map((p) => ({ title: p.name, value: String(p._id) })),
    },
  ], [{ type: 'Action.Submit', title: 'Switch project', data: { action: 'select_project' } }]);
}

function answerCard(result, { chart, evidence, webUrl }) {
  const body = [];
  if (result.kind === 'clarification' && result.clarification) {
    body.push({ type: 'TextBlock', text: result.clarification.question, wrap: true, weight: 'Bolder' });
    return card(body, result.clarification.options.map((o) => ({ type: 'Action.Submit', title: truncate(o, 40), data: { action: 'ask', question: o } })));
  }
  if (result.headline) body.push({ type: 'TextBlock', text: result.headline, wrap: true, weight: 'Bolder', size: 'Medium' });
  if (result.summary) body.push({ type: 'TextBlock', text: result.summary, wrap: true, spacing: 'Small' });
  if (result.filters?.length) {
    body.push({ type: 'FactSet', spacing: 'Medium', facts: result.filters.slice(0, 6).map((f) => ({ title: f.label, value: f.value })) });
  }
  if (chart) body.push({ type: 'Image', url: chart, altText: result.chart?.title || 'Chart', spacing: 'Medium' });
  const t = result.table;
  if (!chart && t?.rows?.length > 1 && t.columns.length) {
    const cols = t.columns.slice(0, 4);
    body.push({
      type: 'Table',
      spacing: 'Medium',
      firstRowAsHeaders: true,
      columns: cols.map(() => ({ width: 1 })),
      rows: [
        { type: 'TableRow', cells: cols.map((c) => ({ type: 'TableCell', items: [{ type: 'TextBlock', text: c.name.replace(/_/g, ' '), weight: 'Bolder', wrap: true }] })) },
        ...t.rows.slice(0, 8).map((r) => ({
          type: 'TableRow',
          cells: cols.map((c) => ({ type: 'TableCell', items: [{ type: 'TextBlock', text: formatValue(r[c.name]), wrap: true }] })),
        })),
      ],
    });
  }
  if (evidence.length) {
    body.push({ type: 'TextBlock', text: 'Evidence', weight: 'Bolder', spacing: 'Medium' });
    body.push({ type: 'ImageSet', imageSize: 'Medium', images: evidence.map((e) => ({ type: 'Image', url: e.url, altText: e.caption })) });
  }
  const actions = (result.followups || []).slice(0, 3).map((q) => ({ type: 'Action.Submit', title: truncate(q, 40), data: { action: 'ask', question: q } }));
  if (webUrl) actions.push({ type: 'Action.OpenUrl', title: 'Open in web portal', url: webUrl });
  return card(body.length ? body : [{ type: 'TextBlock', text: result.text || 'Done.', wrap: true }], actions);
}

async function resolveAccount(activity, ref) {
  const aadObjectId = activity.from?.aadObjectId;
  let account = aadObjectId ? await col.accounts().findOne({ 'teams.aadObjectId': aadObjectId }) : null;
  if (account) return account;
  // First contact: look the member up to get their work email, then link by email.
  const member = await connector(
    ref.serviceUrl,
    `/v3/conversations/${encodeURIComponent(ref.conversationId)}/members/${encodeURIComponent(activity.from.id)}`,
    { method: 'GET' },
  ).catch(() => null);
  const email = member?.email || member?.userPrincipalName;
  account = email ? await findByEmail(email) : null;
  if (account && aadObjectId) {
    const teams = { aadObjectId, userPrincipalName: member.userPrincipalName || email };
    await col.accounts().updateOne({ _id: account._id }, { $set: { teams } });
    account.teams = teams;
  }
  return account;
}

const stripMentions = (text) => String(text || '').replace(/<at>[^<]*<\/at>/gi, '').replace(/&nbsp;/g, ' ').trim();

async function handleActivity(activity) {
  const ref = { serviceUrl: activity.serviceUrl, conversationId: activity.conversation?.id, activityId: activity.id };
  if (activity.type === 'conversationUpdate') {
    const added = (activity.membersAdded || []).some((m) => m.id === activity.recipient?.id);
    if (added) await sendActivity({ ...ref, activityId: null }, { text: `Hi! I'm ${config.assistantName}. Ask me about your sites' CCTV alerts, or type "help".` });
    return;
  }
  if (activity.type !== 'message') return;

  const account = await resolveAccount(activity, ref);
  if (!account) return void await sendActivity(ref, { text: `I couldn't match your Teams account to a ${config.assistantName} user. Ask your administrator to add your work email.` });
  if (account.isActive === false) return void await sendActivity(ref, { text: 'Your account is inactive. Contact your administrator.' });
  if (!platformAllowed(account, PLATFORM)) return void await sendActivity(ref, { text: "Teams access isn't enabled for your account. Ask your administrator to turn it on." });

  await col.accounts().updateOne({ _id: account._id }, { $set: { 'teams.lastSeenAt': new Date() } });
  const projects = await accessibleProjects(account);
  if (!projects.length) return void await sendActivity(ref, { text: "You don't have any projects assigned yet. Contact your administrator." });

  const value = activity.value || {};
  if (value.action === 'select_project') {
    const project = projects.find((p) => String(p._id) === String(value.projectId));
    if (!project) return void await sendActivity(ref, { text: "That project isn't available to you anymore." });
    const pending = account.pendingQuestion;
    await setSelectedProject(account, project);
    await sendActivity(ref, { text: `Switched to **${project.name}**. ${pending ? 'Answering your question now.' : 'What would you like to know?'}` });
    if (pending) await queueQuestion(account, project, pending, ref, null, activity);
    return;
  }

  const text = value.action === 'ask' ? String(value.question || '') : stripMentions(activity.text);
  if (!text) return;
  const command = parseCommand(text);
  let project = currentProject(account, projects);
  if (command === 'switch') return void await sendActivity(ref, projectPickerCard(projects, project));
  if (!project) {
    if (projects.length > 1) {
      if (!command) await col.accounts().updateOne({ _id: account._id }, { $set: { pendingQuestion: text } });
      return void await sendActivity(ref, projectPickerCard(projects, null));
    }
    [project] = projects;
    await setSelectedProject(account, project);
  }
  if (command === 'greeting') return void await sendActivity(ref, { text: greetingText(account, project) });
  if (command === 'help') return void await sendActivity(ref, { text: helpText(PLATFORM, project) });
  if (command === 'current') return void await sendActivity(ref, { text: `You're on **${project.name}**. Type "projects" to switch.` });

  await queueQuestion(account, project, text, ref, activity.id, activity);
}

async function queueQuestion(account, project, question, ref, activityId, activity) {
  connector(ref.serviceUrl, `/v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`, { body: { type: 'typing' } }).catch(() => {});
  await enqueue({
    platform: PLATFORM,
    account_id: String(account._id),
    project_id: String(project._id),
    question,
    message_id: activityId,
    user_id: activity.from?.aadObjectId || activity.from?.id,
    reply_to: ref,
  }, { externalId: activityId ? `teams:${activityId}` : undefined });
}

export const teamsRouter = express.Router();

teamsRouter.post('/messages', async (req, res) => {
  if (!config.teams.enabled) return res.sendStatus(404);
  try {
    await verifyInbound(req);
  } catch (err) {
    logger.warn({ err: err.message }, 'Rejected Teams request');
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  handleActivity(req.body).catch((err) => logger.error({ err: err.message }, 'Teams activity failed'));
  return undefined;
});

export async function deliverTeams(task, conversation) {
  const ref = task.payload.reply_to;
  if (!ref?.serviceUrl) return;
  const result = conversation.result;
  const media = hasPublicMedia();
  const chart = media && isChartable(result.chart, result.table) ? await chartUrl(conversation._id, { absolute: true }) : null;
  const evidence = media
    ? await Promise.all((result.evidence || []).slice(0, 6).map(async (e) => ({
      url: await evidenceUrl(task.payload.project_id, e.alert_id, { absolute: true }),
      caption: evidenceCaption(e),
    })))
    : [];
  const account = await col.accounts().findOne({ _id: conversation.account_id }, { projection: { platformShared: 1 } });
  const webUrl = account?.platformShared?.includes('Web Portal') ? `${config.webPortalUrl}/chat` : null;
  await sendActivity(ref, answerCard(result, { chart, evidence, webUrl }));
}
