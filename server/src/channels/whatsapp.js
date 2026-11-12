import crypto from 'node:crypto';
import express from 'express';
import { config, hasPublicMedia } from '../config.js';
import { col } from '../db/mongo.js';
import { logger, truncate } from '../lib/http.js';
import { platformAllowed } from '../auth/permissions.js';
import {
  accessibleProjects, currentProject, displayName, findByPhone, setSelectedProject,
} from '../services/accounts.js';
import { enqueue } from '../services/queue.js';
import { greetingText, helpText, parseCommand } from './commands.js';
import { chatText, evidenceCaption } from './format.js';
import { renderChartPng } from '../media/render.js';
import { evidenceUrl } from '../media/tokens.js';
import { isChartable } from '../../../shared/chart-option.js';

const PLATFORM = 'WhatsApp';
const PAGE_SIZE = 9; // WhatsApp lists hold 10 rows: 9 projects + "More projects"

async function graph(path, body) {
  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}${path}`;
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${json?.error?.message || 'request failed'}`);
  return json;
}

const send = (to, message) => graph('/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message });

export const whatsapp = {
  text: (to, body) => send(to, { type: 'text', text: { preview_url: false, body: truncate(body, 4096) } }),
  imageById: (to, id, caption) => send(to, { type: 'image', image: { id, caption: truncate(caption || '', 1024) } }),
  imageByLink: (to, link, caption) => send(to, { type: 'image', image: { link, caption: truncate(caption || '', 1024) } }),
  list: (to, { header, body, button, rows }) => send(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: truncate(header, 60) },
      body: { text: truncate(body, 1024) },
      action: { button: truncate(button, 20), sections: [{ title: 'Projects', rows }] },
    },
  }),
  markRead: (messageId) => graph('/messages', { messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  async uploadPng(buffer) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/png');
    form.append('file', new Blob([buffer], { type: 'image/png' }), 'chart.png');
    return (await graph('/media', form)).id;
  },
};

