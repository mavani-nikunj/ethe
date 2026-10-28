import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../../api';
import { ErrorBox, Field } from '../../../components/ui';
import { type SupervisorMeta } from '../supervisor/common';
import { SUPERVISOR_SESSION_CHANGED } from '../supervisor/menu';

/** Shared types and pieces of the Staff Duty pages (docs/staff-duty-plan.md). */

export type DutyRoleKey = 'ALL_DUTY' | 'SUPERVISOR' | 'INVIGILATOR' | 'SUPPORTING';

export type StaffDutyMeta = {
  sessions: SupervisorMeta['sessions'];
  activeSessionId: string | null;
  months: string[];
  years: number[];
  designations: string[];
  departments: string[];
  shifts: string[];
  roles: { key: DutyRoleKey; label: string; need: string }[];
  shiftPreferences: string[];
  can: { edit: boolean; lock: boolean; unlock: boolean; seeBank: boolean };
};

export type Member = {
  _id: string;
  staffId: string;
  code: string;
  name: string;
  designation: string;
  department: string;
  salaryCode: string;
  bankName: string;
  ifsc: string;
  account: string;
  accountType: string;
  role: DutyRoleKey | null;
  roleLabel: string;
  shiftPreference: string;
  allot: boolean;
  duties: number;
};

export type Need = { allDuty: number; supervisor: number; invigilator: number; supporting: number };

/** Need field per role, in the old column order. */
export const NEED_KEYS: { role: DutyRoleKey; key: keyof Need; label: string }[] = [
  { role: 'ALL_DUTY', key: 'allDuty', label: 'All Duty' },
  { role: 'SUPERVISOR', key: 'supervisor', label: 'Supervisor' },
  { role: 'INVIGILATOR', key: 'invigilator', label: 'Invigilation' },
  { role: 'SUPPORTING', key: 'supporting', label: 'Supporting' },
];

export type RunView = {
  status: 'OPEN' | 'LOCKED';
  generated: { at: string; byName?: string; mode?: string } | null;
  locked: { at: string; byName?: string } | null;
  unlocks: { at: string; byName?: string; reason: string }[];
  settings: { reportingTime: { Morning: string; Evening: string }; notes: string[]; titlePeriod?: string };
};

export function useStaffDutyMeta() {
  const [meta, setMeta] = useState<StaffDutyMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    try {
      const m = await get<StaffDutyMeta>('/staff-duty/meta');
      setMeta(m);
      return m;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }
  useEffect(() => {
    reload();
  }, []);
  return { meta, error, reload };
}

/** Session Month / Year default to the active supervisor session and load at once (old pages waited for Search). */
export function useStaffSession(meta: StaffDutyMeta | null) {
  const [sessionId, setSessionId] = useState('');
  useEffect(() => {
    if (meta && !sessionId) setSessionId(meta.activeSessionId || meta.sessions[0]?._id || '');
  }, [meta]);
  return [sessionId, setSessionId] as const;
}

/**
 * Session Month + Session Year (old filter). Staff Duty works in the Supervisor Session of that month; when it
 * does not exist yet, Dealing creates it here (old Staff Duty needed no session record, only month + year).
 * `askCreate` opens the create dialog from a page button; `onCreated` gets the new session id.
 */
