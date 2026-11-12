import { ObjectId } from 'mongodb';
import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  base: undefined,
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
});

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Errors whose message is safe to show to an end user on any channel.
export class UserFacingError extends Error {}

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new HttpError(400, 'Some fields need attention.', details);
  }
  return result.data;
}

export function oid(value, label = 'id') {
  if (value instanceof ObjectId) return value;
  if (!ObjectId.isValid(String(value ?? ''))) throw new HttpError(400, `Invalid ${label}.`);
  return new ObjectId(String(value));
}

export const toObjectIds = (values = []) => values.filter((v) => ObjectId.isValid(String(v))).map((v) => new ObjectId(String(v)));
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const truncate = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));
