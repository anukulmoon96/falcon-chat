import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const key = new TextEncoder().encode(`${config.auth.jwtSecret}:media`);

async function sign(claims, ttlHours = config.media.ttlHours) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(key);
}

export async function verifyMediaToken(token) {
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
  return payload;
}

// Relative links for the web portal (same origin); absolute links for WhatsApp
// and Teams, which fetch the image themselves.
const base = (absolute) => (absolute ? config.publicBaseUrl : '');

export async function evidenceUrl(projectId, alertId, { absolute = false } = {}) {
  return `${base(absolute)}/media/e/${await sign({ k: 'e', p: String(projectId), a: String(alertId) })}`;
}

export async function chartUrl(conversationId, { absolute = false } = {}) {
  return `${base(absolute)}/media/c/${await sign({ k: 'c', c: String(conversationId) })}.png`;
}