export function StaffSessionBar({
  meta,
  sessionId,
  onChange,
  onSearch,
  askCreate,
  onCreated,
  onCreateCancel,
}: {
  meta: StaffDutyMeta;
  sessionId: string;
  onChange: (id: string) => void;
  onSearch: () => void;
  askCreate?: boolean;
  onCreated?: (id: string) => void;
  onCreateCancel?: () => void;
}) {
  const selected = meta.sessions.find((s) => s._id === sessionId);
  const [month, setMonth] = useState(selected?.month || '');
  const [year, setYear] = useState(selected ? String(selected.year) : String(new Date().getFullYear()));
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (selected) {
      setMonth(selected.month);
      setYear(String(selected.year));
    }
  }, [sessionId, meta]);
  useEffect(() => {
    if (askCreate) setCreating(true);
  }, [askCreate]);
  function pick(m: string, y: string) {
    setMonth(m);
    setYear(y);
    onChange(meta.sessions.find((s) => s.month === m && String(s.year) === y)?._id || '');
  }
  const missing = !!month && !!year && !selected;
  return (
    <>
      <div className="card practical-filters">
        <div className="grid cols-2">
          <Field label="Session Month" required>
            <select className="input" value={month} onChange={(e) => pick(e.target.value, year)}>
              <option value="">-- Select Month --</option>
              {meta.months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <div className="practical-filter-actions">
            <Field label="Session Year" required>
              <select className="input" value={year} onChange={(e) => pick(month, e.target.value)}>
                <option value="">-- Select Year --</option>
                {meta.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className="btn gold" disabled={!sessionId} onClick={onSearch}>
              Search
            </button>
          </div>
        </div>
        {missing ? (
          <div className="row" style={{ marginTop: 6 }}>
            <span className="practical-muted">
              There is no {month} {year} session yet.
            </span>
            {meta.can.edit ? (
              <button type="button" className="btn small" onClick={() => setCreating(true)}>
                Create {month} {year} session
              </button>
            ) : null}
          </div>
        ) : selected ? (
          <p className="practical-muted">
            {selected.active ? 'This is the active supervisor session. ' : ''}File No. {selected.fileNumber}
          </p>
        ) : (
          <p className="practical-muted">Select the Session Month and Session Year.</p>
        )}
      </div>
      {creating ? (
        <CreateSessionDialog
          meta={meta}
          month={month}
          year={year}
          onClose={(id) => {
            setCreating(false);
            if (id) onCreated?.(id);
            else onCreateCancel?.();
          }}
        />
      ) : null}
    </>
  );
}

/** New session for the chosen month: the same record as Supervisor → Supervisor Session, which needs the office file number. */
function CreateSessionDialog({
  meta,
  month: m0,
  year: y0,
  onClose,
}: {
  meta: StaffDutyMeta;
  month: string;
  year: string;
  onClose: (id?: string) => void;
}) {
  const [month, setMonth] = useState(m0);
  const [year, setYear] = useState(y0);
  const [fileNumber, setFileNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(null);
    if (!month) return setError('Please Select Month.');
    if (!year) return setError('Please Select Year');
    if (!fileNumber.trim()) return setError('Please Insert File Number');
    setBusy(true);
    try {
      // Becomes the active supervisor session only when none is active, so another month is not taken over.
      const r = await post<{ _id: string }>('/supervisor/sessions', { month, year: Number(year), fileNumber, activate: !meta.activeSessionId });
      if (!meta.activeSessionId) window.dispatchEvent(new Event(SUPERVISOR_SESSION_CHANGED));
      onClose(r._id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true">
        <h2>Create Session</h2>
        <p className="practical-muted">Staff Duty is kept per session (month + year). This is the same session as Supervisor → Supervisor Session.</p>
        <ErrorBox error={error} />
        <Field label="Session Month" required>
          <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">-- Select Month --</option>
            {meta.months.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Session Year" required>
          <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">-- Select Year --</option>
            {meta.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="File Number" required>
          <input
            className="input"
            value={fileNumber}
            maxLength={120}
            placeholder="e.g. No.F.11-09/2026/Exam.Sec"
            onChange={(e) => setFileNumber(e.target.value)}
          />
        </Field>
        <p className="practical-muted">
          A label such as "July Slot-I" is added with "+" on <Link to="/app/supervisor/session">Supervisor Session</Link>.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={save}>
            Create
          </button>
          <button type="button" className="btn secondary" onClick={() => onClose()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Message shown when a button is pressed before a session is chosen. */
export const NO_SESSION = 'Please select Session Month and Session Year first.';

export function fmtWhen(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Banner on Duty Allotment: not generated / generated / locked. */
export function RunBanner({ run, short }: { run: RunView; short?: number }) {
  if (run.status === 'LOCKED') {
    return (
      <div className="sd-notice ok">
        <b>Locked</b> on {fmtWhen(run.locked?.at)} by {run.locked?.byName}. Duty lists are final; changes need the Asstt. Controller (Exams) to unlock.
      </div>
    );
  }
  if (!run.generated) return <div className="sd-notice">Duties are not allotted yet. Set the exam duties and preferences, then press <b>Lock Preferences</b> in Staff Preference.</div>;
  return (
    <div className={`sd-notice${short ? ' warn' : ''}`}>
      Allotted on {fmtWhen(run.generated.at)} by {run.generated.byName}.{' '}
      {short ? <b>{short} duties are still short — see View And Lock.</b> : 'Every exam duty is filled.'} Not locked yet.
    </div>
  );
}
