import { useEffect, useMemo, useState } from 'react';
import { get } from '../../../api';
import { ErrorBox, Field } from '../../../components/ui';
import { MONTHS } from '../../../dept';

export type Named = { _id: string; name: string };
export type EligibleMeta = {
  sessions: { _id: string; month: string; year: number; current: boolean }[];
  currentSessionId: string | null;
  courses: (Named & { departmentId?: string | null })[];
  specialities: (Named & { courseId?: string })[];
  departments: Named[];
  can: { edit: boolean };
  scopeNote?: string | null;
};

export type CandidateRow = {
  _id: string;
  sessionId: string;
  courseId: string;
  specialityId: string;
  departmentId?: string;
  enrollmentNo: string;
  name: string;
  dob: string;
  mobile: string;
  email: string;
  source: 'THESIS' | 'MANUAL' | 'CARRIED';
  /** "New" = thesis candidate, "Old" = added by hand or carried over. */
  status: 'New' | 'Old';
  eligible: boolean;
  notEligibleReason: string;
  notEligibleBy: string;
  notEligibleAt: string | null;
  courseName: string;
  specialityName: string;
  departmentName: string;
  sessionLabel: string;
  carriedFrom: string;
  /** Eligible Candidate Seat Allotment rows (one per candidate per paper). */
  rowKey?: string;
  paperId?: string;
  paper?: string;
  examDate?: string;
  shiftName?: string;
  timeName?: string;
  venue?: string;
  fees?: number;
};

