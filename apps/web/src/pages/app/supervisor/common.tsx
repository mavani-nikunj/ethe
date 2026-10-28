import { useEffect, useMemo, useState } from 'react';
import { withLetterheadLogo } from '@ethesis/shared';
import { del, get, post } from '../../../api';
import { ErrorBox, Field } from '../../../components/ui';
import { SUPERVISOR_SESSION_CHANGED } from './menu';

/** Shared types and pieces of the Supervisor pages (docs/supervisor-plan.md). */

export type SupSession = { _id: string; month: string; year: number; fileNumber: string; active: boolean };

export type SupervisorMeta = {
  sessions: SupSession[];
  activeSessionId: string | null;
  months: string[];
  years: number[];
  designations: string[];
  departments: string[];
  shifts: { name: string; time: string; reportingTime: string }[];
  statusLabels: Record<string, string>;
  can: { edit: boolean; approve: boolean };
};

export type Duty = { scheduleId: string; examDate: string; day: string; shift: string; reportingTime: string; examName: string };

export type Appointment = {
  _id: string;
  sessionId: string;
  personId: string;
  name: string;
  designation: string;
  department: string;
  instituteName: string;
  address: string;
  mobile: string;
  email: string;
  status: string;
  statusLabel: string;
  duties: Duty[];
  totalDuty: number;
  approvedBy: { name?: string; at?: string } | null;
  offer: { sentAt?: string; resentAt?: string[] } | null;
  acceptedAt: string | null;
  regretReason: string;
  withdrawReason: string;
  salaryCode: string;
  remuneration: string;
  bank: {
    holderName?: string;
    bankName?: string;
    branch?: string;
    ifsc?: string;
    accountType?: string;
    account?: string;
    hasCheque?: boolean;
  } | null;
};

export type ScheduleRow = {
  _id: string;
  examName: string;
  examDate: string;
  day: string;
  shift: string;
  time: string;
  studentCount: number;
  supervisors: number;
};

