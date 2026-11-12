import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, Mark } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const me = await login(email, password);
      navigate(me.user.mustChangePassword ? '/account' : '/chat', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-lg"><Mark size={34} /><span>Falcon</span></div>
        <div>
          <h1>Sign in</h1>
          <p className="muted">Ask about your sites' safety alerts and get answers with charts, tables and the camera frames behind them.</p>
        </div>
        <Field label="Work email">
          <input type="email" autoComplete="username" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Falcon also answers on WhatsApp and Microsoft Teams when your administrator turns those channels on for you.</p>
      </form>
    </div>
  );
}
