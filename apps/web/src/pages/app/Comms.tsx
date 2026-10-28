import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, MailBodyView, Pill, ResultDialog } from '../../components/ui';
import { RichTextEditor, htmlHasText, toEditorHtml } from '../../components/RichTextEditor';
import { hasLetterhead, LETTERHEAD_LOGO_SRC, stripLetterhead, withLetterhead, withLetterheadLogo } from '@ethesis/shared';
import { useAuth } from '../../auth';

type Channel = 'EMAIL' | 'LETTER';

/** One mail / letter the platform sends (GET /comms/catalog). */
type CatalogItem = {
  channel: Channel;
  purpose: string;
  group: string;
  name: string;
  stageCode?: string;
  subject: string;
  body: string;
  placeholders: string[];
};

const CUSTOM = '__custom__';

const SAMPLE_VARS: Record<string, string> = {
  candidateName: 'Sample Candidate',
  enrollmentNo: 'ENR0001',
  thesisTitle: 'Sample thesis title',
  thesisNumber: 'TH-1001',
  fileNo: 'EX-1001',
  instituteName: 'Sample Institute',
  chiefGuideName: 'Dr. Guide',
  chiefGuideEmail: 'guide@example.edu',
  stageName: 'evaluate',
  feeAmount: '4000',
  department: 'Sample Department',
  course: 'Sample Course',
  courseType: 'PhD',
  examinerName: 'Dr. Examiner',
  examinerDesignation: 'Professor',
  speciality: 'Sample Speciality',
  sessionMonth: 'November',
  sessionYear: '2026',
  taskLink: 'https://example.edu/task/…',
  otp: '123456',
  reminderLevel: '1',
  panelList:
    '1. Dr. Sample Examiner\n   Email: examiner@example.edu\n   Bucket: Delhi\n   Affiliation: Sample Institute',
  date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
  adName: 'Prof. Associate Dean',
  adEmail: 'associate.dean@example.edu',
  examinerType: 'External Examiner',
  examinerCode: 'EX-01',
  designation: 'Professor',
  examinerInstitute: 'Sample Medical College',
  examinerAddress: 'Sample City',
  mobile: '9999999999',
  email: 'examiner@example.edu',
  portalLink: 'https://example.edu/portal/…',
  deanName: 'Prof. Associate Dean',
  dealingEmail: 'dealing@example.edu',
  tentativeSchedule: '10–15 December 2026',
  practicalDate: '12/12/2026',
  supervisorName: 'Dr. Supervisor',
  supervisorInstitute: 'Sample Institute',
  aceName: 'Asstt. Controller (Exams)',
  name: 'Sample User',
  examinerRole: 'Indian examiner',
};