export function useSupervisorMeta() {
  const [meta, setMeta] = useState<SupervisorMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    try {
      setMeta(await get<SupervisorMeta>('/supervisor/meta'));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  return { meta, error, reload };
}

export function notifySupervisorSession() {
  window.dispatchEvent(new Event(SUPERVISOR_SESSION_CHANGED));
}

/** YYYY-MM-DD → DD/MM/YYYY (old screens). */
export function dmy(iso?: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

export function sessionText(s?: { month: string; year: number } | null) {
  return s ? `${s.month} ${s.year}` : '';
}

const STATUS_PILL: Record<string, string> = {
  DRAFT: 'muted',
  WITH_ACE: 'navy',
  APPROVED: 'ok',
  OFFER_SENT: 'warn',
  ACCEPTED: 'ok',
  REGRETTED: 'bad',
  WITHDRAWN: 'bad',
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill ${STATUS_PILL[status] || 'muted'}`}>{label || status}</span>;
}

/** Session Month + Session Year → Search, resolved to a supervisor session (old Month / Year filters). */
export function SessionFilterBar({
  meta,
  sessionId,
  onChange,
  onSearch,
  children,
}: {
  meta: SupervisorMeta;
  sessionId: string;
  onChange: (id: string) => void;
  onSearch: () => void;
  children?: React.ReactNode;
}) {
  const selected = meta.sessions.find((s) => s._id === sessionId);
  const [month, setMonth] = useState(selected?.month || '');
  const [year, setYear] = useState(selected ? String(selected.year) : '');
  useEffect(() => {
    if (selected) {
      setMonth(selected.month);
      setYear(String(selected.year));
    }
  }, [sessionId]);
  function pick(m: string, y: string) {
    setMonth(m);
    setYear(y);
    onChange(meta.sessions.find((s) => s.month === m && String(s.year) === y)?._id || '');
  }
  const missing = month && year && !selected;
  return (
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
          {children}
        </div>
      </div>
      {missing ? (
        <p className="practical-muted">There is no {month} {year} supervisor session. Add it on Supervisor Session first.</p>
      ) : selected?.active ? (
        <p className="practical-muted">This is the active supervisor session (File No. {selected.fileNumber}).</p>
      ) : selected ? (
        <p className="practical-muted">File No. {selected.fileNumber}</p>
      ) : null}
    </div>
  );
}

/** Sessions default to the active one, as the old pages opened on the user's session. */
export function useSessionChoice(meta: SupervisorMeta | null) {
  const [sessionId, setSessionId] = useState('');
  useEffect(() => {
    if (meta && !sessionId) setSessionId(meta.activeSessionId || meta.sessions[0]?._id || '');
  }, [meta]);
  return [sessionId, setSessionId] as const;
}

/** Person fields of the Add / Edit Supervisor forms. */
export type PersonForm = {
  name: string;
  designation: string;
  department: string;
  instituteName: string;
  address: string;
  mobile: string;
  email: string;
};

export const EMPTY_PERSON: PersonForm = { name: '', designation: '', department: '', instituteName: '', address: '', mobile: '', email: '' };

export function personOf(x: Partial<PersonForm> | null | undefined): PersonForm {
  return {
    name: x?.name || '',
    designation: x?.designation || '',
    department: x?.department || '',
    instituteName: x?.instituteName || '',
    address: x?.address || '',
    mobile: x?.mobile || '',
    email: x?.email || '',
  };
}

/** Old validation order and wording (SupervisorAdd.js). */
export function checkPerson(f: PersonForm): string | null {
  if (!f.name.trim()) return 'Please enter Name.';
  if (!f.designation.trim()) return 'Please Select Designation';
  if (!f.department.trim()) return 'Please Select Department';
  if (!f.instituteName.trim()) return 'Please Enter Institute Name';
  if (!f.address.trim()) return 'Please Enter Institute Address';
  if (!f.mobile) return 'Please Enter Mobile No';
  if (!/^\d{10}$/.test(f.mobile)) return 'Mobile number should be 10 digit.';
  if (!f.email.trim()) return 'Please enter Email Id';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Please enter valid email e.g abc@domain.com';
  return null;
}

export function PersonFields({
  meta,
  value,
  onChange,
  onAddDesignation,
}: {
  meta: SupervisorMeta;
  value: PersonForm;
  onChange: (v: PersonForm) => void;
  onAddDesignation?: () => void;
}) {
  const set = (k: keyof PersonForm) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: k === 'mobile' ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value });
  const designations = useMemo(
    () => [...new Set([...meta.designations, value.designation].filter(Boolean))].sort(),
    [meta.designations, value.designation],
  );
  const departments = useMemo(
    () => [...new Set([...meta.departments, value.department].filter(Boolean))].sort(),
    [meta.departments, value.department],
  );
  return (
    <div className="grid cols-2">
      <Field label="Name" required>
        <input className="input" value={value.name} onChange={set('name')} maxLength={200} />
      </Field>
      <Field
        label="Designation"
        required
        extra={
          onAddDesignation ? (
            <button type="button" className="btn small secondary" title="Add Designation" onClick={onAddDesignation}>
              +
            </button>
          ) : undefined
        }
      >
        <select className="input" value={value.designation} onChange={set('designation')}>
          <option value="">-- Select Designation --</option>
          {designations.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </Field>
      <Field label="Department" required>
        <select className="input" value={value.department} onChange={set('department')}>
          <option value="">-- Select Department --</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </Field>
      <Field label="Institute Name" required>
        <input className="input" value={value.instituteName} onChange={set('instituteName')} maxLength={250} />
      </Field>
      <Field label="Institute Address" required>
        <input className="input" value={value.address} onChange={set('address')} maxLength={500} />
      </Field>
      <Field label="Mobile No" required>
        <input className="input" inputMode="numeric" value={value.mobile} onChange={set('mobile')} maxLength={10} />
      </Field>
      <Field label="Email Id" required>
        <input className="input" type="email" value={value.email} onChange={set('email')} maxLength={100} />
      </Field>
    </div>
  );
}

/** Name link → duties of a supervisor. Dealing adds / removes while the supervisor has not answered. */
export function DutiesDialog({
  appointmentId,
  canEdit,
  onClose,
}: {
  appointmentId: string;
  canEdit: boolean;
  onClose: (changed: boolean) => void;
}) {
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [date, setDate] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [reportingTime, setReportingTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    get<Appointment>(`/supervisor/appointments/${appointmentId}`)
      .then(async (a) => {
        setAppt(a);
        setSchedule(await get<ScheduleRow[]>(`/supervisor/schedule?sessionId=${a.sessionId}`));
      })
      .catch((err) => setError(err.message));
  }, [appointmentId]);

  const editable = canEdit && !!appt && ['DRAFT', 'WITH_ACE', 'APPROVED', 'OFFER_SENT'].includes(appt.status);
  const dates = [...new Set(schedule.map((s) => s.examDate))];
  const shifts = schedule.filter((s) => s.examDate === date);
  const chosen = schedule.find((s) => s._id === scheduleId);

  function pickShift(id: string) {
    setScheduleId(id);
    const s = schedule.find((x) => x._id === id);
    // Old default reporting time: 09:10 AM (Morning) / 01:40 PM (Evening).
    setReportingTime(s?.shift === 'Morning' ? '09:10 AM' : s ? '01:40 PM' : '');
  }

  async function add() {
    setError(null);
    if (!date) return setError('Please enter Date.');
    if (!scheduleId) return setError('Please Select Shift.');
    if (!reportingTime.trim()) return setError('Please enter Reporting Time.');
    setBusy(true);
    try {
      setAppt(await post<Appointment>(`/supervisor/appointments/${appointmentId}/duties`, { scheduleId, reportingTime }));
      setChanged(true);
      setScheduleId('');
      setDate('');
      setReportingTime('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const res = await del<Appointment>(`/supervisor/appointments/${appointmentId}/duties/${id}`);
      setAppt(res);
      setChanged(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{editable ? 'Add Shift' : 'Supervisor Duties'}</h2>
          <button type="button" className="btn secondary small" onClick={() => onClose(changed)}>
            Close
          </button>
        </div>
        <ErrorBox error={error} />
        {appt ? (
          <p>
            <b>{appt.name}</b> · {appt.designation} · {appt.department} <StatusPill status={appt.status} label={appt.statusLabel} />
          </p>
        ) : null}
        {editable ? (
          <div className="grid cols-2">
            <Field label="Date" required>
              <select className="input" value={date} onChange={(e) => (setDate(e.target.value), setScheduleId(''), setReportingTime(''))}>
                <option value="">-- Select Date --</option>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {dmy(d)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Shift" required>
              <select className="input" value={scheduleId} disabled={!date} onChange={(e) => pickShift(e.target.value)}>
                <option value="">--Select Shift--</option>
                {shifts.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.shift}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reporting Time" required>
              <input className="input" value={reportingTime} maxLength={20} onChange={(e) => setReportingTime(e.target.value)} />
            </Field>
            <Field label="Day">
              <input className="input" value={chosen?.day || ''} disabled />
            </Field>
            <div className="dialog-actions" style={{ gridColumn: '1 / -1' }}>
              <button type="button" className="btn" disabled={busy} onClick={add}>
                Submit
              </button>
            </div>
          </div>
        ) : null}
        {!schedule.length && editable ? <p className="practical-muted">No schedule yet for this session. Add it on Add Schedule first.</p> : null}
        <div className="table-scroll">
          <table className="table practical-table">
            <thead>
              <tr>
                <th>Sr.No.</th>
                <th>Name</th>
                <th>Shift</th>
                <th>Date</th>
                <th>Day</th>
                <th>Name of Examination</th>
                <th>ReportingTime</th>
                {editable ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {(appt?.duties || []).map((d, i) => (
                <tr key={d.scheduleId}>
                  <td>{i + 1}</td>
                  <td>{appt?.name}</td>
                  <td>{d.shift}</td>
                  <td>{dmy(d.examDate)}</td>
                  <td>{d.day}</td>
                  <td>{d.examName}</td>
                  <td>{d.reportingTime}</td>
                  {editable ? (
                    <td>
                      <button type="button" className="btn small danger" onClick={() => remove(d.scheduleId)}>
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {appt && !appt.duties.length ? (
                <tr>
                  <td colSpan={8} className="practical-empty">
                    No duty assigned yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Printable letters, one per page (offer / acceptance / regret). */
export function LetterPrint({ title, letters, onClose }: { title: string; letters: { _id: string; name: string; body: string }[]; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head no-print">
          <h2>{title}</h2>
          <div className="row">
            <button type="button" className="btn small" onClick={() => window.print()}>
              Print
            </button>
            <button type="button" className="btn secondary small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="letter-print-area">
          {letters.map((l) => (
            <article key={l._id} className="letter-print-sheet" dangerouslySetInnerHTML={{ __html: withLetterheadLogo(l.body) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Cancelled cheques of the selected supervisors (old "Download Cancelled Cheque"). */
export function ChequePrint({ items, onClose }: { items: { id: string; name: string; dataUrl: string; mime: string }[]; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head no-print">
          <h2>Cancelled Cheque</h2>
          <div className="row">
            <button type="button" className="btn small" onClick={() => window.print()}>
              Print
            </button>
            <button type="button" className="btn secondary small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="letter-print-area">
          {items.map((c) => (
            <article key={c.id} className="letter-print-sheet">
              <p>
                <b>{c.name}</b>
              </p>
              {c.mime === 'application/pdf' ? (
                <a className="btn small secondary no-print" href={c.dataUrl} download={c.name}>
                  Download PDF
                </a>
              ) : (
                <img src={c.dataUrl} alt={c.name} style={{ maxWidth: '100%' }} />
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "+" quick add for the MONTH / YEAR / DESIGNATION lists. */
export async function addLookup(kind: 'MONTH' | 'YEAR' | 'DESIGNATION' | 'DEPARTMENT', name: string) {
  return post('/supervisor/lookups', { kind, name });
}

