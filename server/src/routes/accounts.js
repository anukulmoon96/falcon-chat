import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { z } from 'zod';
import { col } from '../db/mongo.js';
import { HttpError, escapeRegex, oid, parse, toObjectIds } from '../lib/http.js';
import { requirePermission } from '../auth/session.js';
import {
  PLATFORMS, ROLES, SCOPE_KEYS, canManageAccount, constrainScope, isAdmin, normalizeRole, projectIdsOf, scopeFor,
} from '../auth/permissions.js';
import { audit, normalizePhone, publicAccount } from '../services/accounts.js';

export const accountsRouter = express.Router();
accountsRouter.use(requirePermission('users.view'));

const scopeShape = z.object(Object.fromEntries(SCOPE_KEYS.map((k) => [k, z.array(z.string()).max(500).optional()])));
const fields = {
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  mobileNumber: z.string().trim().transform(normalizePhone).refine((v) => v === '' || /^\d{8,15}$/.test(v), 'Use the full number with country code, e.g. 919820000000'),
  companyName: z.string().trim().max(120),
  designation: z.string().trim().max(120),
  role: z.enum(ROLES),
  projects: z.array(z.string()).max(200),
  platformShared: z.array(z.enum(PLATFORMS)),
  isActive: z.boolean(),
  dataScopes: z.record(z.string(), scopeShape),
};
const createSchema = z.object({
  ...fields,
  lastName: fields.lastName.default(''),
  mobileNumber: fields.mobileNumber.default(''),
  companyName: fields.companyName.default(''),
  designation: fields.designation.default(''),
  role: fields.role.default('end_user'),
  projects: fields.projects.default([]),
  platformShared: fields.platformShared.default(['Web Portal']),
  isActive: fields.isActive.default(true),
  dataScopes: fields.dataScopes.default({}),
  password: z.string().min(10).max(128).optional(),
});
const updateSchema = z.object(fields).partial();

const generatePassword = () => crypto.randomBytes(12).toString('base64url');

async function loadTarget(id) {
  const target = await col.accounts().findOne({ _id: oid(id, 'user') });
  if (!target) throw new HttpError(404, 'That user was not found.');
  return target;
}

// Applies the "never above your own access" rule for sub-admins.
function constrain(actor, data) {
  if (isAdmin(actor)) return data;
  if (data.role && data.role !== 'end_user') throw new HttpError(403, 'Sub-admins can only manage end users.');
  const mine = new Set(projectIdsOf(actor));
  if (data.projects?.some((p) => !mine.has(String(p)))) throw new HttpError(403, 'You can only assign projects you have access to.');
  if (data.platformShared?.some((p) => !(actor.platformShared || []).includes(p))) throw new HttpError(403, 'You can only enable channels you have yourself.');
  if (data.dataScopes) {
    data.dataScopes = Object.fromEntries(Object.entries(data.dataScopes).map(([projectId, scope]) => [projectId, constrainScope(scopeFor(actor, projectId), scope)]));
  }
  return data;
}

async function validateProjects(ids) {
  const objectIds = toObjectIds(ids);
  if (objectIds.length !== ids.length) throw new HttpError(400, 'One of the projects is invalid.');
  const found = await col.projects().countDocuments({ _id: { $in: objectIds } });
  if (found !== objectIds.length) throw new HttpError(400, 'One of the projects no longer exists.');
  return objectIds;
}

