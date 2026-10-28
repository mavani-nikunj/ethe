import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { isValidEmail, isValidMobile, cleanMobile } from '@ethesis/shared';

const steps = ['Identity', 'Branding', 'First admin', 'Review'];

export function InstituteWizard() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; tempPassword: string } | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    code: '',
    type: 'MEDICAL',
    country: 'IN',
    primaryColor: '#0061f2',
    supportEmail: '',
    adminName: '',
    adminEmail: '',
    adminMobile: '',
    adminDesignation: 'College Admin',
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      if (form.supportEmail && form.supportEmail.trim() !== '' && !isValidEmail(form.supportEmail)) {
        setError('Please enter a valid support email address');
        return;
      }
    }
    if (step === 2) {
      if (!form.adminName.trim()) {
        setError('Admin name is required');
        return;
      }
      if (!isValidEmail(form.adminEmail)) {
        setError('Please enter a valid admin email address');
        return;
      }
      if (form.adminMobile && form.adminMobile.trim() !== '') {
        const clean = cleanMobile(form.adminMobile);
        if (!isValidMobile(clean)) {
          setError('Admin mobile must be a valid 10-digit Indian number starting with 6-9');
          return;
        }
      }
    }
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    try {
      const res = await post('/platform/institutes', form);
      if (logoFile && res.institute?.id) {
        const fd = new FormData();
        fd.append('logo', logoFile);
        await post(`/platform/institutes/${res.institute.id}/logo`, fd);
      }
      setInvite(res.invite);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Shell mode="platform">
      <div className="page-title">
        <div>
          <h1>Onboard institute</h1>
          <p>Creates the tenant and the first College Admin on this same URL.</p>
        </div>
      </div>
      <div className="wizard">
        {steps.map((s, i) => (
          <span key={s} className={i === step ? 'on' : ''}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <form className="card" onSubmit={onSubmit}>
        <ErrorBox error={error} />
        {invite && (
          <div className="okbox" style={{ marginBottom: 12 }}>
            College Admin {invite.email} — temporary password <b>{invite.tempPassword}</b> (shown once). They sign in on
            the same login page.
          </div>
        )}
        {step === 0 && (
          <div className="grid cols-2">
            <Field label="Legal name" required>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Display name">
              <input className="input" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
            </Field>
            <Field label="Short code" required>
              <input className="input" value={form.code} onChange={(e) => set('code', e.target.value)} required />
            </Field>
            <Field label="Type">
              <select value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option>MEDICAL</option>
                <option>UNIVERSITY</option>
                <option>COLLEGE</option>
              </select>
            </Field>
          </div>
        )}
        {step === 1 && (
          <div className="grid cols-2">
            <Field label="Institute logo">
              <input className="input" type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
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
            <Field label="Support email">
              <input
                className="input"
                type="email"
                placeholder="support@institute.edu"
                value={form.supportEmail}
                onChange={(e) => set('supportEmail', e.target.value.trim())}
              />
              {form.supportEmail && !isValidEmail(form.supportEmail) && (
                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                  Please enter a valid email address
                </span>
              )}
            </Field>
          </div>
        )}
        {step === 2 && (
          <div className="grid cols-2">
            <Field label="Admin name" required>
              <input className="input" value={form.adminName} onChange={(e) => set('adminName', e.target.value)} required />
            </Field>
            <Field label="Admin email" required>
              <input
                className="input"
                type="email"
                placeholder="admin@institute.edu"
                value={form.adminEmail}
                onChange={(e) => set('adminEmail', e.target.value.trim())}
                required
              />
              {form.adminEmail && !isValidEmail(form.adminEmail) && (
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
                value={form.adminMobile}
                onChange={(e) => set('adminMobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              {form.adminMobile && !isValidMobile(form.adminMobile) && (
                <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                  Must be 10 digits starting with 6, 7, 8, or 9
                </span>
              )}
            </Field>
            <Field label="Designation">
              <input className="input" value={form.adminDesignation} onChange={(e) => set('adminDesignation', e.target.value)} />
            </Field>
          </div>
        )}
        {step === 3 && !invite && (
          <div>
            <p>
              <b>{form.displayName || form.name}</b> ({form.code}) · {form.type}
            </p>
            <p>
              First admin: {form.adminName} &lt;{form.adminEmail}&gt;
            </p>
          </div>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          {step > 0 && !invite && (
            <button type="button" className="btn secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {!invite && (
            <button className="btn" type="submit">
              {step < 3 ? 'Continue' : 'Create institute'}
            </button>
          )}
          {invite && (
            <button className="btn" type="button" onClick={() => nav('/platform/institutes')}>
              Done
            </button>
          )}
        </div>
      </form>
    </Shell>
  );
}
