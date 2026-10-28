import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field, ResultDialog } from '../../../components/ui';
import { get, patch, post } from '../../../api';
import { addLookup } from '../supervisor/common';
import { StaffSessionBar, useStaffDutyMeta, useStaffSession, type Member, type StaffDutyMeta } from './common';

type Form = {
  memberId?: string;
  staffId?: string;
  code: string;
  bankName: string;
  name: string;
  ifsc: string;
  designation: string;
  account: string;
  department: string;
  accountType: string;
  salaryCode: string;
  role: string;
};
const EMPTY: Form = { code: '', bankName: '', name: '', ifsc: '', designation: '', account: '', department: '', accountType: '', salaryCode: '', role: '' };

type RegisterRow = Omit<Member, 'role' | 'roleLabel' | 'shiftPreference' | 'allot' | 'duties' | 'staffId'> & { inSession: boolean };

/** Old StaffAdd.js checks, in the old order. */
function check(f: Form): string | null {
  if (!f.code.trim()) return 'Enter Code No.';
  if (!f.name.trim()) return 'Enter Name';
  if (!f.designation) return 'Please Select Designation';
  if (!f.department) return 'Please Select Department';
  if (!f.salaryCode.trim()) return 'Enter Salary Code';
  if (!f.bankName.trim()) return 'Enter Bank Name';
  if (!f.ifsc.trim()) return 'Enter IFSC Code';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.trim().toUpperCase())) return 'IFSC code is not valid (e.g. SBIN0001234)';
  if (!f.account.trim()) return 'Enter Account Number';
  if (!/^\d{6,20}$/.test(f.account)) return 'Account number must be 6 to 20 digits';
  if (!f.accountType) return 'Enter Account Type';
  return null;
}

