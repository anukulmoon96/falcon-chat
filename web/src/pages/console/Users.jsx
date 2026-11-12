import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Search } from 'lucide-react';
import Modal from '../../components/Modal.jsx';
import MultiSelect from '../../components/MultiSelect.jsx';
import { Badge, Empty, Field, PageHead, Status } from '../../components/ui.jsx';
import { api, fieldErrors } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { PLATFORMS, ROLES, ROLE_LABELS, fmtDateTime } from '../../lib/format.js';

const BLANK = {
  firstName: '', lastName: '', email: '', mobileNumber: '', companyName: '', designation: '',
  role: 'end_user', projects: [], platformShared: ['Web Portal'], isActive: true, dataScopes: {},
};
const SCOPES = [['location_ids', 'Locations', 'locations'], ['sub_location_ids', 'Zones', 'zones'], ['camera_ids', 'Cameras', 'cameras'], ['event_ids', 'Use cases', 'events']];

export default function Users() {
  const { projects, can } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState(null);
  const [secret, setSecret] = useState(null);
  const search = useDeferredValue(q);
  const params = new URLSearchParams(Object.entries({ q: search, role }).filter(([, v]) => v));
  const list = useQuery({ queryKey: ['accounts', params.toString()], queryFn: () => api(`/accounts?${params}`) });
  const names = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const canManage = can('users.manage');

  const projectList = (u) => {
    if (u.role === 'admin') return 'All projects';
    const labels = u.projects.map((id) => names.get(id) || 'Other');
    return labels.length ? `${labels.slice(0, 2).join(', ')}${labels.length > 2 ? ` +${labels.length - 2}` : ''}` : '—';
  };

  function saved(res) {
    setEditing(null);
    list.refetch();
    if (res?.temporaryPassword) setSecret({ name: res.user?.name || 'this person', password: res.temporaryPassword });
  }

  return (
    <div className="page">
      <PageHead title="Users" subtitle="Who can ask Falcon, through which channels, and about which data.">
        {canManage && <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Plus aria-hidden="true" />Add user</button>}
      </PageHead>
      <div className="toolbar">
        <label className="search">
          <Search aria-hidden="true" />
          <input type="search" placeholder="Search name, email or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </label>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      {list.isError && <p className="form-error">{list.error.message}</p>}
      <section className="panel flush">
        {list.data?.length ? (
          <div className="table-wrap">
            <table className="list-table">
              <thead>
                <tr><th>Name</th><th>WhatsApp number</th><th>Role</th><th>Projects</th><th>Channels</th><th>Status</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {list.data.map((u) => (
                  <tr key={u.id}>
                    <td><span className="cell-main">{u.name}</span><span className="cell-sub">{u.email}</span></td>
                    <td className="tabular">{u.mobileNumber || '—'}</td>
                    <td className={u.role === 'admin' ? 'cell-role-admin' : undefined}>{ROLE_LABELS[u.role]}</td>
                    <td className="cell-projects">{projectList(u)}</td>
                    <td className="cell-channels">{u.platformShared.length ? u.platformShared.join(', ') : '—'}</td>
                    <td>{u.isActive ? <Status>Active</Status> : <Badge tone="danger">Inactive</Badge>}</td>
                    <td className="muted nowrap">{fmtDateTime(u.lastLoginAt)}</td>
                    <td className="cell-actions">{canManage && <button type="button" className="btn btn-ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{list.isPending ? 'Loading users…' : 'No users match.'}</Empty>}
      </section>

      {editing && <UserEditor user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />}

      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Temporary password" footer={<button type="button" className="btn btn-primary" onClick={() => setSecret(null)}>Done</button>}>
        {secret && (
          <>
            <p>Share this with {secret.name} through a secure channel. It's shown only once, and they'll choose their own password after signing in.</p>
            <div className="secret">
              <code>{secret.password}</code>
              <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(secret.password)}><Copy aria-hidden="true" />Copy</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

const formFrom = (u) => ({
  firstName: u.firstName, lastName: u.lastName, email: u.email, mobileNumber: u.mobileNumber, companyName: u.companyName,
  designation: u.designation, role: u.role, projects: u.projects, platformShared: u.platformShared, isActive: u.isActive, dataScopes: u.dataScopes || {},
});

function UserEditor({ user, onClose, onSaved }) {
  const { user: me, projects } = useAuth();
  const isAdmin = me.role === 'admin';
  const [form, setForm] = useState(() => (user ? { ...BLANK, ...formFrom(user) } : BLANK));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const first = useRef(null);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = (key, value) => setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
  const roles = isAdmin ? ROLES : ['end_user'];

  // Start in the first field rather than on the dialog's close button. Runs after the
  // Modal (a child) has opened the dialog.
  useEffect(() => { first.current?.focus(); }, []);
  const channels = isAdmin ? PLATFORMS : PLATFORMS.filter((p) => me.platformShared.includes(p));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body = { ...form, dataScopes: Object.fromEntries(form.projects.map((id) => [id, form.dataScopes[id] || {}])) };
    try {
      const res = user
        ? await api(`/accounts/${user.id}`, { method: 'PATCH', body })
        : await api('/accounts', { method: 'POST', body });
      onSaved(res);
    } catch (err) {
      setErrors({ ...fieldErrors(err), form: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    try {
      const res = await api(`/accounts/${user.id}/reset-password`, { method: 'POST' });
      onSaved({ ...res, user });
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <>
      {user && <button type="button" className="btn btn-ghost" onClick={resetPassword} disabled={busy}><KeyRound aria-hidden="true" />Reset password</button>}
      <span className="spacer" />
      <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : user ? 'Save changes' : 'Add user'}</button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : 'Add user'} wide footer={footer}>
      <form id="user-form" className="form-grid" onSubmit={save}>
        <Field label="First name" error={errors.firstName}><input ref={first} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required /></Field>
        <Field label="Last name" error={errors.lastName}><input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
        <Field label="Work email" hint="Used to sign in and to link their Teams account" error={errors.email}>
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </Field>
        <Field label="WhatsApp number" hint="Country code and number, e.g. 919820000000" error={errors.mobileNumber}>
          <input inputMode="tel" value={form.mobileNumber} onChange={(e) => set('mobileNumber', e.target.value)} />
        </Field>
        <Field label="Company" error={errors.companyName}><input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
        <Field label="Designation" error={errors.designation}><input value={form.designation} onChange={(e) => set('designation', e.target.value)} /></Field>
        <Field label="Role" error={errors.role}>
          <select value={form.role} onChange={(e) => set('role', e.target.value)}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
        </Field>
        <div className="field">
          <span className="field-label">Status</span>
          <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />Active</label>
        </div>

        <fieldset className="span-2">
          <legend>Channels</legend>
          <p className="hint">Where this person can chat with Falcon.</p>
          <div className="check-row">
            {channels.map((p) => <label key={p} className="check"><input type="checkbox" checked={form.platformShared.includes(p)} onChange={() => toggle('platformShared', p)} />{p}</label>)}
          </div>
        </fieldset>

        {form.role !== 'admin' && (
          <fieldset className="span-2">
            <legend>Projects</legend>
            {errors.projects && <p className="field-error">{errors.projects}</p>}
            <div className="check-grid">
              {projects.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={form.projects.includes(p.id)} onChange={() => toggle('projects', p.id)} />{p.name}</label>)}
            </div>
          </fieldset>
        )}

        {form.role !== 'admin' && form.projects.length > 0 && (
          <fieldset className="span-2">
            <legend>Data access</legend>
            <p className="hint">Limit what this person can ask about in each project. "All" means no limit.</p>
            {form.projects.map((id) => (
              <ScopeEditor
                key={id}
                projectId={id}
                name={projects.find((p) => p.id === id)?.name || 'Project'}
                value={form.dataScopes[id] || {}}
                onChange={(scope) => set('dataScopes', { ...form.dataScopes, [id]: scope })}
              />
            ))}
          </fieldset>
        )}
        {errors.form && <p className="form-error span-2" role="alert">{errors.form}</p>}
      </form>
    </Modal>
  );
}

function ScopeEditor({ projectId, name, value, onChange }) {
  const knowledge = useQuery({ queryKey: ['knowledge', projectId], queryFn: () => api(`/projects/${projectId}/knowledge`) });
  const entities = knowledge.data?.entities;
  return (
    <div className="scope">
      <p className="scope-title">{name}</p>
      {knowledge.isPending ? <p className="muted small">Loading names…</p> : (
        <div className="scope-grid">
          {SCOPES.map(([key, label, kind]) => (
            <MultiSelect
              key={key}
              label={label}
              options={(entities?.[kind] || []).map((e) => ({ value: String(e.id), label: e.name }))}
              value={value[key] || []}
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
