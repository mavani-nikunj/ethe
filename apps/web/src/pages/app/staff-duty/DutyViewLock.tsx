import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { get, patch, post } from '../../../api';
import { downloadCsv } from '../../../dept';
import { dmy } from '../supervisor/common';
import { RunBanner, fmtWhen, type RunView, type StaffDutyMeta } from './common';
import type { SittingsView } from './DutyAllotment';

type AllotRow = {
  _id: string;
  sittingId: string;
  examDate: string;
  day: string;
  shift: string;
  staffId: string;
  code: string;
  name: string;
  designation: string;
  department: string;
  memberRole: string;
  roleLabel: string;
  dutyAs: string;
  dutyAsLabel: string;
  source: string;
  duties: number;
};
type Shortfall = { sittingId: string; examDate: string; shift: string; dutyAs: string; dutyAsLabel: string; missing: number };
type AllotView = {
  rows: AllotRow[];
  load: { staffId: string; code: string; name: string; role: string; duties: number }[];
  shortfalls: Shortfall[];
  run: RunView;
  totalDuties: number;
};
type Candidate = { staffId: string; code: string; name: string; designation: string; role: string; roleLabel: string; duties: number };

const ROLE_LABEL: Record<string, string> = { ALL_DUTY: 'All Duty', SUPERVISOR: 'Supervisor', INVIGILATOR: 'Invigilator', SUPPORTING: 'Supporting' };

