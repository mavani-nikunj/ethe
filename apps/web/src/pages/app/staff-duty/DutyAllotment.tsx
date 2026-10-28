import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field, ResultDialog } from '../../../components/ui';
import { get, patch, post } from '../../../api';
import { dmy } from '../supervisor/common';
import { NEED_KEYS, NO_SESSION, RunBanner, StaffSessionBar, useStaffDutyMeta, useStaffSession, type Need, type RunView, type StaffDutyMeta } from './common';
import { ViewAndLockDialog } from './DutyViewLock';

export type SittingRow = {
  _id: string;
  scheduleId: string;
  examDate: string;
  day: string;
  shift: string;
  examName: string;
  studentCount: number | null;
  need: Need;
  allotted: Need;
  needTotal: number;
  allottedTotal: number;
  short: number;
};
type ScheduleOption = { _id: string; examDate: string; day: string; shift: string; examName: string; studentCount: number; added: boolean };
export type SittingsView = {
  sittings: SittingRow[];
  schedule: ScheduleOption[];
  available: Record<string, number>;
  run: RunView;
  session: { _id: string; month: string; year: number };
};

/** Old "Duty Allotment" — Manage Staff Duty (docs/staff-duty-plan.md §5.3–5.7). */
export function DutyAllotmentPage() {
  const { meta, error: metaError, reload } = useStaffDutyMeta();
  const [askSession, setAskSession] = useState(false);
  const [sessionId, setSessionId] = useStaffSession(meta);
  const [view, setView] = useState<SittingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [examForm, setExamForm] = useState<{ row?: SittingRow } | null>(null);
  const [prefOpen, setPrefOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<string> } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    if (!sessionId) return;
    setError(null);
    try {
      setView(await get<SittingsView>(`/staff-duty/sittings?sessionId=${sessionId}`));
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [sessionId]);

  const canEdit = !!meta?.can.edit;
  const locked = view?.run.status === 'LOCKED';
  const edit = canEdit && !locked;
  const rows = view?.sittings || [];
  const short = rows.reduce((n, r) => n + r.short, 0);

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

  function deleteRows(ids: string[], label: string) {
    const duties = rows.filter((r) => ids.includes(r._id)).reduce((n, r) => n + r.allottedTotal, 0);
    setConfirm({
      message: `${label}${duties ? ` ${duties} allotted duties on ${ids.length > 1 ? 'them' : 'it'} will be removed too.` : ''}`,
      run: async () => {
        await post('/staff-duty/sittings/delete', { ids });
        return 'Delete successfully.';
      },
    });
  }

  const exportCols = [
    { key: 'sr', label: 'S.No.' },
    { key: 'date', label: 'Date' },
    { key: 'day', label: 'Day' },
    { key: 'shift', label: 'Shift' },
    ...NEED_KEYS.map((n) => ({ key: n.key, label: n.label })),
    { key: 'allotted', label: 'Allotted' },
  ];
  const exportRows = rows.map((r, i) => ({
    sr: i + 1,
    date: dmy(r.examDate),
    day: r.day,
    shift: r.shift,
    ...r.need,
    allotted: `${r.allottedTotal}/${r.needTotal}`,
  }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Manage Staff Duty</h1>
          <p>How many staff each exam sitting needs, who may be put on duty, and the allotment.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <StaffSessionBar
          meta={meta}
          sessionId={sessionId}
          onChange={setSessionId}
          onSearch={load}
          askCreate={askSession}
          onCreateCancel={() => setAskSession(false)}
          onCreated={async (id) => {
            setAskSession(false);
            await reload();
            setSessionId(id);
          }}
        />
      ) : null}
      {view ? <RunBanner run={view.run} short={short} /> : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Exam <span className="practical-count">{rows.length}</span>
          </h3>
          {canEdit || view ? (
            <div className="row">
              {edit ? (
                <button type="button" className="btn small" onClick={() => (view ? setExamForm({}) : sessionId ? setError(NO_SESSION) : setAskSession(true))}>
                  Add Exam Duty
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" className="btn small" onClick={() => (view ? setPrefOpen(true) : sessionId ? setError(NO_SESSION) : setAskSession(true))}>
                  Staff Preference
                </button>
              ) : null}
              <button type="button" className="btn small" onClick={() => (view ? setViewOpen(true) : sessionId ? setError(NO_SESSION) : setAskSession(true))}>
                View And Lock
              </button>
              {edit ? (
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() =>
                    selected.size ? deleteRows([...selected], 'You want to delete selected.') : setError('Please select atleast 1 data to delete.')
                  }
                >
                  Delete Selected
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="staff-duty-exams" title="Manage Staff Duty" />
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  {edit ? (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selected.size === rows.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r._id)) : new Set())}
                      />
                    </th>
                  ) : null}
                  <th>S.No.</th>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Shift</th>
                  {NEED_KEYS.map((n) => (
                    <th key={n.key}>{n.label}</th>
                  ))}
                  <th>Allotted</th>
                  {edit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._id}>
                    {edit ? (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${dmy(r.examDate)} ${r.shift}`}
                          checked={selected.has(r._id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(r._id);
                            else next.delete(r._id);
                            setSelected(next);
                          }}
                        />
                      </td>
                    ) : null}
                    <td>{i + 1}</td>
                    <td className="nowrap">{dmy(r.examDate)}</td>
                    <td>{r.day}</td>
                    <td>{r.shift}</td>
                    {NEED_KEYS.map((n) => (
                      <td key={n.key}>
                        {r.need[n.key]}
                        {view?.run.generated && r.allotted[n.key] < r.need[n.key] ? <span className="sd-short"> ({r.allotted[n.key]})</span> : null}
                      </td>
                    ))}
                    <td className={r.short ? 'sd-short' : undefined}>
                      {view?.run.generated || r.allottedTotal ? `${r.allottedTotal}/${r.needTotal}` : '—'}
                    </td>
                    {edit ? (
                      <td>
                        <div className="row">
                          <button type="button" className="btn small secondary" onClick={() => setExamForm({ row: r })}>
                            Edit
                          </button>
                          <button type="button" className="btn small danger" onClick={() => deleteRows([r._id], 'You want to Delete Exam.')}>
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
          <p className="practical-empty">
            {view && !view.schedule.length
              ? 'No exam dates in the Supervisor schedule of this session. Add them on Supervisor → Add Schedule first.'
              : sessionId
                ? 'No exam duty added yet.'
                : ''}
          </p>
        )}
        {view?.run.generated ? <p className="practical-muted">A number in brackets is how many are allotted when it is less than needed.</p> : null}
      </div>

      {examForm && view && meta ? (
        <ExamDutyDialog
          view={view}
          row={examForm.row}
          onClose={async (msg) => {
            setExamForm(null);
            if (msg) {
              setDone(msg);
              await load();
            }
          }}
        />
      ) : null}
      {prefOpen && view && meta ? (
        <PreferenceDialog
          meta={meta}
          view={view}
          onClose={async (msg) => {
            setPrefOpen(false);
            await load();
            if (msg) setDone(msg);
          }}
        />
      ) : null}
      {viewOpen && view && meta ? (
        <ViewAndLockDialog
          meta={meta}
          view={view}
          onClose={async () => {
            setViewOpen(false);
            await load();
          }}
        />
      ) : null}
      {confirm ? <ConfirmDialog title="Are you sure?" message={confirm.message} yesLabel="Yes, Delete it!" onYes={run} onNo={() => setConfirm(null)} /> : null}
      {done ? <ResultDialog ok message={done} onClose={() => setDone(null)} /> : null}
    </Shell>
  );
}

/** Add Exam Duty / edit: date → shift from the schedule; counts with "Available (n)", prefilled with n (old). */
function ExamDutyDialog({ view, row, onClose }: { view: SittingsView; row?: SittingRow; onClose: (msg?: string) => void }) {
  const editing = !!row;
  const [date, setDate] = useState(row?.examDate || '');
  const [scheduleId, setScheduleId] = useState(row?.scheduleId || '');
  const [need, setNeed] = useState<Record<string, string>>(() =>
    Object.fromEntries(NEED_KEYS.map((n) => [n.key, String(row ? row.need[n.key] : view.available[n.role] || 0)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const free = view.schedule.filter((s) => !s.added || s._id === row?.scheduleId);
  const dates = [...new Set(free.map((s) => s.examDate))];
  const shifts = free.filter((s) => s.examDate === date);
  const chosen = view.schedule.find((s) => s._id === scheduleId);

  function submit() {
    setError(null);
    if (!date) return setError('Please select Exam Date.');
    if (!scheduleId) return setError('Please select Exam Shift.');
    for (const n of NEED_KEYS) {
      const v = Number(need[n.key] || 0);
      if (v > view.available[n.role]) return setError(`Please enter less than Available ${n.label} Duty.`);
    }
    if (!NEED_KEYS.some((n) => Number(need[n.key] || 0) > 0)) return setError('Please enter atleast 1 Duty.');
    setAsk(true);
  }

  async function save() {
    setAsk(false);
    const body = { sessionId: view.session._id, scheduleId, need: Object.fromEntries(NEED_KEYS.map((n) => [n.key, Number(need[n.key] || 0)])) };
    try {
      if (editing) await patch(`/staff-duty/sittings/${row!._id}`, body);
      else await post('/staff-duty/sittings', body);
      onClose(editing ? 'Updated successfully.' : 'Exam Duty saved successfully.');
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{editing ? 'Edit Exam Duty' : 'Add Exam Duty'}</h2>
          <button type="button" className="btn secondary small" onClick={() => onClose()}>
            Close
          </button>
        </div>
        <p className="practical-muted">All fields are mandatory</p>
        <ErrorBox error={error} />
        <div className="grid cols-2">
          <Field label="Choose Exam Date" required>
            <select className="input" value={date} disabled={editing} onChange={(e) => (setDate(e.target.value), setScheduleId(''))}>
              <option value="">-- Select Date --</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {dmy(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Choose Exam Shift" required>
            <select className="input" value={scheduleId} disabled={editing || !date} onChange={(e) => setScheduleId(e.target.value)}>
              <option value="">--Select shift--</option>
              {shifts.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.shift}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {chosen ? (
          <p className="practical-muted">
            {chosen.day} · {chosen.examName} · {chosen.studentCount} students
          </p>
        ) : null}
        {!editing && !view.schedule.length ? (
          <div className="sd-notice warn">
            No exam dates in this session yet. Add the dates and shifts on <Link to="/app/supervisor/schedule">Supervisor → Add Schedule</Link> first.
          </div>
        ) : !editing && !dates.length ? (
          <p className="practical-muted">Every sitting of the Supervisor schedule already has an exam duty.</p>
        ) : null}
        <div className="sd-need-grid">
          {NEED_KEYS.map((n) => (
            <Field key={n.key} label={`Enter ${n.label} Duty`} required>
              <input
                className="input"
                inputMode="numeric"
                value={need[n.key]}
                onChange={(e) => setNeed({ ...need, [n.key]: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              />
              <span className="practical-muted">
                <b>Available ({view.available[n.role] || 0})</b>
              </span>
            </Field>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={submit}>
            {editing ? 'Update Duty' : 'Add Duty'}
          </button>
        </div>
      </div>
      {ask ? <ConfirmDialog title="Are you sure?" message="You want to save Exam Duty." onYes={save} onNo={() => setAsk(false)} /> : null}
    </div>
  );
}

type PrefRow = {
  _id: string;
  code: string;
  name: string;
  designation: string;
  role: string;
  roleLabel: string;
  shiftPreference: string;
  allot: boolean;
  availableOnSitting: boolean | null;
  unavailableCount: number;
  duties: number;
};

/**
 * Staff Preference: with "-- All --" the shift preference and Allotment tick apply to the whole session;
 * with a date + shift the tick means "available on that sitting". Lock Preferences allots the duties.
 */
function PreferenceDialog({ meta, view, onClose }: { meta: StaffDutyMeta; view: SittingsView; onClose: (msg?: string) => void }) {
  const [date, setDate] = useState('');
  const [shift, setShift] = useState('');
  const [rows, setRows] = useState<PrefRow[]>([]);
  const [changes, setChanges] = useState<Map<string, { shiftPreference?: string; allot?: boolean; available?: boolean }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'clear' | 'lock' | null>(null);
  const [mode, setMode] = useState('keep-manual');
  const [busy, setBusy] = useState(false);
  const locked = view.run.status === 'LOCKED';
  const perSitting = !!date && !!shift;
  // Old GetPaperDate: exam dates come from Supervisor → Add Schedule, even before an exam duty is added.
  const dates = [...new Set(view.schedule.map((s) => s.examDate))];
  const shifts = date ? view.schedule.filter((s) => s.examDate === date).map((s) => s.shift) : meta.shifts;

  async function load() {
    setError(null);
    try {
      const q = perSitting ? `&examDate=${date}&shift=${shift}` : '';
      setRows(await get<PrefRow[]>(`/staff-duty/preferences?sessionId=${view.session._id}${q}`));
      setChanges(new Map());
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    if (!date || shift) load();
  }, [date, shift]);

  const change = (id: string, patchRow: { shiftPreference?: string; allot?: boolean; available?: boolean }) => {
    const next = new Map(changes);
    next.set(id, { ...(next.get(id) || {}), ...patchRow });
    setChanges(next);
  };
  const value = (r: PrefRow) => ({ ...r, ...(changes.get(r._id) || {}) });

  /** Only real changes are sent (old code sent every clicked row). */
  function pending() {
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const c = changes.get(r._id);
      if (!c) continue;
      if (perSitting) {
        if (c.available !== undefined && c.available !== r.availableOnSitting) out.push({ memberId: r._id, examDate: date, shift, available: c.available });
      } else {
        const item: Record<string, unknown> = { memberId: r._id };
        if (c.shiftPreference !== undefined && c.shiftPreference !== r.shiftPreference) item.shiftPreference = c.shiftPreference;
        if (c.allot !== undefined && c.allot !== r.allot) item.allot = c.allot;
        if (Object.keys(item).length > 1) out.push(item);
      }
    }
    return out;
  }

  async function save() {
    setError(null);
    setInfo(null);
    if (date && !shift) return setError('Please Select Shift');
    const list = pending();
    if (!list.length) return setError('Please change atleast 1 Staff.');
    try {
      await post('/staff-duty/preferences', { sessionId: view.session._id, changes: list });
      setInfo('Changes has been saved.');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function act() {
    const what = confirm;
    setConfirm(null);
    setError(null);
    setBusy(true);
    try {
      if (pending().length) await post('/staff-duty/preferences', { sessionId: view.session._id, changes: pending() });
      if (what === 'clear') {
        const r = await post<{ dutiesRemoved: number }>('/staff-duty/preferences/clear', { sessionId: view.session._id });
        setInfo(`Preferences cleared${r.dutiesRemoved ? ` and ${r.dutiesRemoved} allotted duties removed` : ''}.`);
        await load();
      } else {
        const r = await post<{ added: number; kept: number; shortfalls: { missing: number }[] }>('/staff-duty/allot', { sessionId: view.session._id, mode });
        const missing = r.shortfalls.reduce((n, s) => n + s.missing, 0);
        onClose(
          `Duties allotted: ${r.added} new${r.kept ? `, ${r.kept} kept` : ''}.${missing ? ` ${missing} duties could not be filled — see View And Lock.` : ' Every exam duty is filled.'}`,
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Staff Preference</h2>
          <button type="button" className="btn secondary small" onClick={() => onClose()}>
            Close
          </button>
        </div>
        <ErrorBox error={error} />
        {info ? <div className="sd-notice ok">{info}</div> : null}
        {locked ? <div className="sd-notice warn">The allotment is locked. Preferences can be viewed only.</div> : null}
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
            <select className="input" value={shift} disabled={!date} onChange={(e) => setShift(e.target.value)}>
              <option value="">-- All --</option>
              {shifts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="practical-muted">
          {perSitting
            ? `Tick = may be put on duty on ${dmy(date)} ${shift}. Untick staff who are on leave or busy in that sitting.`
            : date
              ? 'Select the shift to mark who is not available on that sitting.'
              : 'Shift Preference and the Allotment tick apply to the whole session. Untick staff who must not get any duty.'}
        </p>
        {!view.schedule.length ? (
          <div className="sd-notice warn">
            No exam dates in this session yet, so Exam Date has nothing to show. Add the dates and shifts on{' '}
            <Link to="/app/supervisor/schedule">Supervisor → Add Schedule</Link> for {view.session.month} {view.session.year}.
          </div>
        ) : null}
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Staff <span className="practical-count">{rows.length}</span>
          </h3>
          {!locked ? (
            <div className="row">
              <button type="button" className="btn small" disabled={busy} onClick={save}>
                Save Preferences
              </button>
              <button type="button" className="btn small" disabled={busy} onClick={() => setConfirm('lock')}>
                Lock Preferences
              </button>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => setConfirm('clear')}>
                Clear Preferences
              </button>
            </div>
          ) : null}
        </div>
        <div className="table-scroll" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          <table className="table practical-table practical-nopin">
            <thead>
              <tr>
                <th>S.No.</th>
                <th>Code</th>
                <th>Name</th>
                <th>Designation</th>
                <th>Duty</th>
                <th>Shift Preference</th>
                <th>Allotment</th>
                <th>Duties</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r0, i) => {
                const r = value(r0);
                const ticked = perSitting ? (r.available ?? r.availableOnSitting) !== false && r.allot : r.allot;
                return (
                  <tr key={r._id}>
                    <td>{i + 1}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.designation}</td>
                    <td>{r.roleLabel}</td>
                    <td>
                      <select
                        className="input"
                        value={r.shiftPreference}
                        disabled={!!date || locked}
                        onChange={(e) => change(r._id, { shiftPreference: e.target.value })}
                      >
                        <option value="ANY">All</option>
                        <option value="Morning">Morning</option>
                        <option value="Evening">Evening</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Allotment ${r.name}`}
                        checked={ticked}
                        disabled={locked || (date && !shift) || (perSitting && !r.allot) || false}
                        title={perSitting && !r.allot ? 'Not allotted for the whole session' : undefined}
                        onChange={(e) => change(r._id, perSitting ? { available: e.target.checked } : { allot: e.target.checked })}
                      />
                      {!perSitting && r.unavailableCount ? <span className="practical-muted"> ({r.unavailableCount} sittings off)</span> : null}
                    </td>
                    <td>{r.duties}</td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="practical-empty">
                    No staff with a role in this session. Set roles on Add Staff.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      {confirm === 'clear' ? (
        <ConfirmDialog
          title="Are you sure?"
          message="You want to Clear Preferences. Every preference goes back to All + allotted, and the current allotment is removed."
          onYes={act}
          onNo={() => setConfirm(null)}
        />
      ) : null}
      {confirm === 'lock' ? (
        <div className="modal-overlay dialog-overlay" role="presentation">
          <div className="modal-card dialog-card" role="dialog" aria-modal="true">
            <h2>Are you sure?</h2>
            <p>You want to Lock Preferences. Duties are allotted for every exam date using these preferences.</p>
            {view.run.generated ? (
              <div className="grid">
                <label className="row">
                  <input type="radio" name="sd-mode" checked={mode === 'keep-manual'} onChange={() => setMode('keep-manual')} />
                  <span>Re-allot, keeping my manual changes (Change / added staff)</span>
                </label>
                <label className="row">
                  <input type="radio" name="sd-mode" checked={mode === 'fill-gaps'} onChange={() => setMode('fill-gaps')} />
                  <span>Only fill the duties that are short</span>
                </label>
                <label className="row">
                  <input type="radio" name="sd-mode" checked={mode === 'rebuild'} onChange={() => setMode('rebuild')} />
                  <span>Start again (remove the whole allotment first)</span>
                </label>
              </div>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={act}>
                Yes
              </button>
              <button type="button" className="btn secondary" onClick={() => setConfirm(null)}>
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
