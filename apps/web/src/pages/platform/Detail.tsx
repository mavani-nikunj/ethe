import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, patch, post } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, Pill } from '../../components/ui';
import { isValidEmail, isValidMobile, cleanMobile } from '@ethesis/shared';

function dash(value?: ReactNode) {
  if (value === 0) return 0;
  if (value === null || value === undefined || value === '') return '—';
  return value;
}

function formatDateTime(value?: string | Date) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function countryLabel(code?: string) {
  if (!code) return '';
  if (code === 'IN') return 'India';
  return code;
}

function logoSrc(logoUrl?: string) {
  if (!logoUrl) return '';
  if (logoUrl.startsWith('http') || logoUrl.startsWith('/')) return logoUrl;
  return `/api/uploads/${logoUrl}`;
}

function InfoRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{dash(value)}</dd>
    </div>
  );
}

export function InstituteDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [admin, setAdmin] = useState({ name: '', email: '', mobile: '', designation: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    type: 'MEDICAL',
    country: 'IN',
    primaryColor: '#0061f2',
    supportEmail: '',
  });

  async function load() {
    setData(await get(`/platform/institutes/${id}`));
  }
  useEffect(() => {
    load();
  }, [id]);

  function startEdit() {
    setError(null);
    setForm({
      name: data.name || '',
      displayName: data.displayName || '',
      type: data.type || 'MEDICAL',
      country: data.country || 'IN',
      primaryColor: data.primaryColor || '#0061f2',
      supportEmail: data.supportEmail || '',
    });
    setEditing(true);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (form.supportEmail && form.supportEmail.trim() !== '' && !isValidEmail(form.supportEmail)) {
      setError('Please enter a valid support email address');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await patch(`/platform/institutes/${id}`, form);
      await load();
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <Shell mode="platform">Loading…</Shell>;

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Shell mode="platform">
      <div className="page-title">
        <div>
          <p style={{ margin: '0 0 6px' }}>
            <Link to="/platform/institutes" className="link" style={{ marginTop: 0 }}>
              ← Institutes
            </Link>
          </p>
          <h1>{data.displayName || data.name}</h1>
          <p>
            {data.code} · {data.type}
            {data.name && data.name !== data.displayName ? ` · ${data.name}` : ''}
          </p>
        </div>
        <div className="row">
          <Pill status={data.status} />
          {data.status !== 'SUSPENDED' ? (
            <button className="btn danger" onClick={async () => { await patch(`/platform/institutes/${id}/status`, { status: 'SUSPENDED' }); load(); }}>
              Suspend
            </button>
          ) : (
            <button className="btn" onClick={async () => { await patch(`/platform/institutes/${id}/status`, { status: 'ACTIVE' }); load(); }}>
              Activate
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Identity</h3>
          {!editing && (
            <button type="button" className="btn secondary small" onClick={startEdit}>
              Edit details
            </button>
          )}
        </div>
        <ErrorBox error={error} />
        {editing ? (
          <form className="grid cols-2" onSubmit={saveEdit}>
            <Field label="Legal name" required>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Display name">
              <input className="input" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
            </Field>
            <Field label="Short code">
              <input className="input" value={data.code} disabled title="Short code cannot be changed" />
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option>MEDICAL</option>
                <option>UNIVERSITY</option>
                <option>COLLEGE</option>
              </select>
            </Field>
            <Field label="Country">
              <input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} />
            </Field>
            <Field label="Support email">
              <input className="input" type="email" value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} />
            </Field>
            <Field label="Primary color">
              <div className="row color-field">
                <input
                  type="color"
                  className="input color-swatch"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : '#0061f2'}
                  onChange={(e) => set('primaryColor', e.target.value)}
                />
                <input className="input" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
              </div>
            </Field>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="info-dl">
            <InfoRow label="Legal name" value={data.name} />
            <InfoRow label="Display name" value={data.displayName} />
            <InfoRow label="Short code" value={data.code} />
            <InfoRow label="Type" value={data.type} />
            <InfoRow label="Country" value={countryLabel(data.country)} />
            <InfoRow label="Status" value={<Pill status={data.status} />} />
          </dl>
        )}

        <div className="info-section">
          <h3>Branding</h3>
          <dl className="info-dl">
            <div className="info-row">
              <dt>Logo</dt>
              <dd>
                {data.logoUrl ? (
                  <img
                    src={logoSrc(data.logoUrl)}
                    alt={`${data.displayName || data.name} logo`}
                    style={{ height: 56, maxWidth: 220, objectFit: 'contain', display: 'block', margin: '4px 0 10px' }}
                  />
                ) : (
                  <span style={{ color: 'var(--muted)' }}>No logo uploaded yet.</span>
                )}
                <Field label="Upload logo">
                  <input
                    className="input"
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        setError(null);
                        const fd = new FormData();
                        fd.append('logo', file);
                        await post(`/platform/institutes/${id}/logo`, fd);
                        await load();
                      } catch (err: any) {
                        setError(err.message);
                      }
                    }}
                  />
                </Field>
              </dd>
            </div>
            {!editing && (
              <>
                <InfoRow
                  label="Primary color"
                  value={
                    data.primaryColor ? (
                      <span className="row" style={{ gap: 8 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            background: data.primaryColor,
                            border: '1px solid var(--line)',
                            display: 'inline-block',
                          }}
                        />
                        {data.primaryColor}
                      </span>
                    ) : (
                      ''
                    )
                  }
                />
                <InfoRow label="Support email" value={data.supportEmail} />
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>College Admin</h3>
          {data.admin ? (
            <dl className="info-dl" style={{ marginBottom: 12 }}>
              <InfoRow label="Name" value={data.admin.name} />
              <InfoRow label="Email" value={data.admin.email} />
              <InfoRow label="Mobile" value={data.admin.mobile} />
              <InfoRow label="Designation" value={data.admin.designation} />
              <InfoRow label="Status" value={<Pill status={data.admin.status} />} />
            </dl>
          ) : (
            <p style={{ color: 'var(--muted)' }}>None assigned yet.</p>
          )}
          <ErrorBox error={adminError} />
          {invite && (
            <div className="okbox">
              Temp password for {invite.email}: <b>{invite.tempPassword}</b>
            </div>
          )}
          <div className="grid" style={{ marginTop: 12 }}>
            <Field label="Name">
              <input className="input" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
            </Field>
            <Field label="Email" required>
              <input className="input" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value.trim() })} />
              {admin.email && !isValidEmail(admin.email) && (
                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                  Please enter a valid email address
                </span>
              )}
            </Field>
            <Field label="Mobile">
              <input
                className="input"
                type="tel"
                maxLength={10}
                placeholder="10-digit mobile"
                value={admin.mobile}
                onChange={(e) => setAdmin({ ...admin, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              />
              {admin.mobile && !isValidMobile(admin.mobile) && (
                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                  Must be 10 digits starting with 6, 7, 8, or 9
                </span>
              )}
            </Field>
            <Field label="Designation">
              <input className="input" value={admin.designation} onChange={(e) => setAdmin({ ...admin, designation: e.target.value })} />
            </Field>
            <button
              className="btn secondary"
              onClick={async () => {
                try {
                  setAdminError(null);
                  if (!admin.name.trim()) {
                    setAdminError('Admin name is required');
                    return;
                  }
                  if (!isValidEmail(admin.email)) {
                    setAdminError('Please enter a valid admin email address');
                    return;
                  }
                  let clean = '';
                  if (admin.mobile && admin.mobile.trim() !== '') {
                    clean = cleanMobile(admin.mobile);
                    if (!isValidMobile(clean)) {
                      setAdminError('Admin mobile must be a valid 10-digit Indian number starting with 6-9');
                      return;
                    }
                  }
                  setInvite(
                    await post(`/platform/institutes/${id}/admin`, {
                      name: admin.name,
                      email: admin.email,
                      ...(clean ? { mobile: clean } : {}),
                      ...(admin.designation ? { designation: admin.designation } : {}),
                    }),
                  );
                  load();
                } catch (e: any) {
                  setAdminError(e.message);
                }
              }}
            >
              Invite / rotate admin
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Audit</h3>
          {(data.audit || []).length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {(data.audit || []).map((a: any) => (
                  <tr key={a._id}>
                    <td>{a.action}</td>
                    <td>{formatDateTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="info-empty">No platform actions recorded for this institute yet.</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