/** Old "View And Lock" modal (Duty Allotment): list, Change, Delete; new: add to a short sitting, lock / unlock, duty lists. */
export function ViewAndLockDialog({ meta, view, onClose }: { meta: StaffDutyMeta; view: SittingsView; onClose: () => void }) {
  const sessionId = view.session._id;
  const [date, setDate] = useState('');
  const [shift, setShift] = useState('');
  const [data, setData] = useState<AllotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<AllotRow | null>(null);
  const [adding, setAdding] = useState<Shortfall | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<void> } | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [print, setPrint] = useState<'all-duty' | 'others' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setError(null);
    try {
      const q = `${date ? `&examDate=${date}` : ''}${shift ? `&shift=${shift}` : ''}`;
      setData(await get<AllotView>(`/staff-duty/allotments?sessionId=${sessionId}${q}`));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [date, shift]);

  const locked = data?.run.status === 'LOCKED';
  const edit = meta.can.edit && !locked;
  const dates = [...new Set(view.sittings.map((s) => s.examDate))];
  const shifts = date ? view.sittings.filter((s) => s.examDate === date).map((s) => s.shift) : meta.shifts;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter((r) => !q || [r.name, r.code, r.roleLabel, r.designation, r.department].join(' ').toLowerCase().includes(q));
  }, [data, search]);
  const shortShown = (data?.shortfalls || []).filter((s) => (!date || s.examDate === date) && (!shift || s.shift === shift));

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

  const exportCols = [
    { key: 'sr', label: 'S.No.' },
    { key: 'roleLabel', label: 'Role' },
    { key: 'name', label: 'Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department' },
    { key: 'date', label: 'Date' },
    { key: 'shift', label: 'Shift Name' },
    { key: 'dutyAsLabel', label: 'Filled as' },
  ];

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" style={{ width: 'min(1200px, 100%)' }}>
        <div className="modal-head">
          <h2>Duty Allotment</h2>
          <button type="button" className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        <ErrorBox error={error} />
        {data ? <RunBanner run={data.run} short={data.shortfalls.reduce((n, s) => n + s.missing, 0)} /> : null}
        <div className="grid cols-2">
          <Field label="Exam Date">
            <select className="input" value={date} onChange={(e) => (setDate(e.target.value), setShift(''))}>
              <option value="">-- All --</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {dmy(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Exam Shift">
            <select className="input" value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">-- All --</option>
              {shifts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Duty <span className="practical-count">{shown.length}</span>
          </h3>
          <div className="row">
            <button type="button" className="btn small" onClick={() => setPrint('all-duty')}>
              All Duty Reports
            </button>
            <button type="button" className="btn small" onClick={() => setPrint('others')}>
              Others Duty Reports
            </button>
            {meta.can.edit ? (
              <button type="button" className="btn small secondary" onClick={() => setSettingsOpen(true)}>
                Duty list settings
              </button>
            ) : null}
            {meta.can.lock && !locked && data?.totalDuties ? (
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  setConfirm({
                    message: `You want to Lock Staff. The duty lists become final and nobody can change the allotment until the Asstt. Controller (Exams) unlocks it.${
                      data.shortfalls.length ? ` ${data.shortfalls.reduce((n, s) => n + s.missing, 0)} duties are still short.` : ''
                    }`,
                    run: async () => {
                      await post('/staff-duty/lock', { sessionId });
                    },
                  })
                }
              >
                Lock
              </button>
            ) : null}
            {meta.can.unlock && locked ? (
              <button type="button" className="btn small danger" onClick={() => setUnlocking(true)}>
                Unlock
              </button>
            ) : null}
          </div>
        </div>

        {shortShown.length ? (
          <div className="sd-notice warn">
            <b>Short:</b>{' '}
            {shortShown.map((s, i) => (
              <span key={`${s.sittingId}-${s.dutyAs}`}>
                {i ? ' · ' : ''}
                {dmy(s.examDate)} {s.shift}: {s.missing} {s.dutyAsLabel}
                {edit ? (
                  <>
                    {' '}
                    <button type="button" className="btn small secondary" onClick={() => setAdding(s)}>
                      Add staff
                    </button>
                  </>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <div className="file-number-toolbar">
          <ExportButtons
            columns={exportCols}
            rows={shown.map((r, i) => ({ sr: i + 1, ...r, date: dmy(r.examDate) }))}
            filename="staff-duty-allotment"
            title="Duty Allotment"
          />
          <button type="button" className="btn small secondary" onClick={() => setShowLoad(!showLoad)}>
            {showLoad ? 'Hide' : 'Show'} duty count per staff
          </button>
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>

        {showLoad && data ? (
          <div className="table-scroll" style={{ marginBottom: 12 }}>
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Duties</th>
                </tr>
              </thead>
              <tbody>
                {data.load.map((l) => (
                  <tr key={l.staffId}>
                    <td>{l.code}</td>
                    <td>{l.name}</td>
                    <td>{ROLE_LABEL[l.role] || ''}</td>
                    <td>{l.duties}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="table-scroll" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <table className="table practical-table">
            <thead>
              <tr>
                <th>S.No.</th>
                <th>Role</th>
                <th>Name</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Date</th>
                <th>Shift Name</th>
                <th>Duties</th>
                {edit ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r._id}>
                  <td>{i + 1}</td>
                  <td>
                    {r.roleLabel}
                    {r.dutyAs !== r.memberRole ? <span className="practical-muted"> (as {r.dutyAsLabel})</span> : null}
                  </td>
                  <td>
                    {r.name}
                    {r.source !== 'AUTO' ? <span className="practical-muted"> · {r.source === 'MANUAL' ? 'added' : 'changed'}</span> : null}
                  </td>
                  <td>{r.designation}</td>
                  <td>{r.department}</td>
                  <td className="nowrap">{dmy(r.examDate)}</td>
                  <td>{r.shift}</td>
                  <td>{r.duties}</td>
                  {edit ? (
                    <td>
                      <div className="row">
                        <button type="button" className="btn small secondary" onClick={() => setChange(r)}>
                          Change
                        </button>
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() =>
                            setConfirm({
                              message: `You want to Remove ${r.name} from ${dmy(r.examDate)} ${r.shift}.`,
                              run: async () => {
                                await post('/staff-duty/allotments/delete', { ids: [r._id] });
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
              {data && !shown.length ? (
                <tr>
                  <td colSpan={9} className="practical-empty">
                    No duty allotted{date ? ' for this filter' : ' yet. Use Staff Preference → Lock Preferences'}.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {data?.run.unlocks.length ? (
          <p className="practical-muted">
            Last unlocked {fmtWhen(data.run.unlocks.at(-1)!.at)} by {data.run.unlocks.at(-1)!.byName}: {data.run.unlocks.at(-1)!.reason}
          </p>
        ) : null}
      </div>

      {change ? (
        <ChangeDialog
          row={change}
          onClose={async (changed) => {
            setChange(null);
            if (changed) await load();
          }}
        />
      ) : null}
      {adding ? (
        <AddToSittingDialog
          short={adding}
          onClose={async (changed) => {
            setAdding(null);
            if (changed) await load();
          }}
        />
      ) : null}
      {unlocking ? (
        <UnlockDialog
          sessionId={sessionId}
          onClose={async (changed) => {
            setUnlocking(false);
            if (changed) await load();
          }}
        />
      ) : null}
      {print ? <DutyListPrint sessionId={sessionId} kind={print} onClose={() => setPrint(null)} /> : null}
      {settingsOpen && data ? <SettingsDialog sessionId={sessionId} settings={data.run.settings} onClose={async () => (setSettingsOpen(false), await load())} /> : null}
      {confirm ? <ConfirmDialog title="Are you sure?" message={confirm.message} onYes={run} onNo={() => setConfirm(null)} /> : null}
    </div>
  );
}

/** Change Staff Duty: replace by an available person of the same role; fewest duties first. */
function ChangeDialog({ row, onClose }: { row: AllotRow; onClose: (changed: boolean) => void }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    get<{ candidates: Candidate[] }>(`/staff-duty/allotments/${row._id}/replacements`)
      .then((r) => setList(r.candidates))
      .catch((err) => setError(err.message));
  }, [row._id]);
  async function save() {
    setAsk(false);
    try {
      await post(`/staff-duty/allotments/${row._id}/replace`, { staffId: pick });
      onClose(true);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Change Staff Duty</h2>
          <button type="button" className="btn secondary small" onClick={() => onClose(false)}>
            Close
          </button>
        </div>
        <ErrorBox error={error} />
        <div className="grid cols-2">
          <Field label="Current Staff Name:">
            <input className="input" value={`${row.name} (${row.duties} duties)`} disabled />
          </Field>
          <Field label="Exam Date:">
            <input className="input" value={`${dmy(row.examDate)} ${row.day}`} disabled />
          </Field>
          <Field label="Exam Shift:">
            <input className="input" value={row.shift} disabled />
          </Field>
          <Field label="Role:">
            <input className="input" value={row.roleLabel} disabled />
          </Field>
        </div>
        <h3 className="practical-total">
          Available <span className="practical-count">{list?.length ?? 0}</span>
        </h3>
        {list && !list.length ? <p className="sd-short">No other {row.roleLabel} is available for this date and shift.</p> : null}
        {list?.length ? (
          <div className="table-scroll" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  <th>S.No.</th>
                  <th>Role</th>
                  <th>Name</th>
                  <th>Duties</th>
                  <th>Replace by</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={c.staffId}>
                    <td>{i + 1}</td>
                    <td>{c.roleLabel}</td>
                    <td>{c.name}</td>
                    <td>{c.duties}</td>
                    <td>
                      <input type="radio" name="sd-replace" aria-label={`Replace by ${c.name}`} checked={pick === c.staffId} onChange={() => setPick(c.staffId)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {list?.length ? (
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={!pick} onClick={() => setAsk(true)}>
              Submit
            </button>
          </div>
        ) : null}
      </div>
      {ask ? <ConfirmDialog title="Are you sure?" message="You want to Remove this Staff and Allot New Staff." onYes={save} onNo={() => setAsk(false)} /> : null}
    </div>
  );
}

/** Add staff to a short sitting (new: the old screen could only regenerate everything). */
function AddToSittingDialog({ short, onClose }: { short: Shortfall; onClose: (changed: boolean) => void }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  async function load() {
    try {
      setList(await get<Candidate[]>(`/staff-duty/sittings/${short.sittingId}/candidates?dutyAs=${short.dutyAs}`));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function add(c: Candidate) {
    setError(null);
    try {
      await post('/staff-duty/allotments', { sittingId: short.sittingId, staffId: c.staffId, dutyAs: short.dutyAs });
      setAdded(added + 1);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }
  const left = short.missing - added;
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>
            Add {short.dutyAsLabel} · {dmy(short.examDate)} {short.shift}
          </h2>
          <button type="button" className="btn secondary small" onClick={() => onClose(added > 0)}>
            Close
          </button>
        </div>
        <ErrorBox error={error} />
        <p className="practical-muted">{left > 0 ? `${left} still needed.` : 'This duty is filled.'} Supervisors are listed after the role's own staff, as in the old allotment.</p>
        <div className="table-scroll" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <table className="table practical-table practical-nopin">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Role</th>
                <th>Duties</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(list || []).map((c) => (
                <tr key={c.staffId}>
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.roleLabel}</td>
                  <td>{c.duties}</td>
                  <td>
                    <button type="button" className="btn small" disabled={left <= 0} onClick={() => add(c)}>
                      Add
                    </button>
                  </td>
                </tr>
              ))}
              {list && !list.length ? (
                <tr>
                  <td colSpan={5} className="practical-empty">
                    Nobody else is available for this date and shift.
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

function UnlockDialog({ sessionId, onClose }: { sessionId: string; onClose: (changed: boolean) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!reason.trim()) return setError('Please enter the reason to unlock.');
    try {
      await post('/staff-duty/unlock', { sessionId, reason });
      onClose(true);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true">
        <h2>Unlock duty allotment</h2>
        <ErrorBox error={error} />
        <Field label="Reason" required>
          <textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn danger" onClick={save}>
            Unlock
          </button>
          <button type="button" className="btn secondary" onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsDialog({ sessionId, settings, onClose }: { sessionId: string; settings: RunView['settings']; onClose: () => void }) {
  const [morning, setMorning] = useState(settings.reportingTime.Morning);
  const [evening, setEvening] = useState(settings.reportingTime.Evening);
  const [period, setPeriod] = useState(settings.titlePeriod || '');
  const [notes, setNotes] = useState(settings.notes.join('\n'));
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      await patch('/staff-duty/settings', {
        sessionId,
        reportingTime: { Morning: morning, Evening: evening },
        titlePeriod: period,
        notes: notes.split('\n').map((n) => n.trim()).filter(Boolean),
      });
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <h2>Duty list settings</h2>
        <ErrorBox error={error} />
        <div className="grid cols-2">
          <Field label="Reporting time — Morning">
            <input className="input" value={morning} maxLength={20} onChange={(e) => setMorning(e.target.value)} />
          </Field>
          <Field label="Reporting time — Evening">
            <input className="input" value={evening} maxLength={20} onChange={(e) => setEvening(e.target.value)} />
          </Field>
        </div>
        <Field label="Period in the title (empty = from the first and last exam date)">
          <input className="input" value={period} maxLength={80} placeholder="e.g. MAY 2022 TO JUNE 2022" onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label="IMPORTANT notes (one per line, on the staff list)">
          <textarea className="input" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={save}>
            Save
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type DutyList = {
  kind: 'all-duty' | 'others';
  title: string;
  reportingTime: { Morning: string; Evening: string };
  notes: string[];
  dates: { examDate: string; day: string; shifts: string[] }[];
  groups: { role: string; heading: string; people: { staffId: string; code: string; name: string; total: number; cells: Record<string, string> }[] }[];
  status: string;
  signatories: string[];
};

const SHIFT_COLS = [
  { shift: 'Morning', short: 'M' },
  { shift: 'Evening', short: 'E' },
];

/** The old printed duty list: staff × date × M/E with D / X and Total Days. */
function DutyListPrint({ sessionId, kind, onClose }: { sessionId: string; kind: 'all-duty' | 'others'; onClose: () => void }) {
  const [list, setList] = useState<DutyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<DutyList>(`/staff-duty/duty-list?sessionId=${sessionId}&kind=${kind}`)
      .then(setList)
      .catch((err) => setError(err.message));
  }, [kind]);
  const width = list ? list.dates.length * 2 + 3 : 3;
  const ddmmyy = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}`;

  function excel() {
    if (!list) return;
    const cols = [
      { key: 'sr', label: 'S. No.' },
      { key: 'name', label: 'Name' },
      ...list.dates.flatMap((d) => SHIFT_COLS.map((s) => ({ key: `${d.examDate}|${s.shift}`, label: `${ddmmyy(d.examDate)} ${s.short}` }))),
      { key: 'total', label: 'Total Days' },
    ];
    let n = 0;
    const rows = list.groups.flatMap((g) => [
      ...(list.kind === 'others' ? [{ sr: '', name: g.heading }] : []),
      ...g.people.map((p) => ({ sr: ++n, name: p.name, total: p.total, ...p.cells })),
    ]);
    downloadCsv(`${kind === 'all-duty' ? 'all-duty' : 'staff'}-duty-list.csv`, cols, rows);
  }

  let n = 0;
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" style={{ width: 'min(1400px, 100%)' }}>
        <div className="modal-head no-print">
          <h2>{kind === 'all-duty' ? 'All Duty Reports' : 'Others Duty Reports'}</h2>
          <div className="row">
            <button type="button" className="btn small" disabled={!list} onClick={() => window.print()}>
              Print
            </button>
            <button type="button" className="btn small secondary" disabled={!list} onClick={excel}>
              Download Excel
            </button>
            <button type="button" className="btn secondary small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <ErrorBox error={error} />
        {list && !list.groups.length ? <p className="practical-empty">Nobody is on duty in this list yet.</p> : null}
        {list && list.groups.length ? (
          <div className="table-scroll">
            <div className="sd-print">
              {list.status !== 'LOCKED' ? <p className="sd-draft">DRAFT — NOT LOCKED</p> : null}
              <h2>{list.title}</h2>
              <p className="sd-reporting">
                REPORTING TIME &nbsp; MORNING : {list.reportingTime.Morning} &nbsp; EVENING : {list.reportingTime.Evening}
              </p>
              <table className="sd-matrix">
                <thead>
                  <tr>
                    <th />
                    <th />
                    {list.dates.map((d) => (
                      <th key={d.examDate} colSpan={2}>
                        {ddmmyy(d.examDate)}
                      </th>
                    ))}
                    <th />
                  </tr>
                  <tr>
                    <th>S. No.</th>
                    <th>Name</th>
                    {list.dates.flatMap((d) => SHIFT_COLS.map((s) => <th key={`${d.examDate}${s.short}`}>{s.short}</th>))}
                    <th>Total Days</th>
                  </tr>
                </thead>
                <tbody>
                  {list.groups.map((g) => (
                    <GroupRows key={g.role} heading={list.kind === 'others' ? g.heading : ''} width={width}>
                      {g.people.map((p) => (
                        <tr key={p.staffId}>
                          <td>{++n}</td>
                          <td className="sd-name">{p.name}</td>
                          {list.dates.flatMap((d) =>
                            SHIFT_COLS.map((s) => {
                              const c = p.cells[`${d.examDate}|${s.shift}`];
                              return <td key={`${d.examDate}${s.short}`}>{c === 'D' ? <b>D</b> : 'X'}</td>;
                            }),
                          )}
                          <td>
                            <b>{p.total}</b>
                          </td>
                        </tr>
                      ))}
                    </GroupRows>
                  ))}
                  {list.notes.length ? (
                    <>
                      <tr>
                        <td colSpan={width}>
                          <b>IMPORTANT</b>
                        </td>
                      </tr>
                      {list.notes.map((note, i) => (
                        <tr key={i}>
                          <td colSpan={width} className="sd-note">
                            {i + 1}. {note}
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : null}
                </tbody>
              </table>
              <div className="sd-sign">
                {list.signatories.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GroupRows({ heading, width, children }: { heading: string; width: number; children: React.ReactNode }) {
  return (
    <>
      {heading ? (
        <tr className="sd-group">
          <td />
          <td colSpan={width - 1}>{heading}</td>
        </tr>
      ) : null}
      {children}
    </>
  );
}
