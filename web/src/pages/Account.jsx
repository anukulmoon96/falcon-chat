import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, PageHead } from '../components/ui.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS } from '../lib/format.js';

const BLANK = { currentPassword: '', newPassword: '', confirm: '' };

export default function Account() {
  const { user, projects, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setSaved(false);
    if (form.newPassword !== form.confirm) {
      setErrors({ confirm: "The new passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      const forced = user.mustChangePassword;
      setForm(BLANK);
      setSaved(true);
      await refresh();
      if (forced) navigate('/chat', { replace: true });
    } catch (err) {
      setErrors({ ...fieldErrors(err), form: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <PageHead title="Your account" subtitle="Your details and where you can reach Falcon." />
      {user.mustChangePassword && <p className="notice">Set a new password to continue. The one you signed in with was temporary.</p>}
      <section className="panel">
        <dl className="facts">
          <div><dt>Name</dt><dd>{user.name}</dd></div>
          <div><dt>Work email</dt><dd>{user.email || '—'}</dd></div>
          <div><dt>WhatsApp number</dt><dd className="tabular">{user.mobileNumber || 'Not set'}</dd></div>
          <div><dt>Role</dt><dd>{ROLE_LABELS[user.role]}</dd></div>
          <div><dt>Channels</dt><dd>{user.platformShared.join(', ') || 'None'}</dd></div>
          <div><dt>Projects</dt><dd>{projects.map((p) => p.name).join(', ') || 'None yet'}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <h2>Change password</h2>
        <form className="form-grid" onSubmit={submit}>
          <Field label="Current password" error={errors.currentPassword} className="span-2">
            <input type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
          </Field>
          <Field label="New password" hint="At least 10 characters" error={errors.newPassword}>
            <input type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} required minLength={10} />
          </Field>
          <Field label="Confirm new password" error={errors.confirm}>
            <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
          </Field>
          {errors.form && <p className="form-error span-2" role="alert">{errors.form}</p>}
          {saved && <p className="success span-2" role="status">Password updated.</p>}
          <div className="span-2"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button></div>
        </form>
      </section>
    </div>
  );
}
