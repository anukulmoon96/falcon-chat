import { Readable } from 'node:stream';
import express from 'express';
import { ObjectId } from 'mongodb';
import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { readQuery } from '../db/mysql.js';
import { verifyMediaToken } from '../media/tokens.js';
import { demoFramePng, renderChartPng } from '../media/render.js';
import { getKnowledge, nameIndex } from '../services/knowledge.js';

export const mediaRouter = express.Router();

async function claimsFor(token, kind) {
  try {
    const claims = await verifyMediaToken(token);
    return claims.k === kind ? claims : null;
  } catch {
    return null;
  }
}

function hostAllowed(url) {
  const { allowedHosts } = config.media;
  if (!allowedHosts.length) return true;
  const host = new URL(url).hostname.toLowerCase();
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

// Evidence frame. The signed token proves the alert came out of an answer the
// viewer was allowed to see, so no cookie is needed: WhatsApp and Teams fetch
// these links themselves, and the raw image_url never leaves the server.
mediaRouter.get('/e/:token', async (req, res) => {
  const claims = await claimsFor(req.params.token, 'e');
  if (!claims || !ObjectId.isValid(claims.p)) return res.sendStatus(404);
  const project = await col.projects().findOne({ _id: new ObjectId(claims.p) });
  if (!project) return res.sendStatus(404);
  const { rows } = await readQuery(
    project.db_name,
    'SELECT image_url, event_id, created_at FROM alerts WHERE id = ? LIMIT 1',
    { timeZone: project.timezone || config.defaultTimezone, params: [Number(claims.a)] },
  );
  const alert = rows[0];
  if (!alert?.image_url) return res.sendStatus(404);
  res.set('Cache-Control', 'private, max-age=3600');

  if (alert.image_url.startsWith('demo://')) {
    const names = nameIndex((await getKnowledge(project._id)).entities);
    return res.type('png').send(demoFramePng({ seed: claims.a, label: names.get(String(alert.event_id)) || 'Violation', time: alert.created_at }));
  }
  if (!/^https?:\/\//i.test(alert.image_url) || !hostAllowed(alert.image_url)) return res.sendStatus(404);
  const upstream = await fetch(alert.image_url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return res.sendStatus(502);
  res.type(upstream.headers.get('content-type') || 'image/jpeg');
  Readable.fromWeb(upstream.body).pipe(res);
  return undefined;
});

// Chart image for WhatsApp and Teams, rendered from the stored answer.
mediaRouter.get('/c/:file', async (req, res) => {
  const claims = await claimsFor(req.params.file.replace(/\.png$/, ''), 'c');
  if (!claims || !ObjectId.isValid(claims.c)) return res.sendStatus(404);
  const conversation = await col.conversations().findOne({ _id: new ObjectId(claims.c) }, { projection: { result: 1 } });
  const result = conversation?.result;
  const png = result?.chart && result.table ? renderChartPng(result.chart, result.table) : null;
  if (!png) return res.sendStatus(404);
  return res.set('Cache-Control', 'private, max-age=86400').type('png').send(png);
});
