import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { get, patch, post } from '../../../api';
import { BulkResultDialog, ReasonDialog, type BulkResult } from '../practical/common';
import { QuickAddDialog } from '../eligible/common';
import { SUPERVISOR_MENU } from './menu';
import {
  ChequePrint,
  DutiesDialog,
  EMPTY_PERSON,
  LetterPrint,
  PersonFields,
  SessionFilterBar,
  StatusPill,
  addLookup,
  checkPerson,
  personOf,
  useSessionChoice,
  useSupervisorMeta,
  type Appointment,
  type PersonForm,
  type SupervisorMeta,
} from './common';

type Col = { key: string; label: string; value: (a: Appointment) => string };

const BASE_COLS: Col[] = [
  { key: 'designation', label: 'Designation', value: (a) => a.designation },
  { key: 'department', label: 'Department', value: (a) => a.department },
  { key: 'instituteName', label: 'Institute', value: (a) => a.instituteName },
  { key: 'address', label: 'Address', value: (a) => a.address },
  { key: 'mobile', label: 'MobileNo', value: (a) => a.mobile },
  { key: 'email', label: 'EmailId', value: (a) => a.email },
];
const DUTY_COL: Col = { key: 'totalDuty', label: 'Total Duty', value: (a) => String(a.totalDuty) };
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '');

type Bulk = { label: string; who: 'dealing' | 'ace'; endpoint: string; confirm: string; success: string };

type View = { title: string; api: string; cols: Col[]; bulk?: Bulk; empty: string };

/** One page per old menu item; headers, buttons and messages follow the old screens. */
const VIEWS: Record<string, View> = {
  add: {
    title: 'Add New Supervisor',
    api: 'all',
    cols: [...BASE_COLS, DUTY_COL, { key: 'status', label: 'Status', value: (a) => a.statusLabel }],
    empty: 'No supervisor added for this session yet.',
  },
  'to-ace': {
    title: 'Send Supervisor to Asstt. Controller',
    api: 'to-ace',
    cols: [...BASE_COLS, DUTY_COL],
    bulk: { label: 'Send to Asstt. Controller', who: 'dealing', endpoint: 'send-to-ace', confirm: 'You want to Send Supervisor.', success: 'Send successfully.' },
    empty: 'No supervisor is waiting to be sent to the Asstt. Controller.',
  },
  'with-ace': {
    title: 'Approval from Asstt. Controller',
    api: 'with-ace',
    cols: [...BASE_COLS, DUTY_COL],
    bulk: {
      label: 'Approve and Send to Dealing',
      who: 'ace',
      endpoint: 'approve',
      confirm: 'Do you want to approved and send to Dealing',
      success: 'Approved and Send successfully.',
    },
    empty: 'No supervisor is waiting for approval.',
  },
  approved: {
    title: 'Approved Sent Supervisor to Dealing',
    api: 'approved',
    cols: [...BASE_COLS, DUTY_COL, { key: 'approvedBy', label: 'Approved by', value: (a) => `${a.approvedBy?.name || ''} ${fmt(a.approvedBy?.at)}`.trim() }],
    bulk: { label: 'Send Offer to Supervisor', who: 'dealing', endpoint: 'send-offer', confirm: 'You want to Send Supervisor.', success: 'Send successfully.' },
    empty: 'No approved supervisor is waiting for the offer.',
  },
  'offer-pending': {
    title: 'Pending / Resend Offer Letter',
    api: 'offer-pending',
    cols: [
      ...BASE_COLS,
      { key: 'sentAt', label: 'Offer sent', value: (a) => fmt(a.offer?.sentAt) },
      { key: 'resent', label: 'Re-sent', value: (a) => (a.offer?.resentAt?.length ? `${a.offer.resentAt.length} time(s), last ${fmt(a.offer.resentAt[a.offer.resentAt.length - 1])}` : '') },
    ],
    bulk: { label: 'Re-send Letter', who: 'dealing', endpoint: 'resend-offer', confirm: 'You want to Re-Send Supervisor.', success: 'Send successfully.' },
    empty: 'No offer is waiting for an answer.',
  },
  accepted: {
    title: 'Accepted From Supervisor',
    api: 'accepted',
    cols: [
      BASE_COLS[0],
      BASE_COLS[1],
      BASE_COLS[2],
      BASE_COLS[3],
      { key: 'salaryCode', label: 'Salary Code', value: (a) => a.salaryCode },
      BASE_COLS[4],
      BASE_COLS[5],
      DUTY_COL,
      { key: 'remuneration', label: 'Remuneration', value: (a) => a.remuneration },
      { key: 'holderName', label: 'Holder Name', value: (a) => a.bank?.holderName || '' },
      { key: 'bankName', label: 'Bank Name', value: (a) => a.bank?.bankName || '' },
      { key: 'branch', label: 'Branch Name', value: (a) => a.bank?.branch || '' },
      { key: 'account', label: 'Account No', value: (a) => a.bank?.account || '' },
      { key: 'ifsc', label: 'IFSCCode', value: (a) => a.bank?.ifsc || '' },
      { key: 'accountType', label: 'Account Type', value: (a) => a.bank?.accountType || '' },
    ],
    empty: 'No supervisor has accepted yet.',
  },
  regretted: {
    title: 'Rejected from Supervisor',
    api: 'regretted',
    cols: [...BASE_COLS, { key: 'regretReason', label: 'Reason', value: (a) => a.regretReason }],
    empty: 'No supervisor has regretted.',
  },
};

