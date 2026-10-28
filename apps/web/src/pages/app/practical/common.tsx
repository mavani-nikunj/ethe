import { useEffect, useMemo, useState } from 'react';
import { get, patch } from '../../../api';
import { ErrorBox, Field } from '../../../components/ui';

export type Named = { _id: string; name: string };
export type PracticalMeta = {
  sessions: { _id: string; month: string; year: number; current: boolean }[];
  currentSessionId: string | null;
  courses: Named[];
  specialities: (Named & { courseId?: string })[];
  examTypes: Named[];
  dealings: Named[];
  types: { code: string; label: string; letter: string; order: number }[];
  statusLabels: Record<string, string>;
  can: { edit: boolean; vet: boolean };
  scopeNote?: string | null;
};

export type PracticalRow = {
  _id: string;
  type: string;
  typeLabel: string;
  name: string;
  designation?: string;
  department?: string;
  instituteName?: string;
  instituteAddress?: string;
  city?: string;
  mobile: string;
  email: string;
  alternateMobile?: string;
  alternateEmail?: string;
  salaryCode?: string;
  status: string;
  statusLabel: string;
  courseId: string;
  courseName: string;
  specialityId: string;
  specialityName: string;
  scheduleId: string;
  sessionId: string;
  sessionLabel: string;
  examMonth: string;
  examYear: string | number;
  dealingName: string;
  subjectCode?: string;
  practicalDate?: string;
  remarks?: string;
  rejectReason?: string;
  regretReason?: string;
  offer?: { sentAt?: string; resentAt?: string[] };
  appointment?: { sentAt?: string; resentAt?: string[] };
  portal?: { generatedAt?: string; lastLoginAt?: string };
  airBooking?: Record<string, any>;
  lastRemark?: string;
  examinerCode?: string;
  hasBank?: boolean;
  dateMail?: { state?: string };
  approvedBy?: { name?: string; at?: string };
  /** "detail" = added from Download Examiner Details (no speciality board). */
  source?: string;
};

export type BulkResult = { updated: number; skipped: { id: string; name: string; reason: string }[] };