/** Old "Add Staff" — Manage Examination Staff (docs/staff-duty-plan.md §5.1). */
export function StaffAddPage() {
  const { meta, error: metaError, reload } = useStaffDutyMeta();
  const [sessionId, setSessionId] = useStaffSession(meta);
  const [rows, setRows] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<string> } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  /** Button pressed before a session existed: create it, then carry on. */
  const [pending, setPending] = useState<'add' | 'copy' | null>(null);
  const [designations, setDesignations] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    if (meta) {
      setDesignations(meta.designations);
      setDepartments(meta.departments);
    }
  }, [meta]);

  async function load() {
    if (!sessionId) return;
    setError(null);
    try {
      setRows(await get<Member[]>(`/staff-duty/members?sessionId=${sessionId}`));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [sessionId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || [r.code, r.name, r.designation, r.department, r.salaryCode, r.roleLabel].join(' ').toLowerCase().includes(q));
  }, [rows, search]);

  const canEdit = !!meta?.can.edit;
  const bank = !!meta?.can.seeBank;

  async function run() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    try {
      setDone(await c.run());
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const exportCols = [
    { key: 'sr', label: 'S.No.' },
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'salaryCode', label: 'SalaryCode' },
    ...(bank
      ? [
          { key: 'bankName', label: 'BankName' },
          { key: 'ifsc', label: 'IFSCCode' },
          { key: 'account', label: 'AccountNo' },
          { key: 'accountType', label: 'AccountType' },
        ]
      : []),
    { key: 'roleLabel', label: 'Role' },
  ];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...r }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Manage Examination Staff</h1>
          <p>Staff of the Examination Section put on invigilation duty, with their duty role for the session.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <StaffSessionBar
          meta={meta}
          sessionId={sessionId}
          onChange={setSessionId}
          onSearch={load}
          askCreate={!!pending}
          onCreateCancel={() => setPending(null)}
          onCreated={async (id) => {
            await reload();
            setSessionId(id);
            if (pending === 'add') setForm({ ...EMPTY });
            if (pending === 'copy') setCopyOpen(true);
            setPending(null);
          }}
        />
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Staff <span className="practical-count">{shown.length}</span>
          </h3>
          {canEdit ? (
            <div className="row">
              <button type="button" className="btn small secondary" onClick={() => (sessionId ? setCopyOpen(true) : setPending('copy'))}>
                Copy staff from previous session
              </button>
              <button type="button" className="btn small" onClick={() => (sessionId ? setForm({ ...EMPTY }) : setPending('add'))}>
                Add Examination Staff
              </button>
            </div>
          ) : null}
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="examination-staff" title="Manage Examination Staff" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Designation</th>
                  <th>Department</th>
                  <th>SalaryCode</th>
                  {bank ? (
                    <>
                      <th>BankName</th>
                      <th>IFSCCode</th>
                      <th>AccountNo</th>
                      <th>AccountType</th>
                    </>
                  ) : null}
                  <th>Role</th>
                  {canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    <td>{i + 1}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.designation}</td>
                    <td>{r.department}</td>
                    <td>{r.salaryCode}</td>
                    {bank ? (
                      <>
                        <td>{r.bankName}</td>
                        <td>{r.ifsc}</td>
                        <td>{r.account}</td>
                        <td>{r.accountType}</td>
                      </>
                    ) : null}
                    <td>{r.roleLabel || <span className="practical-muted">—</span>}</td>
                    {canEdit ? (
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="btn small secondary"
                            onClick={() =>
                              setForm({
                                memberId: r._id,
                                staffId: r.staffId,
                                code: r.code,
                                bankName: r.bankName,
                                name: r.name,
                                ifsc: r.ifsc,
                                designation: r.designation,
                                account: r.account,
                                department: r.department,
                                accountType: r.accountType,
                                salaryCode: r.salaryCode,
                                role: r.role || '',
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() =>
                              setConfirm({
                                message: `You want to Delete Staff ${r.name} from this session.`,
                                run: async () => {
                                  const res = await post<{ updated: number; skipped: { reason: string }[] }>('/staff-duty/members/remove', { ids: [r._id] });
                                  if (res.skipped.length) throw new Error(`${r.name} ${res.skipped[0].reason}.`);
                                  return 'Staff deleted successfully.';
                                },
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{sessionId ? 'No staff added in this session yet.' : ''}</p>
        )}
      </div>

      {form && meta ? (
        <StaffForm
          meta={meta}
          designations={designations}
          onDesignationAdded={(d) => setDesignations((x) => [...new Set([...x, d])].sort())}
          departments={departments}
          onDepartmentAdded={(d) => setDepartments((x) => [...new Set([...x, d])].sort())}
          sessionId={sessionId}
          initial={form}
          onClose={async (msg) => {
            setForm(null);
            if (msg) {
              setDone(msg);
              await load();
            }
          }}
        />
      ) : null}
      {copyOpen && meta ? (
        <CopyDialog
          meta={meta}
          sessionId={sessionId}
          onClose={async (msg) => {
            setCopyOpen(false);
            if (msg) {
              setDone(msg);
              await load();
            }
          }}
        />
      ) : null}
      {confirm ? <ConfirmDialog title="Are you sure?" message={confirm.message} onYes={run} onNo={() => setConfirm(null)} /> : null}
      {done ? <ResultDialog ok message={done} onClose={() => setDone(null)} /> : null}
    </Shell>
  );
}

/** Add / Edit Examination Staff modal, fields in the old order, plus an "Existing staff" picker. */
function StaffForm({
  meta,
  designations,
  onDesignationAdded,
  departments,
  onDepartmentAdded,
  sessionId,
  initial,
  onClose,
}: {
  meta: StaffDutyMeta;
  designations: string[];
  onDesignationAdded: (d: string) => void;
  departments: string[];
  onDepartmentAdded: (d: string) => void;
  sessionId: string;
  initial: Form;
  onClose: (msg?: string) => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<RegisterRow[]>([]);
  /** Open "+" quick add: which list and the typed name (old Add Designation / Add Department modals). */
  const [quick, setQuick] = useState<{ kind: 'DESIGNATION' | 'DEPARTMENT'; name: string } | null>(null);
  const editing = !!f.memberId;
  const picked = !editing && !!f.staffId;

  useEffect(() => {
    if (editing || lookup.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      get<RegisterRow[]>(`/staff-duty/staff?q=${encodeURIComponent(lookup.trim())}&sessionId=${sessionId}`)
        .then(setFound)
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [lookup]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    let v = e.target.value;
    if (k === 'account') v = v.replace(/\D/g, '').slice(0, 20);
    if (k === 'ifsc') v = v.toUpperCase().slice(0, 11);
    setF({ ...f, [k]: v, ...(picked && k !== 'role' ? { staffId: undefined } : {}) });
  };

  function submit() {
    setError(null);
    if (!picked) {
      const msg = check(f);
      if (msg) return setError(msg);
    }
    setAsk(true);
  }

  async function save() {
    setAsk(false);
    setBusy(true);
    try {
      if (editing) {
        await patch(`/staff-duty/members/${f.memberId}`, f);
        onClose('Updated successfully.');
      } else {
        await post('/staff-duty/members', picked ? { sessionId, staffId: f.staffId, role: f.role } : { ...f, sessionId });
        onClose('Added successfully.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveQuick() {
    if (!quick) return;
    const name = quick.name.trim();
    if (!name) return setError(quick.kind === 'DESIGNATION' ? 'Please enter Designation name.' : 'Please enter department name.');
    try {
      await addLookup(quick.kind, name);
      if (quick.kind === 'DESIGNATION') {
        onDesignationAdded(name);
        setF({ ...f, designation: name });
      } else {
        onDepartmentAdded(name);
        setF({ ...f, department: name });
      }
      setQuick(null);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const designationList = [...new Set([...designations, f.designation].filter(Boolean))].sort();
  const departmentList = [...new Set([...departments, f.department].filter(Boolean))].sort();

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{editing ? 'Edit Examination Staff' : 'Add Examination Staff'}</h2>
          <button type="button" className="btn secondary small" onClick={() => onClose()}>
            Close
          </button>
        </div>
        <p className="practical-muted">All fields are mandatory except Role.</p>
        <ErrorBox error={error} />
        {!editing ? (
          <div className="card" style={{ padding: 10, marginBottom: 10 }}>
            <Field label="Existing staff (search by name or code)">
              <input className="input" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Type at least 2 letters" />
            </Field>
            {found.length ? (
              <div className="table-scroll">
                <table className="table practical-table">
                  <tbody>
                    {found.map((s) => (
                      <tr key={s._id}>
                        <td>{s.code}</td>
                        <td>{s.name}</td>
                        <td>{s.designation}</td>
                        <td>
                          {s.inSession ? (
                            <span className="practical-muted">Already in this session</span>
                          ) : (
                            <button
                              type="button"
                              className="btn small secondary"
                              onClick={() => {
                                setF({ ...f, ...s, staffId: s._id, memberId: undefined, role: f.role });
                                setFound([]);
                                setLookup('');
                              }}
                            >
                              Use
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {picked ? <p className="practical-muted">Using the saved details of {f.name}. Change any field to add a new person instead.</p> : null}
          </div>
        ) : null}
        <div className="grid cols-2">
          <Field label="Code No" required>
            <input className="input" value={f.code} onChange={set('code')} maxLength={50} />
          </Field>
          <Field label="Bank Name" required>
            <input className="input" value={f.bankName} onChange={set('bankName')} maxLength={500} />
          </Field>
          <Field label="Name" required>
            <input className="input" value={f.name} onChange={set('name')} maxLength={250} />
          </Field>
          <Field label="IFSC" required>
            <input className="input" value={f.ifsc} onChange={set('ifsc')} maxLength={11} />
          </Field>
          <Field
            label="Designation"
            required
            extra={
              <button type="button" className="btn small secondary" title="Add Designation" onClick={() => setQuick({ kind: 'DESIGNATION', name: '' })}>
                +
              </button>
            }
          >
            <select className="input" value={f.designation} onChange={set('designation')}>
              <option value="">-- Select Designation --</option>
              {designationList.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Account Number" required>
            <input className="input" inputMode="numeric" value={f.account} onChange={set('account')} maxLength={20} />
          </Field>
          <Field
            label="Department"
            required
            extra={
              <button type="button" className="btn small secondary" title="Add Department" onClick={() => setQuick({ kind: 'DEPARTMENT', name: '' })}>
                +
              </button>
            }
          >
            <select className="input" value={f.department} onChange={set('department')}>
              <option value="">-- Select Department --</option>
              {departmentList.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Account Type" required>
            <select className="input" value={f.accountType} onChange={set('accountType')}>
              <option value="">-- Select --</option>
              <option value="Saving">Saving</option>
              <option value="Current">Current</option>
            </select>
          </Field>
          <Field label="Salary Code" required>
            <input className="input" value={f.salaryCode} onChange={set('salaryCode')} maxLength={250} />
          </Field>
          <Field label="Role (Optional)">
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="">-- Select Role --</option>
              {meta.roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {quick ? (
          <div className="row" style={{ marginTop: 8 }}>
            <input
              className="input"
              autoFocus
              placeholder={quick.kind === 'DESIGNATION' ? 'Enter Designation Name' : 'Enter Department Name'}
              value={quick.name}
              maxLength={60}
              onChange={(e) => setQuick({ ...quick, name: e.target.value })}
            />
            <button type="button" className="btn small" onClick={saveQuick}>
              {quick.kind === 'DESIGNATION' ? 'Add Designation' : 'Add Department'}
            </button>
            <button type="button" className="btn small secondary" onClick={() => setQuick(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        <p className="practical-muted">Staff without a role are kept on the list but are not given duty.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            {editing ? 'Update' : 'Submit'}
          </button>
          {!editing ? (
            <button type="button" className="btn secondary" onClick={() => setF({ ...EMPTY })}>
              Reset
            </button>
          ) : null}
        </div>
      </div>
      {ask ? (
        <ConfirmDialog
          title="Are you sure?"
          message={editing ? 'Do you want to Update Staff.' : 'You want to add this Staff.'}
          yesLabel="Yes, Save this!"
          onYes={save}
          onNo={() => setAsk(false)}
        />
      ) : null}
    </div>
  );
}

/** New session: bring the staff and roles of another session. */
function CopyDialog({ meta, sessionId, onClose }: { meta: StaffDutyMeta; sessionId: string; onClose: (msg?: string) => void }) {
  const others = meta.sessions.filter((s) => s._id !== sessionId);
  const [from, setFrom] = useState(others[0]?._id || '');
  const [error, setError] = useState<string | null>(null);
  async function copy() {
    if (!from) return setError('Select the session to copy from');
    try {
      const r = await post<{ added: number; alreadyThere: number }>('/staff-duty/members/copy-from', { sessionId, fromSessionId: from });
      onClose(`${r.added} staff copied${r.alreadyThere ? ` (${r.alreadyThere} were already in this session)` : ''}. Preferences start fresh.`);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true">
        <h2>Copy staff from previous session</h2>
        <ErrorBox error={error} />
        <Field label="Copy from session" required>
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">-- Select Session --</option>
            {others.map((s) => (
              <option key={s._id} value={s._id}>
                {s.month} {s.year}
              </option>
            ))}
          </select>
        </Field>
        <p className="practical-muted">Staff and their roles are copied. Shift preferences and allotment ticks start fresh.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={copy}>
            Copy
          </button>
          <button type="button" className="btn secondary" onClick={() => onClose()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
