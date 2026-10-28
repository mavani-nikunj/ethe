import { FormEvent, useEffect, useState } from 'react';
import { get, post } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, Pill } from '../../components/ui';
import { isValidEmail } from '@ethesis/shared';

export function DepartmentLoginsPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const [form, setForm] = useState({ name: '', email: '', courseIds: [] as string[] });

  async function load() {
    setCourses(await get('/masters/courses'));
    setRows(await get('/masters/department-users'));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function courseLabel(c: any) {
    return c.courseTypeName ? `${c.name} (${c.courseTypeName})` : c.name;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!isValidEmail(form.email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (!form.courseIds.length) {
      setError('Map this login to at least one course');
      return;
    }
    setError(null);
    try {
      const res = await post('/masters/staff', {
        name: form.name,
        email: form.email,
        role: 'COURSE',
        courseIds: form.courseIds,
      });
      setInvite(res);
      setForm({ name: '', email: '', courseIds: [] });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function resetPassword(row: any) {
    if (!confirm(`Reset password for ${row.email} to Welcome@123?`)) return;
    setError(null);
    try {
      const res = await post(`/masters/staff/${row._id}/reset-password`, {});
      setInvite({ user: { email: res.email }, tempPassword: res.tempPassword });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Academic logins</h1>
          <p>
            Create courses in Masters first, then issue a login here. Map one or more courses — that academic login adds
            the candidate, thesis PDF and Chief Guide only for those courses.
          </p>
        </div>
      </div>
      <div className="staff-split">
        <form className="card" onSubmit={onSubmit}>
          <h3>Create academic login</h3>
          <ErrorBox error={error} />
          {invite && (
            <div className="okbox">
              {invite.user?.email} — temporary password: <b>{invite.tempPassword}</b>
            </div>
          )}
          <div className="grid cols-3">
            <Field label="Name" required>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Email" required>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} required />
              {form.email.trim() && !isValidEmail(form.email) && (
                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                  Please enter a valid email address
                </span>
              )}
            </Field>
            <div className="field">
              <span>
                Courses
                <span className="req"> *</span>
              </span>
              <div className="check-list">
                {courses.length ? (
                  courses.map((c) => {
                    const id = String(c._id);
                    const checked = form.courseIds.includes(id);
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm({
                              ...form,
                              courseIds: checked
                                ? form.courseIds.filter((x) => x !== id)
                                : [...form.courseIds, id],
                            })
                          }
                        />
                        {courseLabel(c)}
                      </label>
                    );
                  })
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Add courses in Masters first.</span>
                )}
              </div>
              <span className="field-hint">This email will only see thesis for the ticked courses.</span>
            </div>
          </div>
          <button className="btn" style={{ marginTop: 10 }} type="submit">
            Create and send mail
          </button>
        </form>
        <div className="card staff-grid-card">
          <h3 style={{ marginBottom: 10 }}>Existing academic logins</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Courses</th>
                <th>Password</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td>
                    {r.name}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email}</div>
                  </td>
                  <td>
                    {(r.courseIds || [])
                      .map((id: any) => {
                        const c = courses.find((row) => String(row._id) === String(id));
                        return c ? courseLabel(c) : null;
                      })
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                  <td>
                    <div>
                      {r.mustChangePassword && r.tempPassword ? (
                        <code>{r.tempPassword}</code>
                      ) : r.mustChangePassword ? (
                        <code>Welcome@123</code>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Set by user</span>
                      )}
                    </div>
                    <button type="button" className="link" onClick={() => resetPassword(r)}>
                      Reset to default
                    </button>
                  </td>
                  <td>
                    <Pill status={r.status} />
                  </td>
                  <td>
                    <button
                      className="btn secondary small"
                      onClick={() =>
                        post(`/masters/department-users/${r._id}/invite`, {})
                          .then((res) => {
                            setInvite({ user: { email: res.email }, tempPassword: res.tempPassword });
                            return load();
                          })
                          .catch((err) => setError(err.message))
                      }
                    >
                      Resend mail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
