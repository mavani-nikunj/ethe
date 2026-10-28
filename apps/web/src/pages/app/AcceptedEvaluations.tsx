import { useEffect, useMemo, useState } from 'react';
import { get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { Shell } from '../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field, ResultDialog } from '../../components/ui';
import { SessionFilter } from '../../components/SessionFilter';
import { applySessionParams, useSessionFilter } from '../../session';
import {
  AcceptedEvaluationPrint,
  type AcceptedPrintData,
  type AcceptedPrintMode,
} from '../../components/AcceptedEvaluationPrint';

type Row = Record<string, any>;

/** Grid columns of the old Accepted Thesis Evaluation Report, in the same order (checkbox and Action are separate). */
const COLUMNS: { key: string; label: string; wide?: boolean }[] = [
  { key: 'srNo', label: 'Sr.No.' },
  { key: 'thesisNumber', label: 'ThesisNo' },
  { key: 'courseName', label: 'Course' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'candidateName', label: 'Candidate' },
  { key: 'examinerName', label: 'ExaminerName' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'institute', label: 'Institute Name', wide: true },
  { key: 'address', label: 'Institute Address', wide: true },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'examinerType', label: 'ExaminerType' },
  { key: 'holderName', label: 'Holder Name' },
  { key: 'bankName', label: 'Bank Name' },
  { key: 'branchAddress', label: 'Branch Address', wide: true },
  { key: 'accountNo', label: 'Account No' },
  { key: 'ifsc', label: 'IFSCCode' },
  { key: 'accountType', label: 'Account Type' },
  { key: 'pan', label: 'Pan Number' },
];
// Old export skipped the checkbox and Action columns but kept Remuneration (last column).
const EXPORT_COLS = [...COLUMNS, { key: 'remuneration', label: 'Remuneration' }];

type Dialog =
  | { kind: 'confirm'; title: string; message: string; yesLabel: string; onYes: () => void }
  | { kind: 'result'; ok: boolean; message: string }
  | null;