function validSignature(req) {
  const header = req.get('x-hub-signature-256') || '';
  const expected = `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(req.body).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendProjectPicker(to, account, projects, page = 0, pendingQuestion = null) {
  await col.accounts().updateOne(
    { _id: account._id },
    { $set: { isProjectSelectionOn: true, ...(pendingQuestion ? { pendingQuestion } : {}) } },
  );
  const total = projects.length;
  const paged = total > 10;
  const start = paged ? page * PAGE_SIZE : 0;
  const slice = paged ? projects.slice(start, start + PAGE_SIZE) : projects;
  const rows = slice.map((p, i) => ({
    id: `proj:${p._id}`,
    title: truncate(`${start + i + 1}. ${p.name}`, 24),
    ...(p.name.length > 20 ? { description: truncate(p.name, 72) } : {}),
  }));
  if (paged) {
    const more = start + PAGE_SIZE < total;
    rows.push(more
      ? { id: `page:${page + 1}`, title: 'More projects', description: `Show ${start + PAGE_SIZE + 1}–${Math.min(total, start + 2 * PAGE_SIZE)} of ${total}` }
      : { id: 'page:0', title: 'Back to first page' });
  }
  const current = currentProject(account, projects);
  return whatsapp.list(to, {
    header: 'Choose a project',
    body: `${current ? `You're on ${current.name}. ` : ''}Pick the project you want to ask about, or reply with its number.`,
    button: 'Projects',
    rows,
  });
}

async function chooseProject(to, account, projects, projectId) {
  const project = projects.find((p) => String(p._id) === projectId);
  if (!project) return whatsapp.text(to, "That project isn't available to you anymore. Send \"projects\" to see your list.");
  const pending = account.pendingQuestion;
  await setSelectedProject(account, project);
  await whatsapp.text(to, `Switched to *${project.name}*. ${pending ? 'Answering your question now.' : 'What would you like to know?'}`);
  if (pending) await enqueueQuestion(to, account, project, pending, null);
  return null;
}

function enqueueQuestion(from, account, project, question, messageId) {
  return enqueue({
    platform: PLATFORM,
    account_id: String(account._id),
    project_id: String(project._id),
    question,
    message_id: messageId,
    user_id: from,
    reply_to: { to: from },
  }, { externalId: messageId ? `wa:${messageId}` : undefined });
}

async function handleMessage(msg) {
  const from = msg.from;
  const account = await findByPhone(from);
  if (!account) return whatsapp.text(from, `This number isn't registered with ${config.assistantName}. Ask your administrator to add it to your account.`);
  if (account.isActive === false) return whatsapp.text(from, 'Your account is inactive. Contact your administrator.');
  if (!platformAllowed(account, PLATFORM)) {
    return whatsapp.text(from, `WhatsApp access isn't enabled for your account, ${displayName(account)}. Ask your administrator to turn it on.`);
  }
  whatsapp.markRead(msg.id).catch(() => {});

  const projects = await accessibleProjects(account);
  if (!projects.length) return whatsapp.text(from, "You don't have any projects assigned yet. Contact your administrator.");

  const reply = msg.interactive?.list_reply || msg.interactive?.button_reply;
  if (reply?.id?.startsWith('proj:')) return chooseProject(from, account, projects, reply.id.slice(5));
  if (reply?.id?.startsWith('page:')) return sendProjectPicker(from, account, projects, Number(reply.id.slice(5)) || 0);
  if (msg.type !== 'text') return whatsapp.text(from, 'I can read text messages for now. Type your question.');

  const text = String(msg.text?.body || '').trim();
  if (!text) return null;
  if (account.isProjectSelectionOn && /^\d{1,3}$/.test(text)) {
    const picked = projects[Number(text) - 1];
    if (picked) return chooseProject(from, account, projects, String(picked._id));
  }

  const command = parseCommand(text);
  let project = currentProject(account, projects);
  if (command === 'switch') return sendProjectPicker(from, account, projects);
  if (!project) {
    if (projects.length > 1) return sendProjectPicker(from, account, projects, 0, command ? null : text);
    [project] = projects;
    await setSelectedProject(account, project);
  }
  if (command === 'greeting') return whatsapp.text(from, greetingText(account, project));
  if (command === 'help') return whatsapp.text(from, helpText(PLATFORM, project));
  if (command === 'current') return whatsapp.text(from, `You're on *${project.name}*. Send "projects" to switch.`);

  return enqueueQuestion(from, account, project, text, msg.id);
}

export const whatsappRouter = express.Router();

// Meta's one-time webhook verification
whatsappRouter.get('/', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe'
    && config.whatsapp.verifyToken
    && req.query['hub.verify_token'] === config.whatsapp.verifyToken;
  if (!ok) return res.sendStatus(403);
  return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

whatsappRouter.post('/', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  if (!config.whatsapp.enabled) return res.sendStatus(404);
  if (!Buffer.isBuffer(req.body) || !validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast; Meta retries slow webhooks
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return undefined;
  }
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) {
        handleMessage(msg).catch((err) => logger.error({ err: err.message }, 'WhatsApp message handling failed'));
      }
    }
  }
  return undefined;
});

export async function deliverWhatsApp(task, conversation) {
  const to = task.payload.reply_to?.to;
  if (!to) return;
  const result = conversation.result;
  await whatsapp.text(to, chatText(result));

  if (isChartable(result.chart, result.table)) {
    const png = renderChartPng(result.chart, result.table);
    if (png) await whatsapp.imageById(to, await whatsapp.uploadPng(png), result.chart.title || result.headline || '');
  }
  if (result.evidence?.length) {
    if (!hasPublicMedia()) {
      logger.warn('Evidence images skipped: PUBLIC_BASE_URL must be a public https URL for WhatsApp to fetch them');
      return;
    }
    for (const item of result.evidence.slice(0, 3)) {
      await whatsapp.imageByLink(to, await evidenceUrl(task.payload.project_id, item.alert_id, { absolute: true }), evidenceCaption(item));
    }
  }
}