async function assertUnique({ email, mobileNumber }, exceptId) {
  const or = [];
  if (email) or.push({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
  if (mobileNumber) or.push({ mobileNumber: { $in: [mobileNumber, `+${mobileNumber}`] } });
  if (!or.length) return;
  const clash = await col.accounts().findOne({ $or: or, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (clash) throw new HttpError(409, 'Another user already has that email or mobile number.');
}

async function assertNotLastAdmin(target, changes) {
  if (normalizeRole(target.role) !== 'admin') return;
  const demoted = changes.role && changes.role !== 'admin';
  const deactivated = changes.isActive === false;
  if (!demoted && !deactivated) return;
  const others = await col.accounts().countDocuments({ _id: { $ne: target._id }, role: { $regex: '^(super_?)?admin$', $options: 'i' }, isActive: { $ne: false } });
  if (!others) throw new HttpError(400, 'Keep at least one active admin.');
}

accountsRouter.get('/', async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const rx = { $regex: escapeRegex(req.query.q), $options: 'i' };
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { mobileNumber: rx }, { username: rx }, { companyName: rx }];
  }
  if (req.query.projectId) filter.projects = oid(req.query.projectId, 'project');
  let accounts = await col.accounts().find(filter, { projection: { passwordHash: 0 } }).sort({ firstName: 1, lastName: 1 }).limit(1000).toArray();
  if (!isAdmin(req.user)) accounts = accounts.filter((a) => canManageAccount(req.user, a));
  if (req.query.role) accounts = accounts.filter((a) => normalizeRole(a.role) === req.query.role);
  res.json(accounts.map(publicAccount));
});

accountsRouter.post('/', requirePermission('users.manage'), async (req, res) => {
  const data = constrain(req.user, parse(createSchema, req.body));
  if (!isAdmin(req.user) && !data.projects.length) throw new HttpError(400, 'Assign at least one project.');
  const projects = await validateProjects(data.projects);
  await assertUnique(data);
  const password = data.password || generatePassword();
  const now = new Date();
  const first = projects[0] ? await col.projects().findOne({ _id: projects[0] }) : null;
  const doc = {
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    mobileNumber: data.mobileNumber,
    companyName: data.companyName,
    designation: data.designation,
    username: data.email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase(),
    role: data.role,
    projects,
    selectedProject: first ? { _id: first._id, name: first.name, db_name: first.db_name } : null,
    isProjectSelectionOn: false,
    platformShared: data.platformShared,
    dataScopes: data.dataScopes,
    isActive: data.isActive,
    passwordHash: await bcrypt.hash(password, 12),
    mustChangePassword: !data.password,
    sessionVersion: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: req.user._id,
  };
  const { insertedId } = await col.accounts().insertOne(doc);
  audit(req.user, 'user.created', { id: insertedId, email: doc.email }, { role: doc.role });
  res.status(201).json({ user: publicAccount({ ...doc, _id: insertedId }), temporaryPassword: data.password ? undefined : password });
});

accountsRouter.patch('/:id', requirePermission('users.manage'), async (req, res) => {
  const target = await loadTarget(req.params.id);
  if (!canManageAccount(req.user, target)) throw new HttpError(403, "You can't manage this user.");
  const changes = constrain(req.user, parse(updateSchema, req.body));
  if (String(target._id) === String(req.user._id) && (changes.role || changes.isActive === false)) {
    throw new HttpError(400, "You can't change your own role or deactivate yourself.");
  }
  await assertNotLastAdmin(target, changes);
  await assertUnique(changes, target._id);

  const set = { ...changes, updatedAt: new Date() };
  if (changes.projects) {
    set.projects = await validateProjects(changes.projects);
    const selected = target.selectedProject?._id ? String(target.selectedProject._id) : null;
    if (selected && !changes.projects.includes(selected)) set.selectedProject = null;
  }
  const inc = changes.isActive === false || (changes.role && changes.role !== normalizeRole(target.role)) ? { sessionVersion: 1 } : undefined;
  await col.accounts().updateOne({ _id: target._id }, { $set: set, ...(inc ? { $inc: inc } : {}) });
  audit(req.user, 'user.updated', { id: target._id, email: target.email }, { fields: Object.keys(changes) });
  res.json({ user: publicAccount(await col.accounts().findOne({ _id: target._id })) });
});

accountsRouter.post('/:id/reset-password', requirePermission('users.manage'), async (req, res) => {
  const target = await loadTarget(req.params.id);
  if (!canManageAccount(req.user, target)) throw new HttpError(403, "You can't manage this user.");
  const password = generatePassword();
  await col.accounts().updateOne(
    { _id: target._id },
    { $set: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, updatedAt: new Date() }, $inc: { sessionVersion: 1 } },
  );
  audit(req.user, 'user.password_reset', { id: target._id, email: target.email });
  res.json({ temporaryPassword: password });
});