export function AcceptedEvaluationsPage() {
  const { user } = useAuth() as any;
  const isDealing = user?.role === 'DEALING';
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  const [dealingId, setDealingId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [specialityId, setSpecialityId] = useState('');
  const [dealings, setDealings] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [specialities, setSpecialities] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'srNo', dir: 1 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [print, setPrint] = useState<{ mode: AcceptedPrintMode; data: AcceptedPrintData } | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);

  const dealing = dealings.find((d) => String(d._id) === String(dealingId));
  const dealingCourseIds: string[] = (dealing?.courseIds || []).map(String);
  const coursesForDealing = dealingCourseIds.length
    ? courses.filter((c) => dealingCourseIds.includes(String(c._id)))
    : courses;
  const specsForCourse = specialities.filter((s) => !courseId || !s.courseId || String(s.courseId) === String(courseId));

  function load() {
    const params = applySessionParams(new URLSearchParams(), month, year);
    if (dealingId && !isDealing) params.set('dealingId', dealingId);
    if (courseId) params.set('courseId', courseId);
    if (specialityId) params.set('specialityId', specialityId);
    setLoading(true);
    setError(null);
    get(`/accepted-evaluations?${params.toString()}`)
      .then((data) => {
        const rows = Array.isArray(data?.items) ? data.items : [];
        setItems(rows.map((r: Row, i: number) => ({ ...r, srNo: i + 1 })));
        setSelected([]);
      })
      .catch((e: any) => setError(e.message || 'Could not load accepted evaluations'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    get('/masters/courses')
      .then((c) => setCourses(Array.isArray(c) ? c : []))
      .catch(() => setCourses([]));
    get('/masters/specialities')
      .then((s) => setSpecialities(Array.isArray(s) ? s : []))
      .catch(() => setSpecialities([]));
    get('/comms/templates?channel=EMAIL')
      .then((t) => setTemplates(Array.isArray(t) ? t.filter((x: any) => x.active !== false) : []))
      .catch(() => setTemplates([]));
    if (isDealing) {
      setDealings([{ _id: user.id, name: user.name, courseIds: user.courseIds || [] }]);
      setDealingId(user.id);
    } else {
      get('/masters/staff')
        .then((s) => setDealings(Array.isArray(s) ? s.filter((u: any) => u.role === 'DEALING') : []))
        .catch(() => setDealings([]));
    }
  }, [isDealing]);

  // Old page loaded once on open; after that the list refreshes on Search (and when the session changes).
  useEffect(() => {
    if (ready) load();
  }, [ready, month, year]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = term
      ? items.filter((r) => EXPORT_COLS.some((c) => String(r[c.key] ?? '').toLowerCase().includes(term)))
      : items;
    return [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const cmp =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
      return cmp * sort.dir;
    });
  }, [items, search, sort]);

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.includes(r.id));

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  // Like the old DataTables select-all: ticks / unticks only the rows matching the search.
  function toggleAll() {
    const ids = visible.map((r) => r.id);
    setSelected((cur) => (allVisibleSelected ? cur.filter((id) => !ids.includes(id)) : [...new Set([...cur, ...ids])]));
  }

  function sortBy(key: string) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }

  const selectedRows = () => items.filter((r) => selected.includes(r.id));
  const asItems = (rows: Row[]) => rows.map((r) => ({ fileId: r.fileId, panelIndex: r.panelIndex }));

  function needSelection() {
    if (selected.length) return false;
    setDialog({ kind: 'result', ok: false, message: 'Please select atleast 1 data.' });
    return true;
  }

  async function openPrint(mode: AcceptedPrintMode, rows: Row[]) {
    setBusy(true);
    setError(null);
    try {
      const data: AcceptedPrintData = await post('/accepted-evaluations/print', { items: asItems(rows) });
      setPrint({ mode, data });
    } catch (e: any) {
      setError(e.message || 'Could not load the print view');
    } finally {
      setBusy(false);
    }
  }

  function printReports(mode: 'report' | 'report-examiner') {
    if (needSelection()) return;
    openPrint(mode, selectedRows());
  }

  function downloadCheques() {
    if (needSelection()) return;
    setDialog({
      kind: 'confirm',
      title: 'Are you sure?',
      message: 'You want to Download Cancelled Cheque?',
      yesLabel: 'Yes, Download it!',
      onYes: () => {
        setDialog(null);
        const rows = selectedRows().filter((r) => r.chequePath);
        if (!rows.length) setDialog({ kind: 'result', ok: false, message: 'Cancelled Cheque not uploaded!' });
        else openPrint('cheque', rows);
      },
    });
  }

  function sendMail() {
    if (needSelection()) return;
    if (!templateId) {
      setDialog({ kind: 'result', ok: false, message: 'Please select Mail Title.' });
      return;
    }
    setDialog({
      kind: 'confirm',
      title: 'Are you sure?',
      message: 'You want to Send SMS and Email',
      yesLabel: 'Yes, Send it!',
      onYes: async () => {
        setDialog(null);
        setBusy(true);
        try {
          const r: any = await post('/accepted-evaluations/send-mail', { templateId, items: asItems(selectedRows()) });
          const failures = (r.failed || []).map((f: any) => f.message).filter(Boolean);
          setDialog({
            kind: 'result',
            ok: !failures.length,
            message: failures.length ? `${r.message} ${[...new Set(failures)].join('; ')}` : 'Send successfully.',
          });
          load();
        } catch (e: any) {
          setDialog({ kind: 'result', ok: false, message: e.message || 'Could not send mail' });
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <Shell mode="app">
      <div className="page-head">
        <div>
          <h1>Accepted Thesis Evaluation Report</h1>
          <p className="guide-muted">Examiners who accepted the thesis in their evaluation report, with bank details for remuneration.</p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <Field label="Session">
            <SessionFilter
              sessions={sessions}
              month={month}
              year={year}
              onChange={(m, y) => {
                setMonth(m);
                setYear(y);
              }}
            />
          </Field>
          <Field label="Dealing">
            <select
              className="input"
              value={dealingId}
              disabled={isDealing}
              onChange={(e) => {
                setDealingId(e.target.value);
                setCourseId('');
                setSpecialityId('');
              }}
            >
              {!isDealing ? <option value="">-- All Dealing --</option> : null}
              {dealings.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name of Course">
            <select
              className="input"
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setSpecialityId('');
              }}
            >
              <option value="">-- All Course --</option>
              {coursesForDealing.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name of Speciality">
            <select className="input" value={specialityId} onChange={(e) => setSpecialityId(e.target.value)}>
              <option value="">-- All Speciality --</option>
              {specsForCourse.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className="btn" onClick={load} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <button type="button" className="btn small" disabled={busy} onClick={() => printReports('report')}>
            Thesis Report Download PDF
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={() => printReports('report-examiner')}>
            Download PDF with Examiner Details
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={sendMail}>
            Send SMS and Email
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={downloadCheques}>
            Download Cancelled Cheque
          </button>
          <select className="input" style={{ maxWidth: 320 }} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">-- Select Mail Title --</option>
            {templates.map((t) => (
              <option key={t._id} value={t._id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="files-toolbar" style={{ marginBottom: 12 }}>
          <b>
            Total Examiner: {items.length}
            {selected.length ? ` · ${selected.length} selected` : ''}
            {loading ? ' (loading…)' : ''}
          </b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ExportButtons columns={EXPORT_COLS} rows={visible} filename="accepted-thesis-evaluation-report" title="Accepted Thesis Evaluation Report" />
            <input
              className="input"
              style={{ maxWidth: 220 }}
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search"
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => sortBy(c.key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th>Action</th>
                <th onClick={() => sortBy('remuneration')} style={{ cursor: 'pointer' }}>
                  Remuneration{sort.key === 'remuneration' ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {!visible.length ? (
                <tr>
                  <td colSpan={COLUMNS.length + 3} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                    {loading ? 'Loading…' : 'No data available in table'}
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.examinerName}`}
                      />
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} style={c.wide ? { minWidth: 180 } : undefined}>
                        {c.key === 'examinerName' ? (
                          <button type="button" className="name-link" onClick={() => setEditing(row)}>
                            {row.examinerName || '—'}
                          </button>
                        ) : (
                          row[c.key] ?? ''
                        )}
                      </td>
                    ))}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn small secondary"
                        disabled={busy}
                        onClick={() => openPrint('report', [row])}
                      >
                        Evaluation Report
                      </button>{' '}
                      {row.chequePath ? (
                        <a className="btn small secondary" href={`/api/uploads/${row.chequePath}`} target="_blank" rel="noreferrer">
                          Download CC
                        </a>
                      ) : (
                        <button type="button" className="btn small secondary" disabled title="Cancelled cheque not uploaded">
                          Download CC
                        </button>
                      )}
                    </td>
                    <td>{row.remuneration}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {print ? <AcceptedEvaluationPrint mode={print.mode} data={print.data} onClose={() => setPrint(null)} /> : null}
      {editing ? (
        <ExaminerEditModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setDialog({ kind: 'result', ok: true, message: 'Updated successfully.' });
            load();
          }}
        />
      ) : null}
      {dialog?.kind === 'confirm' ? (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          yesLabel={dialog.yesLabel}
          noLabel="Cancel"
          onYes={dialog.onYes}
          onNo={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'result' ? (
        <ResultDialog ok={dialog.ok} message={dialog.message} onClose={() => setDialog(null)} />
      ) : null}
    </Shell>
  );
}

const EMAIL_RE = /^([A-Za-z0-9_\-.])+@([A-Za-z0-9_\-.])+\.([A-Za-z]{2,4})$/;
const digits = (v: string) => v.replace(/[^0-9]/g, '');

/** Old "Examiner Info" modal: profile + bank details for remuneration, same fields and checks as before. */
function ExaminerEditModal({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: row.examinerName || '',
    designation: row.designation || '',
    department: row.examinerDepartment || '',
    institute: row.institute || '',
    address: row.address || '',
    mobile: row.mobile || '',
    email: row.email || '',
    alternateMobile: row.alternateMobile || '',
    alternateEmail: row.alternateEmail || '',
    holderName: row.holderName || '',
    bankName: row.bankName || '',
    branchAddress: row.branchAddress || '',
    ifsc: row.ifsc || '',
    accountType: row.accountType || '',
    account: row.accountNo || '',
  });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = ['mobile', 'alternateMobile', 'account'].includes(k) ? digits(e.target.value) : e.target.value;
    setF((cur) => ({ ...cur, [k]: v }));
  };

  function validate() {
    const t = (v: string) => v.trim();
    if (!t(f.name)) return 'Please Enter Name';
    if (!t(f.designation)) return 'Please Enter Designation Name';
    if (!t(f.department)) return 'Please Enter Department Name';
    if (!t(f.address)) return 'Please Enter Address';
    if (!t(f.institute)) return 'Please Enter Institute Name';
    if (!t(f.mobile)) return 'Please Enter Mobile No.';
    if (!t(f.email)) return 'Please Enter Email Id.';
    if (!EMAIL_RE.test(t(f.email))) return 'Please enter valid email e.g abc@domain.com.';
    if (!t(f.holderName)) return 'Please Enter Name of Examiner (as provided in Bank)';
    if (!t(f.bankName)) return 'Please Enter Bank Name';
    if (!t(f.branchAddress)) return 'Please Enter Branch Name with Bank Address';
    if (!t(f.ifsc)) return 'Please Enter IFSC Code';
    if (!t(f.accountType)) return 'Please Select Account Type';
    if (!t(f.account)) return 'Please Enter Account Number';
    return null;
  }

  function submit() {
    const msg = validate();
    setError(msg);
    if (!msg) setConfirm(true);
  }

  async function save() {
    setConfirm(false);
    setSaving(true);
    setError(null);
    try {
      await patch(`/files/${row.fileId}/panel/members/${row.panelIndex}`, f);
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Could not update examiner');
    } finally {
      setSaving(false);
    }
  }

  const input = (label: string, k: keyof typeof f, maxLength = 200) => (
    <Field label={label}>
      <input className="input" value={f[k]} onChange={set(k)} maxLength={maxLength} />
    </Field>
  );

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="examiner-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="examiner-edit-title">Examiner Info</h2>
          <button type="button" className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="guide-muted" style={{ marginTop: 0 }}>
          Thesis {row.thesisNumber || '—'} · {row.candidateName}
        </p>
        <div className="grid cols-2">
          {input('Name', 'name')}
          {input('Designation', 'designation')}
          {input('Department', 'department')}
          {input('Institute', 'institute')}
          {input('Address', 'address')}
          {input('Mobile', 'mobile', 10)}
          {input('Email Id', 'email', 100)}
          {input('Alternate Mobile No.', 'alternateMobile', 10)}
          {input('Alternate Email Id', 'alternateEmail')}
        </div>
        <h3 style={{ marginTop: 18 }}>Bank Details for Remuneration</h3>
        <div className="grid cols-2">
          {input('Name of Examiner (as provided in Bank)', 'holderName')}
          {input('Bank Name', 'bankName')}
          {input('Branch Name with Bank Address', 'branchAddress')}
          {input('IFSC Code', 'ifsc', 50)}
          {input('Account Type', 'accountType', 50)}
          {input('Account Number', 'account', 50)}
        </div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Submit'}
          </button>
        </div>
        {confirm ? (
          <ConfirmDialog
            title="Are you sure?"
            message="You want to Update Examiner"
            yesLabel="Yes, Updated it!"
            noLabel="Cancel"
            onYes={save}
            onNo={() => setConfirm(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
