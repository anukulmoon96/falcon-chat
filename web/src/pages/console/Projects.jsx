import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PlugZap, Plus } from 'lucide-react';
import Modal from '../../components/Modal.jsx';
import { Badge, Empty, Field, PageHead, Status } from '../../components/ui.jsx';
import { api, fieldErrors } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtNumber } from '../../lib/format.js';

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

export default function Projects() {
  const { refresh } = useAuth();
  const list = useQuery({ queryKey: ['projects'], queryFn: () => api('/projects') });
  const [editing, setEditing] = useState(null);
  const [tests, setTests] = useState({});

  async function test(p) {
    setTests((t) => ({ ...t, [p.id]: { running: true } }));
    const res = await api(`/projects/${p.id}/test`, { method: 'POST' }).catch((err) => ({ ok: false, error: err.message }));
    setTests((t) => ({ ...t, [p.id]: res }));
  }

  return (
    <div className="page">
      <PageHead title="Projects" subtitle="Each project reads one MySQL database of alerts. Times in answers use the project's time zone.">
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Plus aria-hidden="true" />Add project</button>
      </PageHead>
      {list.isError && <p className="form-error">{list.error.message}</p>}
      <section className="panel flush">
        {list.data?.length ? (
          <div className="table-wrap">
            <table className="list-table">
              <thead><tr><th>Project</th><th>Database</th><th>Time zone</th><th>Status</th><th>Connection</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td><span className="cell-main">{p.name}</span>{p.description && <span className="cell-sub">{p.description}</span>}</td>
                    <td><code>{p.dbName}</code></td>
                    <td>{p.timezone || 'Default'}</td>
                    <td>{p.isActive ? <Status>Active</Status> : <Badge>Paused</Badge>}</td>
                    <td><TestResult result={tests[p.id]} /></td>
                    <td className="cell-actions nowrap">
                      <button type="button" className="btn btn-ghost" onClick={() => test(p)} aria-label={`Test the connection to ${p.name}`}><PlugZap aria-hidden="true" />Test</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{list.isPending ? 'Loading projects…' : 'No projects yet.'}</Empty>}
      </section>
      {editing && (
        <ProjectEditor
          project={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); list.refetch(); refresh(); }}
        />
      )}
    </div>
  );
}

function TestResult({ result }) {
  if (!result) return <span className="muted">Not checked</span>;
  if (result.running) return <span className="muted">Checking…</span>;
  if (!result.ok) return <span className="text-danger">{result.error}</span>;
  return (
    <span className="test-result">
      <span>{fmtNumber(result.stats.alerts)} alerts{result.stats.last_alert ? `, latest ${result.stats.last_alert}` : ''}</span>
      {!result.dedicatedUser && <Badge tone="amber">Shared MySQL user</Badge>}
    </span>
  );
}

function ProjectEditor({ project, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: project?.name || '',
    dbName: project?.dbName || '',
    timezone: project?.timezone || 'Asia/Kolkata',
    description: project?.description || '',
    isActive: project?.isActive ?? true,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const first = useRef(null);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Start in the first field rather than on the dialog's close button.
  useEffect(() => { first.current?.focus(); }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (project) await api(`/projects/${project.id}`, { method: 'PATCH', body: form });
      else await api('/projects', { method: 'POST', body: form });
      onSaved();
    } catch (err) {
      setErrors({ ...fieldErrors(err), form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={project ? `Edit ${project.name}` : 'Add project'}
      footer={(
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save project'}</button>
        </>
      )}
    >
      <form id="project-form" className="form-grid" onSubmit={save}>
        <Field label="Name" error={errors.name} className="span-2"><input ref={first} value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="MySQL database" hint="The project's database, e.g. LLM_GWR_DB" error={errors.dbName}>
          <input value={form.dbName} onChange={(e) => set('dbName', e.target.value)} required />
        </Field>
        <Field label="Time zone" hint="Used for “today”, “last week” and hourly answers" error={errors.timezone}>
          <input list="time-zones" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} required />
          <datalist id="time-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
        <Field label="Description" error={errors.description} className="span-2"><input value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <label className="check span-2"><input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />Active (paused projects can't be asked about)</label>
        {errors.form && <p className="form-error span-2" role="alert">{errors.form}</p>}
      </form>
    </Modal>
  );
}
