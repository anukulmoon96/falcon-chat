export const ROLES = ['admin', 'sub_admin', 'end_user'];

// Values stored in accounts.platformShared (matches the existing Falcon data).
export const PLATFORMS = ['WhatsApp', 'Teams', 'Web Portal'];

export const SCOPE_COLUMNS = {
  location_ids: 'location_id',
  sub_location_ids: 'sub_location_id',
  camera_ids: 'camera_id',
  event_ids: 'event_id',
};
export const SCOPE_KEYS = Object.keys(SCOPE_COLUMNS);

const GRANTS = {
  admin: [
    'chat.use', 'console.view', 'users.view', 'users.manage', 'projects.view', 'projects.manage',
    'knowledge.manage', 'conversations.view', 'sql.view', 'usage.view', 'audit.view',
  ],
  sub_admin: [
    'chat.use', 'console.view', 'users.view', 'users.manage', 'projects.view',
    'knowledge.manage', 'conversations.view', 'sql.view', 'usage.view',
  ],
  end_user: ['chat.use'],
};

export function normalizeRole(role) {
  const r = String(role || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (r === 'admin' || r === 'super_admin' || r === 'superadmin') return 'admin';
  if (r === 'sub_admin' || r === 'subadmin' || r === 'manager') return 'sub_admin';
  return 'end_user';
}

export const permissionsFor = (account) => GRANTS[normalizeRole(account?.role)];
export const can = (account, permission) => permissionsFor(account).includes(permission);
export const isAdmin = (account) => normalizeRole(account?.role) === 'admin';
export const projectIdsOf = (account) => (account?.projects || []).map(String);

export function canUseProject(account, projectId) {
  return isAdmin(account) || projectIdsOf(account).includes(String(projectId));
}

// platformShared decides which channels a person may use to reach Falcon.
// Admins can always open the Web Portal so they can never lock themselves out.
export function platformAllowed(account, platform) {
  if (platform === 'Web Portal' && isAdmin(account)) return true;
  return (account?.platformShared || []).includes(platform);
}

// Returns { location_ids?, sub_location_ids?, camera_ids?, event_ids? } or null for "everything".
export function scopeFor(account, projectId) {
  if (isAdmin(account)) return null;
  const raw = account?.dataScopes?.[String(projectId)];
  if (!raw) return null;
  const scope = {};
  for (const key of SCOPE_KEYS) {
    if (Array.isArray(raw[key]) && raw[key].length) scope[key] = raw[key].map(String);
  }
  return Object.keys(scope).length ? scope : null;
}

// A sub-admin can only grant what they have: a narrower scope inside their own.
export function constrainScope(actorScope, requested = {}) {
  if (!actorScope) return requested;
  const out = {};
  for (const key of SCOPE_KEYS) {
    const mine = actorScope[key];
    const wanted = (requested[key] || []).map(String);
    if (!mine) out[key] = wanted;
    else out[key] = wanted.length ? wanted.filter((v) => mine.includes(v)) : [...mine];
  }
  return out;
}

export function canManageAccount(actor, target) {
  if (isAdmin(actor)) return true;
  if (normalizeRole(actor?.role) !== 'sub_admin') return false;
  if (normalizeRole(target?.role) !== 'end_user') return false;
  const mine = new Set(projectIdsOf(actor));
  const theirs = projectIdsOf(target);
  return theirs.length > 0 && theirs.every((id) => mine.has(id));
}
