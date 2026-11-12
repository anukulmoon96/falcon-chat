import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { HttpError, oid } from '../lib/http.js';
import { can } from './permissions.js';

const key = new TextEncoder().encode(config.auth.jwtSecret);
export const SESSION_COOKIE = 'falcon_session';

export async function issueSession(res, account) {
  const token = await new SignJWT({ ver: account.sessionVersion || 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(account._id))
    .setIssuedAt()
    .setExpirationTime(`${config.auth.sessionTtlHours}h`)
    .sign(key);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.auth.sessionTtlHours * 3600 * 1000,
  });
}

export const clearSession = (res) => res.clearCookie(SESSION_COOKIE, { path: '/' });

export async function authenticate(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw new HttpError(401, 'Sign in to continue.');
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'] }));
  } catch {
    throw new HttpError(401, 'Your session expired. Sign in again.');
  }
  const account = await col.accounts().findOne({ _id: oid(payload.sub) });
  // sessionVersion is bumped on password reset / deactivation, which revokes old cookies.
  if (!account || account.isActive === false || (account.sessionVersion || 0) !== payload.ver) {
    throw new HttpError(401, 'Your session expired. Sign in again.');
  }
  req.user = account;
  next();
}

export const requirePermission = (permission) => (req, _res, next) => {
  if (!can(req.user, permission)) throw new HttpError(403, "You don't have access to this.");
  next();
};
