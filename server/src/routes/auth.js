import bcrypt from 'bcryptjs';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { HttpError, oid, parse } from '../lib/http.js';
import { authenticate, clearSession, issueSession } from '../auth/session.js';
import { canUseProject, permissionsFor, platformAllowed } from '../auth/permissions.js';
import {
  accessibleProjects, audit, findByEmail, publicAccount, publicProject, setSelectedProject,
} from '../services/accounts.js';

export const authRouter = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });

async function meResponse(account) {
  const projects = await accessibleProjects(account);
  return {
    user: publicAccount(account),
    permissions: permissionsFor(account),
    projects: projects.map((p) => publicProject(p, account)),
    assistantName: config.assistantName,
  };
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().min(3), password: z.string().min(1) }), req.body);
  const account = await findByEmail(email);
  const ok = Boolean(account?.passwordHash) && await bcrypt.compare(password, account.passwordHash);
  if (!ok) throw new HttpError(401, "That email and password don't match.");
  if (account.isActive === false) throw new HttpError(403, 'Your account is inactive. Contact your administrator.');
  if (!platformAllowed(account, 'Web Portal')) throw new HttpError(403, "Web Portal access isn't enabled for your account. Ask your administrator to turn it on.");
  await issueSession(res, account);
  await col.accounts().updateOne({ _id: account._id }, { $set: { lastLoginAt: new Date() } });
  audit(account, 'auth.login');
  res.json(await meResponse(account));
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => res.json(await meResponse(req.user)));

authRouter.post('/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(128),
  }), req.body);
  if (!(await bcrypt.compare(currentPassword, req.user.passwordHash || ''))) throw new HttpError(400, 'Your current password is incorrect.');
  const sessionVersion = (req.user.sessionVersion || 0) + 1;
  await col.accounts().updateOne(
    { _id: req.user._id },
    { $set: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false, sessionVersion, updatedAt: new Date() } },
  );
  await issueSession(res, { ...req.user, sessionVersion });
  audit(req.user, 'auth.password_changed');
  res.json({ ok: true });
});

authRouter.put('/project', authenticate, async (req, res) => {
  const { projectId } = parse(z.object({ projectId: z.string() }), req.body);
  const project = await col.projects().findOne({ _id: oid(projectId, 'project') });
  if (!project || !canUseProject(req.user, project._id)) throw new HttpError(403, "You don't have access to that project.");
  await setSelectedProject(req.user, project);
  res.json({ ok: true });
});