export function SupervisorListPage() {
  const { view = '' } = useParams();
  const config = VIEWS[view];
  const menuLabel = SUPERVISOR_MENU.find((m) => m.path === view)?.label;
  const { meta, error: metaError, reload: reloadMeta } = useSupervisorMeta();
  const [sessionId, setSessionId] = useSessionChoice(meta);
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);
  const [withdrawIds, setWithdrawIds] = useState<string[] | null>(null);
  const [result, setResult] = useState<{ title: string; result: BulkResult } | null>(null);
  const [duties, setDuties] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; personId?: string; value: PersonForm } | null>(null);
  const [acceptEdit, setAcceptEdit] = useState<Appointment | null>(null);
  const [letters, setLetters] = useState<{ _id: string; name: string; body: string }[] | null>(null);
  const [cheques, setCheques] = useState<{ id: string; name: string; dataUrl: string; mime: string }[] | null>(null);

  async function load(id = sessionId) {
    if (!config || !id) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await get<Appointment[]>(`/supervisor/appointments?sessionId=${id}&view=${config.api}`));
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRows([]);
    setSearch('');
    load();
  }, [view, sessionId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || [r.name, r.email, r.mobile, r.department, r.designation].join(' ').toLowerCase().includes(q));
  }, [rows, search]);

  if (!config) return <Navigate to="/app/supervisor/add" replace />;

  const canEdit = !!meta?.can.edit;
  const bulk = config.bulk && ((config.bulk.who === 'dealing' && canEdit) || (config.bulk.who === 'ace' && meta?.can.approve)) ? config.bulk : null;
  const isAdd = view === 'add';
  const tickable = !!bulk || (isAdd && canEdit) || view === 'accepted';
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r._id));
  const activeSession = meta?.sessions.find((s) => s._id === sessionId);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function needSelection() {
    if (!selected.size) {
      setError('Please select atleast 1 data.');
      return true;
    }
    setError(null);
    return false;
  }

  function startBulk() {
    if (!bulk || needSelection()) return;
    const ids = [...selected];
    setConfirm({
      title: 'Are you sure?',
      message: bulk.confirm,
      run: async () => {
        const res = await post<BulkResult>(`/supervisor/appointments/${bulk.endpoint}`, { ids });
        setResult({ title: bulk.success, result: res });
      },
    });
  }

  async function withdraw(reason?: string) {
    const ids = withdrawIds;
    setWithdrawIds(null);
    if (!ids) return;
    try {
      const res = await post<BulkResult>('/supervisor/appointments/withdraw', { ids, reason });
      setResult({ title: 'Delete successfully.', result: res });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function run() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    try {
      await c.run();
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function printLetter(a: Appointment, kind: 'acceptance' | 'regret') {
    try {
      setLetters(await post('/supervisor/letters', { kind, ids: [a._id] }));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function showCheques(ids: string[]) {
    const out: { id: string; name: string; dataUrl: string; mime: string }[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      try {
        const c = await get<{ name: string; dataUrl: string; mime: string }>(`/supervisor/appointments/${id}/cheque`);
        out.push({ id, ...c });
      } catch {
        missing.push(rows.find((r) => r._id === id)?.name || id);
      }
    }
    if (missing.length) setError(`Cancelled cheque not uploaded: ${missing.join(', ')}`);
    if (out.length) setCheques(out);
  }

  const drafts = (withdrawIds || []).every((id) => rows.find((r) => r._id === id)?.status === 'DRAFT');
  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, { key: 'name', label: 'Name' }, ...config.cols.map((c) => ({ key: c.key, label: c.label }))];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, name: r.name, ...Object.fromEntries(config.cols.map((c) => [c.key, c.value(r)])) }));
  const showAction = (isAdd && canEdit) || view === 'accepted' || view === 'regretted';

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{config.title}</h1>
          {menuLabel && menuLabel !== config.title ? <p>{menuLabel}</p> : null}
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? <SessionFilterBar meta={meta} sessionId={sessionId} onChange={setSessionId} onSearch={() => load()} /> : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Supervisor <span className="practical-count">{shown.length}</span>
          </h3>
          <div className="row">
            {view === 'accepted' ? (
              <button type="button" className="btn small secondary" onClick={() => !needSelection() && showCheques([...selected])}>
                Download Cancelled Cheque
              </button>
            ) : null}
            {isAdd && canEdit ? (
              <>
                <button type="button" className="btn small danger" onClick={() => !needSelection() && setWithdrawIds([...selected])}>
                  Delete
                </button>
                <button
                  type="button"
                  className="btn small"
                  disabled={!activeSession}
                  onClick={() => setForm({ value: { ...EMPTY_PERSON } })}
                >
                  Add Supervisor
                </button>
              </>
            ) : null}
            {bulk ? (
              <button type="button" className="btn small" disabled={loading} onClick={startBulk}>
                {bulk.label}
              </button>
            ) : null}
          </div>
        </div>
        {config.bulk && !bulk ? (
          <p className="practical-muted">
            {config.bulk.who === 'ace' ? 'Only the Asstt. Controller (Exams) can approve.' : 'Only the Dealing Assistant can act on this list.'}
          </p>
        ) : null}
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename={`supervisor-${view}`} title={config.title} />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, mobile…" />
          </label>
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  {tickable ? (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((r) => r._id)))}
                      />
                    </th>
                  ) : null}
                  <th>Sr.No.</th>
                  <th>Name</th>
                  {config.cols.map((c) => (
                    <th key={c.key} className="nowrap">
                      {c.label}
                    </th>
                  ))}
                  {view === 'accepted' ? <th className="nowrap">Cancelled Cheque</th> : null}
                  {view === 'accepted' || view === 'regretted' ? <th>Letter</th> : null}
                  {showAction && (isAdd || (view === 'accepted' && canEdit)) ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    {tickable ? (
                      <td>
                        <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r._id)} onChange={() => toggle(r._id)} />
                      </td>
                    ) : null}
                    <td>{i + 1}</td>
                    <td>
                      <button type="button" className="name-link" onClick={() => setDuties(r._id)} title="Duties">
                        {r.name}
                      </button>
                    </td>
                    {config.cols.map((c) => (
                      <td key={c.key}>{c.key === 'status' ? <StatusPill status={r.status} label={r.statusLabel} /> : c.value(r)}</td>
                    ))}
                    {view === 'accepted' ? (
                      <td>
                        {r.bank?.hasCheque ? (
                          <button type="button" className="btn small secondary" onClick={() => showCheques([r._id])}>
                            Download CC
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                    {view === 'accepted' || view === 'regretted' ? (
                      <td>
                        <button type="button" className="btn small secondary nowrap" onClick={() => printLetter(r, view === 'accepted' ? 'acceptance' : 'regret')}>
                          {view === 'accepted' ? 'Acceptance' : 'Regret'}
                        </button>
                      </td>
                    ) : null}
                    {isAdd && canEdit ? (
                      <td>
                        {['DRAFT', 'WITH_ACE', 'APPROVED', 'OFFER_SENT'].includes(r.status) ? (
                          <button type="button" className="btn small secondary" onClick={() => setForm({ id: r._id, value: personOf(r) })}>
                            Edit
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                    {view === 'accepted' && canEdit ? (
                      <td>
                        <button type="button" className="btn small secondary" onClick={() => setAcceptEdit(r)}>
                          Edit
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{sessionId ? config.empty : 'Select a supervisor session.'}</p>
        )}
        {isAdd ? <p className="practical-muted">Click a name to assign or view the exam dates and shifts (duties).</p> : null}
      </div>

      {form && meta ? (
        <SupervisorFormDialog
          meta={meta}
          sessionId={sessionId}
          initial={form}
          onDesignationAdded={reloadMeta}
          onClose={(saved) => {
            setForm(null);
            if (saved) load();
          }}
        />
      ) : null}
      {acceptEdit && meta ? (
        <AcceptanceDialog
          meta={meta}
          appt={acceptEdit}
          onClose={(saved) => {
            setAcceptEdit(null);
            if (saved) load();
          }}
        />
      ) : null}
      {duties ? (
        <DutiesDialog
          appointmentId={duties}
          canEdit={canEdit}
          onClose={(changed) => {
            setDuties(null);
            if (changed) load();
          }}
        />
      ) : null}
      {confirm ? <ConfirmDialog title={confirm.title} message={confirm.message} onYes={run} onNo={() => setConfirm(null)} /> : null}
      {withdrawIds ? (
        drafts ? (
          <ConfirmDialog title="Are you sure?" message="You want to Delete Supervisor." yesLabel="Yes, Delete it!" onYes={() => withdraw()} onNo={() => setWithdrawIds(null)} />
        ) : (
          <ReasonDialog
            title="Delete Supervisor"
            message="Some selected supervisors were already sent to the Asstt. Controller or offered the duty. They will be withdrawn and their link closed. Give the reason."
            required
            yesLabel="Withdraw"
            onYes={(reason) => withdraw(reason)}
            onNo={() => setWithdrawIds(null)}
          />
        )
      ) : null}
      {result ? <BulkResultDialog title={result.title} result={result.result} noun="supervisor" onClose={() => setResult(null)} /> : null}
      {letters ? <LetterPrint title={view === 'accepted' ? 'Acceptance letter' : 'Regret letter'} letters={letters} onClose={() => setLetters(null)} /> : null}
      {cheques ? <ChequePrint items={cheques} onClose={() => setCheques(null)} /> : null}
    </Shell>
  );
}

/** Old "Add Supervisor" modal: "Added Supervisor" picker from the registry, then the person fields. */
function SupervisorFormDialog({
  meta,
  sessionId,
  initial,
  onDesignationAdded,
  onClose,
}: {
  meta: SupervisorMeta;
  sessionId: string;
  initial: { id?: string; personId?: string; value: PersonForm };
  onDesignationAdded: () => Promise<void>;
  onClose: (saved: boolean) => void;
}) {
  const [value, setValue] = useState<PersonForm>(initial.value);
  const [personId, setPersonId] = useState(initial.personId || '');
  const [people, setPeople] = useState<(PersonForm & { _id: string })[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [addDesignation, setAddDesignation] = useState(false);
  const editing = !!initial.id;

  useEffect(() => {
    if (!editing) get<(PersonForm & { _id: string })[]>('/supervisor/people').then(setPeople).catch(() => setPeople([]));
  }, [editing]);

  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return people.filter((p) => !q || `${p.name} ${p.email} ${p.mobile}`.toLowerCase().includes(q)).slice(0, 200);
  }, [people, filter]);

  function pick(id: string) {
    setPersonId(id);
    const p = people.find((x) => x._id === id);
    setValue(p ? personOf(p) : { ...EMPTY_PERSON });
  }

  function submit() {
    const msg = checkPerson(value);
    if (msg) return setError(msg);
    setError(null);
    setConfirm(true);
  }

  async function save() {
    setConfirm(false);
    try {
      if (editing) await patch(`/supervisor/appointments/${initial.id}`, value);
      else await post('/supervisor/appointments', { ...value, personId: personId || undefined, sessionId });
      onClose(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <h2>{editing ? 'Edit Supervisor' : 'Add Supervisor'}</h2>
        <ErrorBox error={error} />
        {!editing ? (
          <div className="grid cols-2">
            <Field label="Added Supervisor">
              <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name, email or mobile" />
            </Field>
            <Field label="Pick">
              <select className="input" value={personId} onChange={(e) => pick(e.target.value)}>
                <option value="">-- New supervisor --</option>
                {options.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} · {p.email}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        <PersonFields meta={meta} value={value} onChange={setValue} onAddDesignation={() => setAddDesignation(true)} />
        {personId && !editing ? (
          <p className="practical-muted">Changes typed here apply to this session only. To change the saved details, use Edit All Supervisor.</p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={submit}>
            {editing ? 'Update' : 'Submit'}
          </button>
          <button type="button" className="btn secondary" onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </div>
      {confirm ? (
        <ConfirmDialog
          title={editing ? 'You want to Update Supervisor.' : 'You want to Save Supervisor.'}
          message=""
          yesLabel="Yes, Save this!"
          onYes={save}
          onNo={() => setConfirm(false)}
        />
      ) : null}
      {addDesignation ? (
        <QuickAddDialog
          title="Add Designation"
          label="Designation Name"
          onClose={() => setAddDesignation(false)}
          onSave={async (name) => {
            await addLookup('DESIGNATION', name);
            await onDesignationAdded();
            setValue((v) => ({ ...v, designation: name }));
            setAddDesignation(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Accepted from Supervisor → Edit: details, Salary Code, Remuneration, bank and cheque. */
function AcceptanceDialog({ meta, appt, onClose }: { meta: SupervisorMeta; appt: Appointment; onClose: (saved: boolean) => void }) {
  const [value, setValue] = useState<PersonForm>(personOf(appt));
  const [extra, setExtra] = useState({
    salaryCode: appt.salaryCode,
    remuneration: appt.remuneration,
    holderName: appt.bank?.holderName || '',
    bankName: appt.bank?.bankName || '',
    branch: appt.bank?.branch || '',
    ifsc: appt.bank?.ifsc || '',
    accountType: appt.bank?.accountType || '',
    account: appt.bank?.account || '',
  });
  const [cheque, setCheque] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof extra) => (e: { target: { value: string } }) => setExtra((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    const msg = checkPerson(value);
    if (msg) return setError(msg);
    if (!extra.salaryCode.trim()) return setError('Please Enter Salary Code');
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ ...value, ...extra })) fd.append(k, v);
      if (cheque) fd.append('cheque', cheque);
      await patch(`/supervisor/appointments/${appt._id}/acceptance`, fd);
      onClose(true);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <h2>Edit Supervisor</h2>
        <ErrorBox error={error} />
        <PersonFields meta={meta} value={value} onChange={setValue} />
        <div className="grid cols-2">
          <Field label="Salary Code" required>
            <input className="input" value={extra.salaryCode} maxLength={100} onChange={set('salaryCode')} />
          </Field>
          <Field label="Remuneration">
            <input className="input" value={extra.remuneration} maxLength={100} onChange={set('remuneration')} placeholder={`Total Duty: ${appt.totalDuty}`} />
          </Field>
          <Field label="Name of Examiner (as provided in Bank)" required>
            <input className="input" value={extra.holderName} onChange={set('holderName')} />
          </Field>
          <Field label="Bank Name" required>
            <input className="input" value={extra.bankName} onChange={set('bankName')} />
          </Field>
          <Field label="Branch Name with Bank Address" required>
            <input className="input" value={extra.branch} onChange={set('branch')} />
          </Field>
          <Field label="IFSC Code" required>
            <input className="input" maxLength={11} value={extra.ifsc} onChange={(e) => setExtra((x) => ({ ...x, ifsc: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label="Account Type" required>
            <select className="input" value={extra.accountType} onChange={set('accountType')}>
              <option value="">Select</option>
              <option>Saving</option>
              <option>Current</option>
            </select>
          </Field>
          <Field label="Account Number" required>
            <input className="input" inputMode="numeric" value={extra.account} onChange={(e) => setExtra((x) => ({ ...x, account: e.target.value.replace(/\D/g, '') }))} />
          </Field>
          <Field label="Replace cancelled cheque (JPG, PNG or PDF)">
            <input className="input" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setCheque(e.target.files?.[0] || null)} />
          </Field>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={save}>
            Update
          </button>
          <button type="button" className="btn secondary" onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