function interpolate(body: string, extra: Record<string, string> = {}) {
  const vars = { ...SAMPLE_VARS, ...extra };
  return withLetterheadLogo(body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''))
    .replace(/<img\b[^>]*\bsrc=(["'])\s*\1[^>]*>/gi, '');
}

function emptyTpl(channel: Channel) {
  return {
    name: '',
    channel,
    subject: '',
    body: '',
    stageCode: '',
    purpose: '',
    active: false,
  };
}

export function CommsPage() {
  const { channel: channelParam } = useParams();
  const slug = String(channelParam || '').toLowerCase();
  if (slug !== 'email' && slug !== 'letter') return <Navigate to="/app/comms/email" replace />;
  const channel: Channel = slug === 'letter' ? 'LETTER' : 'EMAIL';
  return <CommsChannelPage key={channel} channel={channel} />;
}

function CommsChannelPage({ channel }: { channel: Channel }) {
  const isLetter = channel === 'LETTER';
  const { user } = useAuth();
  const sampleExtra = { logoUrl: LETTERHEAD_LOGO_SRC, instituteName: user?.institute?.name || SAMPLE_VARS.instituteName };
  // Bumped when the body is replaced from outside the editor (letterhead insert/remove) so it re-reads the value.
  const [editorNonce, setEditorNonce] = useState(0);
  const [templates, setTemplates] = useState<any[]>([]);
  const [allPlaceholders, setAllPlaceholders] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customPurpose, setCustomPurpose] = useState(false);
  const [form, setForm] = useState<any>(emptyTpl(channel));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const qs = useMemo(() => `channel=${channel}`, [channel]);

  async function load() {
    // Templates first: listing inserts the starting copy of any catalog mail / letter the institute does not have yet.
    setTemplates(await get(`/comms/templates?${qs}`));
    setAllPlaceholders(await get('/comms/placeholders'));
    setCatalog(await get(`/comms/catalog?${qs}`));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [qs]);

  function resetForm() {
    setForm(emptyTpl(channel));
    setEditingId(null);
    setCustomPurpose(false);
    setError(null);
  }

  const byPurpose = useMemo(() => new Map(catalog.map((c) => [c.purpose, c])), [catalog]);
  const groups = useMemo(() => [...new Set(catalog.map((c) => c.group))], [catalog]);
  const entry = byPurpose.get(form.purpose);
  const placeholders = entry?.placeholders?.length ? entry.placeholders : allPlaceholders;
  // Catalog purposes with no active template: the built-in starting copy goes out until one is activated.
  const missingActive = catalog.filter((c) => !templates.some((t) => t.purpose === c.purpose && t.active));

  function pickPurpose(value: string) {
    if (value === CUSTOM) {
      setCustomPurpose(true);
      setForm({ ...form, purpose: '' });
      return;
    }
    setCustomPurpose(false);
    setForm({ ...form, purpose: value, name: form.name || byPurpose.get(value)?.name || '' });
  }

  function loadDefault() {
    if (!entry) return;
    setForm({ ...form, name: form.name || entry.name, subject: entry.subject, body: entry.body, stageCode: entry.stageCode || '' });
    setEditorNonce((n) => n + 1);
  }

  async function addMissing() {
    setError(null);
    try {
      const res = await post<{ created: number }>(`/comms/seed-defaults?channel=${channel}`, {});
      await load();
      setResult({
        ok: true,
        message: res.created ? `${res.created} default ${isLetter ? 'letter' : 'mail'}(s) added.` : 'Every default is already in the list.',
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveTpl(e: FormEvent, asActive: boolean) {
    e.preventDefault();
    setError(null);
    if (!htmlHasText(form.body)) {
      setError('Body is required');
      return;
    }
    try {
      const payload = { ...form, channel, active: asActive };
      if (editingId) await patch(`/comms/templates/${editingId}`, payload);
      else await post('/comms/templates', payload);
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function insertLetterhead() {
    setForm({ ...form, body: withLetterhead(toEditorHtml(form.body)) });
    setEditorNonce((n) => n + 1);
  }

  function removeLetterhead() {
    setForm({ ...form, body: stripLetterhead(form.body) });
    setEditorNonce((n) => n + 1);
  }

  function previewForm() {
    setView({
      subject: interpolate(form.subject || form.name || (isLetter ? 'Letter' : 'Mail'), sampleExtra),
      body: interpolate(toEditorHtml(form.body), sampleExtra),
      toName: 'Sample preview',
      to: '',
      status: 'UNSAVED',
      purpose: form.purpose,
    });
  }

  function openTestMail() {
    setError(null);
    if (!htmlHasText(form.body)) {
      setError('Enter mail body before sending a test mail');
      return;
    }
    setTestEmail('');
    setTestError(null);
    setTestOpen(true);
  }

  async function sendTestMail(e: FormEvent) {
    e.preventDefault();
    setTestError(null);
    const to = testEmail.trim();
    if (!to) {
      setTestError('Enter Email Id');
      return;
    }
    setTestBusy(true);
    try {
      await post('/comms/test-mail', { to, subject: form.subject, body: form.body });
      setTestOpen(false);
      setResult({ ok: true, message: `Test mail sent to ${to}. Check the inbox for format.` });
    } catch (err: any) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{isLetter ? 'Letter' : 'Email'}</h1>
          <p>
            {isLetter
              ? 'Every letter the system prints (offer, thesis, reminder, revision, viva…). The active template for a purpose is what gets printed.'
              : 'Every mail the system sends (thesis, practical examiner, supervisor, passcodes, logins). The active template for a purpose is what goes out — edit it to change the mail.'}
          </p>
        </div>
        <button className="btn secondary" type="button" onClick={() => void addMissing()}>
          Add missing defaults
        </button>
      </div>
      <ErrorBox error={error} />
      {missingActive.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <b>No active template:</b> {missingActive.map((c) => c.name).join(', ')}. The built-in starting text is used for{' '}
          {missingActive.length === 1 ? 'it' : 'these'} until you activate a template.
        </div>
      )}
      <form className="card" onSubmit={(e) => saveTpl(e, false)} style={{ marginBottom: 14 }}>
        <h3>{editingId ? 'Edit template' : 'New template'}</h3>
        <div className="grid cols-2">
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Purpose">
            <select value={customPurpose ? CUSTOM : form.purpose} onChange={(e) => pickPurpose(e.target.value)}>
              <option value="">(none)</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {catalog
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <option key={c.purpose} value={c.purpose}>
                        {c.name} — {c.purpose}
                      </option>
                    ))}
                </optgroup>
              ))}
              {form.purpose && !byPurpose.has(form.purpose) && !customPurpose && <option value={form.purpose}>{form.purpose}</option>}
              <option value={CUSTOM}>Custom purpose…</option>
            </select>
            {customPurpose && (
              <input
                className="input"
                style={{ marginTop: 6 }}
                placeholder="e.g. PRACTICAL_HOTEL_INFO"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
              />
            )}
            {entry && (
              <button className="btn ghost small" type="button" style={{ marginTop: 6 }} onClick={loadDefault}>
                Load default text
              </button>
            )}
          </Field>
        </div>
        <Field label="Subject">
          <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <div className="field">
            <span>
              Body<span className="req"> *</span>
            </span>
            <div className="row" style={{ marginBottom: 6, alignItems: 'center' }}>
              <button className="btn secondary small" type="button" onClick={insertLetterhead}>
                {hasLetterhead(form.body) ? 'Reset letterhead' : 'Insert letterhead'}
              </button>
              {hasLetterhead(form.body) && (
                <button className="btn ghost small" type="button" onClick={removeLetterhead}>
                  Remove letterhead
                </button>
              )}
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                AIIMS letterhead (logo, address, File No · CONFIDENTIAL · date). Edit its text in the editor or Source view.
              </span>
            </div>
            <RichTextEditor
              key={`${editingId || 'new'}-${editorNonce}`}
              value={form.body}
              onChange={(body) => setForm({ ...form, body })}
              placeholders={placeholders}
              imageVars={sampleExtra.logoUrl ? { logoUrl: sampleExtra.logoUrl } : undefined}
            />
          </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn secondary" type="submit">
            Save draft
          </button>
          <button className="btn" type="button" onClick={(e) => saveTpl(e as any, true)}>
            Save as active
          </button>
          <button className="btn ghost" type="button" onClick={resetForm}>
            Reset
          </button>
          <button className="btn secondary" type="button" onClick={previewForm}>
            Preview
          </button>
          {!isLetter && (
            <button className="btn" type="button" onClick={openTestMail}>
              Send Test Mail
            </button>
          )}
        </div>
      </form>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Templates</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Group</th>
                <th>Purpose</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t._id}>
                  <td>
                    {t.name}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.subject}</div>
                  </td>
                  <td>{byPurpose.get(t.purpose)?.group || (t.purpose ? 'Custom' : '—')}</td>
                  <td>{t.purpose || '—'}</td>
                  <td>
                    <Pill status={t.active ? 'ACTIVE' : 'DRAFT'} />
                  </td>
                  <td>
                    <div className="row">
                      <button
                        className="btn secondary small"
                        type="button"
                        onClick={() => {
                          setEditingId(t._id);
                          setCustomPurpose(false);
                          setForm({
                            name: t.name,
                            channel,
                            subject: t.subject || '',
                            body: t.body || '',
                            stageCode: t.stageCode || '',
                            purpose: t.purpose || '',
                            active: t.active,
                          });
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn secondary small"
                        type="button"
                        onClick={() =>
                          setView({
                            subject: interpolate(t.subject || t.name || 'Letter', sampleExtra),
                            body: interpolate(toEditorHtml(t.body || ''), sampleExtra),
                            toName: 'Sample preview',
                            to: '',
                            status: t.active ? 'ACTIVE' : 'DRAFT',
                            purpose: t.purpose,
                          })
                        }
                      >
                        Preview
                      </button>
                      {t.active ? (
                        <button
                          className="btn ghost small"
                          type="button"
                          onClick={() => patch(`/comms/templates/${t._id}`, { active: false }).then(load)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button className="btn small" type="button" onClick={() => patch(`/comms/templates/${t._id}`, { active: true }).then(load)}>
                          Activate
                        </button>
                      )}
                      <button className="btn ghost small" type="button" onClick={() => del(`/comms/templates/${t._id}`).then(load)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!templates.length && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--muted)' }}>
                    No templates yet. Click Add missing defaults or create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {view && (
        <div className="modal-overlay" onClick={() => setView(null)} role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{view.subject || (isLetter ? 'Letter' : 'Mail')}</h2>
              <button type="button" className="btn secondary small" onClick={() => setView(null)}>
                Close
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              {view.toName || view.to ? `To ${view.toName || view.to} · ` : ''}
              {view.status} · {view.purpose || '—'}
            </p>
            <MailBodyView body={view.body} />
          </div>
        </div>
      )}

      {testOpen && (
        <div className="modal-overlay dialog-overlay test-mail-overlay" role="presentation" onClick={() => setTestOpen(false)}>
          <div className="test-mail-card" role="dialog" aria-modal="true" aria-labelledby="test-mail-title" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="test-mail-close" aria-label="Close" onClick={() => setTestOpen(false)}>
              ×
            </button>
            <div className="test-mail-side">
              <div className="test-mail-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="56" height="56">
                  <circle cx="32" cy="32" r="30" fill="rgba(255,255,255,0.18)" />
                  <rect x="14" y="22" width="36" height="24" rx="3" fill="none" stroke="#fff" strokeWidth="2" />
                  <path d="M16 24l16 12 16-12" fill="none" stroke="#fff" strokeWidth="2" />
                </svg>
              </div>
              <p>Send Mail then Check Format</p>
            </div>
            <form className="test-mail-body" onSubmit={sendTestMail}>
              <h2 id="test-mail-title">Send Mail Testing</h2>
              <div className="test-mail-field">
                <label htmlFor="test-mail-email">
                  Email Id <span className="req">*</span>
                </label>
                <input
                  id="test-mail-email"
                  className="input"
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="Enter Email Id"
                  required
                  autoFocus
                />
              </div>
              {testError ? <div className="error" style={{ marginTop: 10 }}>{testError}</div> : null}
              <div className="test-mail-actions">
                <button className="btn" type="submit" disabled={testBusy}>
                  {testBusy ? 'Sending…' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {result && <ResultDialog ok={result.ok} message={result.message} onClose={() => setResult(null)} />}
    </Shell>
  );
}