export function useEligibleMeta() {
  const [meta, setMeta] = useState<EligibleMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    try {
      setMeta(await get<EligibleMeta>('/eligible/meta'));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  return { meta, setMeta, error, reload };
}

/** YYYY-MM-DD → DD/MM/YYYY, as the old lists showed DOB. */
export function dmy(iso?: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

export function sessionLabel(s: { month: string; year: number; current?: boolean }) {
  return `${s.month} ${s.year}${s.current ? ' (current)' : ''}`;
}

export type CandidateFilters = { sessionId: string; courseId: string; specialityId: string };

/** Session Year choices: 2020 (where the old list started) to next year, plus any year that has a session. */
export function sessionYears(sessions: { year: number }[]) {
  const now = new Date().getFullYear();
  const set = new Set<number>();
  for (let y = 2020; y <= now + 1; y++) set.add(y);
  for (const s of sessions) set.add(Number(s.year));
  return [...set].filter((y) => y > 1900).sort((a, b) => b - a);
}

/** Name of Course / Name of Speciality / Session → Search, as on the old list screens. */
export function CandidateFilterBar({
  meta,
  value,
  onChange,
  onSearch,
  courseRequired,
  children,
}: {
  meta: EligibleMeta;
  value: CandidateFilters;
  onChange: (v: CandidateFilters) => void;
  onSearch: () => void;
  courseRequired?: boolean;
  children?: React.ReactNode;
}) {
  const specs = useMemo(
    () => meta.specialities.filter((s) => !value.courseId || String(s.courseId) === value.courseId),
    [meta.specialities, value.courseId],
  );
  const years = useMemo(() => sessionYears(meta.sessions), [meta.sessions]);
  // Session Month + Session Year as two dropdowns (old screens); they resolve to a session here.
  const selected = meta.sessions.find((s) => s._id === value.sessionId);
  const [month, setMonth] = useState(selected?.month || '');
  const [year, setYear] = useState(selected ? String(selected.year) : '');
  useEffect(() => {
    if (selected) {
      setMonth(selected.month);
      setYear(String(selected.year));
    }
  }, [value.sessionId]);
  function pick(m: string, y: string) {
    setMonth(m);
    setYear(y);
    const match = meta.sessions.find((s) => s.month === m && String(s.year) === y);
    onChange({ ...value, sessionId: match?._id || '' });
  }
  const missing = month && year && !meta.sessions.some((s) => s.month === month && String(s.year) === year);
  return (
    <div className="card practical-filters">
      {meta.scopeNote ? <div className="error">{meta.scopeNote}</div> : null}
      <div className="grid cols-2">
        <Field label="Name of Course" required={courseRequired}>
          <select
            className="input"
            value={value.courseId}
            onChange={(e) => onChange({ ...value, courseId: e.target.value, specialityId: '' })}
          >
            <option value="">{courseRequired ? '-- Select Course --' : '-- All Course --'}</option>
            {meta.courses.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name of Speciality">
          <select className="input" value={value.specialityId} onChange={(e) => onChange({ ...value, specialityId: e.target.value })}>
            <option value="">-- All Speciality --</option>
            {specs.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Session Month" required>
          <select className="input" value={month} onChange={(e) => pick(e.target.value, year)}>
            <option value="">-- Select Month --</option>
            {MONTHS.map((m) => (
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
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className="btn gold" onClick={onSearch}>
            Search
          </button>
          {children}
        </div>
      </div>
      {missing ? (
        <p className="practical-muted">
          There is no {month} {year} session. Activate it from the Dashboard first.
        </p>
      ) : selected?.current ? (
        <p className="practical-muted">This is the current session.</p>
      ) : null}
    </div>
  );
}

export function candidateQuery(f: CandidateFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.sessionId) p.set('sessionId', f.sessionId);
  if (f.courseId) p.set('courseId', f.courseId);
  if (f.specialityId) p.set('specialityId', f.specialityId);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** Columns of every old candidate list: Course · Speciality · EnrollmentNo · Candidate · DOB · Contact · EmailId · Status. */
export const CANDIDATE_COLUMNS: { key: keyof CandidateRow | 'dobText'; label: string }[] = [
  { key: 'courseName', label: 'Course' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'enrollmentNo', label: 'EnrollmentNo' },
  { key: 'name', label: 'Candidate' },
  { key: 'dobText', label: 'DOB' },
  { key: 'mobile', label: 'Contact' },
  { key: 'email', label: 'EmailId' },
  { key: 'status', label: 'Status' },
];

/** Old "Eligible Candidate and Seat Allotment" columns, plus Paper and Shift (missing on the old screen). */
export const WITH_PAPER_COLUMNS: { key: string; label: string }[] = [
  { key: 'courseName', label: 'Course Name' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'enrollmentNo', label: 'Enrollment No' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'dobText', label: 'DOB' },
  { key: 'mobile', label: 'Contact' },
  { key: 'email', label: 'EmailId' },
  { key: 'paper', label: 'Paper' },
  { key: 'shiftName', label: 'Shift' },
  { key: 'fees', label: 'Fees' },
  { key: 'dateText', label: 'Date' },
  { key: 'timeName', label: 'Time' },
  { key: 'venue', label: 'VenueName' },
  { key: 'status', label: 'Status' },
];

export function candidateCell(r: CandidateRow, key: string): string {
  if (key === 'dobText') return dmy(r.dob);
  if (key === 'dateText') return dmy(r.examDate);
  return String((r as any)[key] ?? '');
}

export function searchRows(rows: CandidateRow[], search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.enrollmentNo, r.name, r.email, r.mobile, r.courseName, r.specialityName].join(' ').toLowerCase().includes(q),
  );
}

/** Small one-field "Add …" modal behind the "+" buttons (old AddModal… dialogs). */
export function QuickAddDialog({
  title,
  label,
  onSave,
  onClose,
  maxLength = 160,
}: {
  title: string;
  label: string;
  maxLength?: number;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim()) {
      setError(`${label} is required`);
      return;
    }
    setBusy(true);
    try {
      await onSave(name.trim());
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p>All fields are mandatory</p>
        <ErrorBox error={error} />
        <Field label={label} required>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Enter ${label}`}
            maxLength={maxLength}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            Submit
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