export function usePracticalMeta() {
  const [meta, setMeta] = useState<PracticalMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    try {
      setMeta(await get<PracticalMeta>('/practical/meta'));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  return { meta, setMeta, error, reload };
}

export type QueueFilters = { sessionId: string; dealingId: string; courseId: string; specialityId: string };

/** Dealing / Course / Speciality filters shared by every list page (as on the old screens). */
export function FilterBar({
  meta,
  value,
  onChange,
  onSearch,
  showSession = true,
}: {
  meta: PracticalMeta;
  value: QueueFilters;
  onChange: (v: QueueFilters) => void;
  onSearch: () => void;
  showSession?: boolean;
}) {
  const specs = useMemo(
    () => meta.specialities.filter((s) => !value.courseId || String(s.courseId) === value.courseId),
    [meta.specialities, value.courseId],
  );
  const lockedDealing = meta.can.edit && meta.dealings.length === 1;
  return (
    <div className="card practical-filters">
      {meta.scopeNote ? <div className="error">{meta.scopeNote}</div> : null}
      <div className="grid cols-2">
        <Field label="Dealing" required>
          <select
            className="input"
            value={lockedDealing ? meta.dealings[0]._id : value.dealingId}
            disabled={lockedDealing}
            onChange={(e) => onChange({ ...value, dealingId: e.target.value })}
          >
            {!lockedDealing ? <option value="">-- All Dealing --</option> : null}
            {meta.dealings.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name of Course" required>
          <select
            className="input"
            value={value.courseId}
            onChange={(e) => onChange({ ...value, courseId: e.target.value, specialityId: '' })}
          >
            <option value="">-- All Course --</option>
            {meta.courses.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name of Speciality" required>
          <select className="input" value={value.specialityId} onChange={(e) => onChange({ ...value, specialityId: e.target.value })}>
            <option value="">-- All Speciality --</option>
            {specs.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="practical-filter-actions">
          {showSession ? (
            <Field label="Exam Session">
              <select className="input" value={value.sessionId} onChange={(e) => onChange({ ...value, sessionId: e.target.value })}>
                {meta.sessions.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.month} {s.year}
                    {s.current ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <button type="button" className="btn gold" onClick={onSearch}>
            Search
          </button>
        </div>
      </div>
    </div>
  );
}

export function filterQuery(f: QueueFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.sessionId) p.set('sessionId', f.sessionId);
  if (f.dealingId) p.set('dealingId', f.dealingId);
  if (f.courseId) p.set('courseId', f.courseId);
  if (f.specialityId) p.set('specialityId', f.specialityId);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

export function BulkResultDialog({
  title,
  result,
  onClose,
  noun = 'examiner',
}: {
  title: string;
  result: BulkResult;
  onClose: () => void;
  noun?: string;
}) {
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card dialog-card-wide" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p>
          {result.updated} {noun}
          {result.updated === 1 ? '' : 's'} updated.
          {result.skipped.length ? ` ${result.skipped.length} skipped:` : ''}
        </p>
        {result.skipped.length ? (
          <ul className="practical-skipped">
            {result.skipped.map((s) => (
              <li key={s.id}>
                <b>{s.name || s.id}</b> — {s.reason}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/** Confirmation with an optional / required remark (Assoc. Dean reject, Dealing reject). */
export function ReasonDialog({
  title,
  message,
  label = 'Reason',
  required,
  yesLabel,
  onYes,
  onNo,
}: {
  title: string;
  message: string;
  label?: string;
  required?: boolean;
  yesLabel: string;
  onYes: (reason: string) => void;
  onNo: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{message}</p>
        <ErrorBox error={error} />
        <Field label={label} required={required}>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (required && !reason.trim()) {
                setError(`${label} is required`);
                return;
              }
              onYes(reason.trim());
            }}
          >
            {yesLabel}
          </button>
          <button type="button" className="btn secondary" onClick={onNo}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const ACCOUNT_TYPES = ['Savings', 'Current'];

/** Edit examiner details and bank (old Edit Chairperson/Internal/External and Download Examiner pages). */
export function ExaminerEditDialog({
  id,
  withBank,
  basePath = '/practical/examiners',
  onClose,
  onSaved,
}: {
  id: string;
  withBank?: boolean;
  basePath?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [bank, setBank] = useState<Record<string, string>>({});
  const [lookups, setLookups] = useState<Record<string, string[]>>({ DESIGNATION: [], DEPARTMENT: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([get(`${basePath}/${id}`), get('/practical/lookups')])
      .then(([row, lk]) => {
        setForm(row);
        setBank(row.bank || {});
        setLookups(lk);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const set = (k: string, v: string) => setForm((f) => ({ ...(f || {}), [k]: v }));
  const setB = (k: string, v: string) => setBank((b) => ({ ...b, [k]: v }));

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await patch(`${basePath}/${id}`, {
        ...form,
        ...(withBank ? { bank } : {}),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card practical-edit-card" role="dialog" aria-modal="true">
        <h2>Edit Examiner</h2>
        <ErrorBox error={error} />
        {!form ? (
          <p>Loading…</p>
        ) : (
          <>
            <p className="practical-muted">
              {form.typeLabel} · {form.courseName} / {form.specialityName} · {form.sessionLabel} · <b>{form.statusLabel}</b>
            </p>
            <div className="grid cols-2">
              <Field label="Name of Examiner" required>
                <input className="input" value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Designation" required>
                <ListInput value={form.designation || ''} options={lookups.DESIGNATION} onChange={(v) => set('designation', v)} />
              </Field>
              <Field label="Department" required>
                <ListInput value={form.department || ''} options={lookups.DEPARTMENT} onChange={(v) => set('department', v)} />
              </Field>
              <Field label="Institute Name" required>
                <input className="input" value={form.instituteName || ''} onChange={(e) => set('instituteName', e.target.value)} />
              </Field>
              <Field label="Institute Address" required>
                <input className="input" value={form.instituteAddress || ''} onChange={(e) => set('instituteAddress', e.target.value)} />
              </Field>
              <Field label="City" required={form.type === 'EXTERNAL'}>
                <input className="input" value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="Mobile No." required>
                <input className="input" value={form.mobile || ''} maxLength={10} onChange={(e) => set('mobile', e.target.value)} />
              </Field>
              <Field label="Email ID" required>
                <input className="input" value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Alternate Mobile">
                <input className="input" value={form.alternateMobile || ''} maxLength={10} onChange={(e) => set('alternateMobile', e.target.value)} />
              </Field>
              <Field label="Alternate Email Id">
                <input className="input" value={form.alternateEmail || ''} onChange={(e) => set('alternateEmail', e.target.value)} />
              </Field>
              <Field label="Salary Code">
                <input className="input" value={form.salaryCode || ''} onChange={(e) => set('salaryCode', e.target.value)} />
              </Field>
            </div>
            {withBank ? (
              <>
                <h3 className="practical-subhead">Bank details</h3>
                <div className="grid cols-2">
                  <Field label="Account Holder Name">
                    <input className="input" value={bank.holderName || ''} onChange={(e) => setB('holderName', e.target.value)} />
                  </Field>
                  <Field label="Bank Name">
                    <input className="input" value={bank.bankName || ''} onChange={(e) => setB('bankName', e.target.value)} />
                  </Field>
                  <Field label="Branch Address">
                    <input className="input" value={bank.branch || ''} onChange={(e) => setB('branch', e.target.value)} />
                  </Field>
                  <Field label="IFSC Code">
                    <input className="input" value={bank.ifsc || ''} onChange={(e) => setB('ifsc', e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="Account Type">
                    <select className="input" value={bank.accountType || ''} onChange={(e) => setB('accountType', e.target.value)}>
                      <option value="">-- Select --</option>
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Account Number">
                    <input className="input" value={bank.account || ''} onChange={(e) => setB('account', e.target.value)} />
                  </Field>
                  <Field label="PAN">
                    <input className="input" value={bank.pan || ''} maxLength={10} onChange={(e) => setB('pan', e.target.value.toUpperCase())} />
                  </Field>
                </div>
              </>
            ) : null}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={!form || busy} onClick={save}>
            {busy ? 'Saving…' : 'Submit'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Select from a list, but keep a value that is not on it (old rows may have free text). */
export function ListInput({
  value,
  options,
  onChange,
  placeholder = '-- Select --',
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {all.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
