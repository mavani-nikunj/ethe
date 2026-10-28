import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PRODUCT_FULL_NAME, PRODUCT_LOGO_SRC, PRODUCT_MARK_SRC, PRODUCT_NAME } from '@ethesis/shared';
import { useAuth } from '../auth';
import { ErrorBox, Field } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      if (user.mustChangePassword) nav('/set-password');
      else if (user.role === 'SUPER_ADMIN') nav('/platform');
      else nav('/app');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-left">
        <div className="login-left-inner">
          <div className="login-brand-chip">
            <img src={PRODUCT_MARK_SRC} alt="" />
            <span>{PRODUCT_NAME}</span>
          </div>
          <div className="login-left-copy">
            <p className="login-kicker">Examination section</p>
            <h1>One desk for every course, every college.</h1>
            <p className="login-lead">
              {PRODUCT_NAME} — {PRODUCT_FULL_NAME}. PG, PhD and later courses run as blueprints on the same desk. Sign in;
              your institute is already known.
            </p>
          </div>
          <ul className="login-points">
            <li>
              <b>Thesis files</b>
              <span>Intake, numbering, and a live metro of every stage.</span>
            </li>
            <li>
              <b>Examiner panels</b>
              <span>Offers, consent, and evaluation from a single task link.</span>
            </li>
            <li>
              <b>One URL</b>
              <span>Each college keeps its own logo, people, and records.</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="login-right">
        <form className="login-card card" onSubmit={onSubmit}>
          <img className="login-product-logo" src={PRODUCT_LOGO_SRC} alt={PRODUCT_NAME} />
          <h2>Sign in</h2>
          <p style={{ color: 'var(--muted)', margin: '6px 0 16px' }}>Use your official email. One URL for all institutes.</p>
          <ErrorBox error={error} />
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <Field label="Email" required>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" required>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button className="btn" disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Enter workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
