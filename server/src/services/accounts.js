import { col } from '../db/mongo.js';
import { escapeRegex, logger, toObjectIds } from '../lib/http.js';
import { isAdmin, normalizeRole, scopeFor } from '../auth/permissions.js';

export const normalizePhone = (v) => String(v || '').replace(/\D/g, '');
export const displayName = (a) => [a?.firstName, a?.lastName].filter(Boolean).join(' ') || a?.username || a?.email || 'User';

export function findByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return col.accounts().findOne({ mobileNumber: { $in: [digits, `+${digits}`] } });
}

export function findByEmail(email) {
  const value = String(email || '').trim();
  if (!value) return null;
  return col.accounts().findOne({ email: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
}

// Admins can reach every active project; everyone else only their assigned ones.
export function accessibleProjects(account) {
  const filter = isAdmin(account) ? {} : { _id: { $in: toObjectIds(account?.projects) } };
  return col.projects().find({ ...filter, isActive: { $ne: false } }).sort({ name: 1 }).toArray();
}

export function currentProject(account, projects) {
  const id = account?.selectedProject?._id ? String(account.selectedProject._id) : null;
  return (id && projects.find((p) => String(p._id) === id)) || null;
}

export async function setSelectedProject(account, project) {
  await col.accounts().updateOne(
    { _id: account._id },
    {
      $set: {
        selectedProject: { _id: project._id, name: project.name, db_name: project.db_name },
        isProjectSelectionOn: false,
        updatedAt: new Date(),
      },
      $unset: { pendingQuestion: '' },
    },
  );
}

export function publicProject(p, viewer) {
  const out = { id: String(p._id), name: p.name, timezone: p.timezone || null, isActive: p.isActive !== false };
  if (isAdmin(viewer)) Object.assign(out, { dbName: p.db_name, description: p.description || '' });
  return out;
}

export function publicAccount(a) {
  return {
    id: String(a._id),
    firstName: a.firstName || '',
    lastName: a.lastName || '',
    name: displayName(a),
    email: a.email || '',
    username: a.username || '',
    mobileNumber: a.mobileNumber || '',
    companyName: a.companyName || '',
    designation: a.designation || '',
    role: normalizeRole(a.role),
    projects: (a.projects || []).map(String),
    platformShared: a.platformShared || [],
    isActive: a.isActive !== false,
    selectedProject: a.selectedProject?._id ? { id: String(a.selectedProject._id), name: a.selectedProject.name } : null,
    dataScopes: a.dataScopes || {},
    hasPassword: Boolean(a.passwordHash),
    mustChangePassword: Boolean(a.mustChangePassword),
    teamsLinked: Boolean(a.teams?.aadObjectId),
    lastLoginAt: a.lastLoginAt || null,
    createdAt: a.createdAt || null,
  };
}

export { scopeFor };

export function audit(actor, action, target = {}, details = {}) {
  return col.audit()
    .insertOne({
      actor_id: actor?._id || null,
      actor: actor ? displayName(actor) : 'system',
      action,
      target,
      details,
      created_at: new Date(),
    })
    .catch((err) => logger.warn({ err: err.message }, 'Audit log write failed'));
}
