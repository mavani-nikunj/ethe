import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Field } from '../components/ui';

export function SetPasswordPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/auth/set-password', { currentPassword, newPassword });
      await refresh();
      nav(user?.role === 'SUPER_ADMIN' ? '/platform' : '/app');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="login-right" style={{ minHeight: '100%' }}>
      <form className="login-card card" onSubmit={onSubmit}>
        <h2>Set your password</h2>
        <p style={{ color: 'var(--muted)' }}>This is your first sign-in. Choose a password of at least 8 characters.</p>
        <ErrorBox error={error} />
        <div className="grid" style={{ gap: 12, marginTop: 12 }}>
          <Field label="Temporary password" required>
            <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required>
            <input className="input" type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </Field>
          <button className="btn" type="submit">
            Save and continue
          </button>
        </div>
      </form>
    </div>
  );
}
