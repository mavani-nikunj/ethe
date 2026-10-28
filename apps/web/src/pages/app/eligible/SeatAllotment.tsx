import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { get, patch, post, put } from '../../../api';
import { dmy, sessionLabel, useEligibleMeta } from './common';

type DateChoice = { examDate: string; shiftId: string; shiftName: string; papers: number; locked: boolean };
type Seat = { hallId: string; hallName: string; row: number; seatNo: number; active: boolean };
export type Placement = {
  hallId: string;
  hallName: string;
  row: number;
  seatNo: number;
  enrollmentNo: string;
  name: string;
  courseName: string;
  specialityName: string;
  paper: string;
};
type Allotment = {
  _id: string;
  examDate: string;
  shiftName: string;
  mode: string;
  startSeat: number | null;
  locked: boolean;
  lockedBy: { name?: string; at?: string } | null;
  processedAt: string | null;
  papers: { paperId: string; courseName: string; specialityName: string; paper: string; count: number }[];
  totalCandidates: number;
  seats: Seat[];
  activeSeats: number;
  placements: Placement[];
};

const MODES = [
  { value: 'CONTINUOUS', label: 'Continuously' },
  { value: 'ODD', label: 'Odd' },
  { value: 'EVEN', label: 'Even' },
];

export const PLACEMENT_COLUMNS = [
  { key: 'sr', label: 'Sr.No.' },
  { key: 'hallName', label: 'Hall Name' },
  { key: 'row', label: 'Row No' },
  { key: 'seatNo', label: 'Seat No' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'enrollmentNo', label: 'Roll No' },
  { key: 'specialityName', label: 'Speciality Name' },
  { key: 'courseName', label: 'Course Name' },
  { key: 'paper', label: 'Paper' },
];

/** Seat Allotment: Exam Date + Shift → seating (Continuously / Odd / Even) → Process → Allotment Lock. */
export function SeatAllotmentPage() {
  const { meta, error: metaError } = useEligibleMeta();
  const [sessionId, setSessionId] = useState('');
  const [dates, setDates] = useState<DateChoice[]>([]);
  const [examDate, setExamDate] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [mode, setMode] = useState('');
  const [startSeat, setStartSeat] = useState('1');
  const [allotment, setAllotment] = useState<Allotment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);

  useEffect(() => {
    if (meta && !sessionId) setSessionId(meta.currentSessionId || meta.sessions[0]?._id || '');
  }, [meta]);

  async function loadDates() {
    if (!sessionId) return;
    try {
      setDates(await get<DateChoice[]>(`/eligible/allotment/dates?sessionId=${encodeURIComponent(sessionId)}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    reset();
    loadDates();
  }, [sessionId]);

  const dayChoices = useMemo(() => [...new Set(dates.map((d) => d.examDate))], [dates]);
  const shiftChoices = dates.filter((d) => d.examDate === examDate);
  const canEdit = !!meta?.can.edit;
  const open = allotment && !allotment.locked;

  function reset() {
    setExamDate('');
    setShiftId('');
    setMode('');
    setStartSeat('1');
    setAllotment(null);
    setError(null);
    setNotice(null);
  }

  async function run(fn: () => Promise<Allotment>, done?: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const a = await fn();
      setAllotment(a);
      if (a.mode) setMode(a.mode);
      if (a.startSeat) setStartSeat(String(a.startSeat));
      if (done) setNotice(done);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function search() {
    if (!examDate) return setError('Please Select Date.');
    if (!shiftId) return setError('Please Select Shift');
    run(() => post<Allotment>('/eligible/allotment', { sessionId, examDate, shiftId })).then(() => loadDates());
  }

  function searchSeats() {
    if (!allotment) return;
    if (!mode) return setError('Please select Seats: Continuously, Odd or Even.');
    if (!(Number(startSeat) >= 1)) return setError('Please Enter Start Seat');
    run(() => put<Allotment>(`/eligible/allotment/${allotment._id}/seating`, { mode, startSeat: Number(startSeat) }));
  }

  function toggle(s: Seat) {
    if (!allotment) return;
    run(() => patch<Allotment>(`/eligible/allotment/${allotment._id}/seats`, { hallId: s.hallId, seatNo: s.seatNo, active: !s.active }));
  }

  function processAllotment() {
    if (!allotment) return;
    run(() => post<Allotment>(`/eligible/allotment/${allotment._id}/process`), 'Candidates placed. Check the Allotment Details, then lock.');
  }

  function lock() {
    setConfirmLock(false);
    if (!allotment) return;
    run(() => post<Allotment>(`/eligible/allotment/${allotment._id}/lock`), 'Allotment Locked Successfully.').then(() => loadDates());
  }

  const placementRows = (allotment?.placements || []).map((p, i) => ({ sr: i + 1, ...p }));
  const short = allotment && allotment.seats.length > 0 && allotment.activeSeats < allotment.totalCandidates;

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Seat Allotment</h1>
          <p>One allotment per exam date and shift for the whole institute. Exam dates come from Add Venue.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {notice ? <div className="practical-notice">{notice}</div> : null}

      <div className="card practical-filters">
        <div className="grid cols-4">
          <Field label="Session">
            <select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              {(meta?.sessions || []).map((s) => (
                <option key={s._id} value={s._id}>
                  {sessionLabel(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Exam Date" required>
            <select
              className="input"
              value={examDate}
              onChange={(e) => {
                setExamDate(e.target.value);
                setShiftId('');
                setAllotment(null);
              }}
            >
              <option value="">{dayChoices.length ? '-- Select Date --' : '-- No papers in Add Venue --'}</option>
              {dayChoices.map((d) => (
                <option key={d} value={d}>
                  {dmy(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift" required>
            <select
              className="input"
              value={shiftId}
              onChange={(e) => {
                setShiftId(e.target.value);
                setAllotment(null);
              }}
            >
              <option value="">-- Select Shift --</option>
              {shiftChoices.map((d) => (
                <option key={d.shiftId} value={d.shiftId}>
                  {d.shiftName}
                  {d.locked ? ' (locked)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="practical-filter-actions">
            <button type="button" className="btn gold" disabled={busy} onClick={search}>
              Search
            </button>
            <button type="button" className="btn secondary" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
      </div>

      {allotment ? (
        <>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="practical-toolbar">
              <h3 className="practical-total">
                {dmy(allotment.examDate)} · {allotment.shiftName}
              </h3>
              <h3 className="practical-total">
                Total Candidate Count <span className="practical-count">{allotment.totalCandidates}</span>
              </h3>
            </div>
            {allotment.locked ? (
              <div className="practical-notice">
                Already Locked{allotment.lockedBy?.name ? ` by ${allotment.lockedBy.name}` : ''}
                {allotment.lockedBy?.at ? ` on ${new Date(allotment.lockedBy.at).toLocaleString('en-IN')}` : ''}. This date and
                shift can no longer be re-allotted.
              </div>
            ) : null}
            <div className="table-scroll">
              <table className="table practical-table practical-nopin">
                <thead>
                  <tr>
                    <th>Sr.No.</th>
                    <th>Course</th>
                    <th>Speciality</th>
                    <th>Paper</th>
                    <th>Candidate Count</th>
                  </tr>
                </thead>
                <tbody>
                  {allotment.papers.map((p, i) => (
                    <tr key={p.paperId}>
                      <td>{i + 1}</td>
                      <td>{p.courseName}</td>
                      <td>{p.specialityName}</td>
                      <td>{p.paper}</td>
                      <td>{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {open && canEdit ? (
            <div className="card" style={{ marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Seats</h3>
              <div className="grid cols-4">
                <Field label="Seats" required>
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="">Select</option>
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Start Seat No (first hall)">
                  <input className="input" inputMode="numeric" value={startSeat} onChange={(e) => setStartSeat(e.target.value.replace(/\D/g, ''))} />
                </Field>
                <div className="practical-filter-actions">
                  <button type="button" className="btn gold" disabled={busy} onClick={searchSeats}>
                    Search
                  </button>
                </div>
              </div>
              {allotment.seats.length ? (
                <>
                  <div className="practical-toolbar" style={{ marginTop: 12 }}>
                    <h3 className="practical-total">
                      Total Active Seats <span className="practical-count">{allotment.activeSeats}</span>
                    </h3>
                    <button type="button" className="btn" disabled={busy || !!short} onClick={processAllotment}>
                      Process
                    </button>
                  </div>
                  {short ? (
                    <div className="error">
                      Only {allotment.activeSeats} active seat(s) for {allotment.totalCandidates} candidate(s). Switch more seats on,
                      choose Continuously, or add seats in Hall Master.
                    </div>
                  ) : null}
                  <div className="table-scroll hall-seats">
                    <table className="table practical-table practical-nopin">
                      <thead>
                        <tr>
                          <th>Sr.No.</th>
                          <th>Hall Name</th>
                          <th>Row No</th>
                          <th>Seat</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allotment.seats.map((s, i) => (
                          <tr key={`${s.hallId}:${s.seatNo}`}>
                            <td>{i + 1}</td>
                            <td>{s.hallName}</td>
                            <td>{s.row}</td>
                            <td>{s.seatNo}</td>
                            <td>
                              <button
                                type="button"
                                className={`btn small ${s.active ? 'seat-on' : 'seat-off'}`}
                                aria-pressed={s.active}
                                disabled={busy}
                                onClick={() => toggle(s)}
                              >
                                {s.active ? 'Active' : 'Deactive'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="practical-muted">Choose Continuously, Odd or Even and press Search to load the hall seats.</p>
              )}
            </div>
          ) : null}

          {allotment.placements.length ? (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="practical-toolbar">
                <h3 className="practical-total">
                  Allotment Details · Total Allotment Seats <span className="practical-count">{allotment.placements.length}</span>
                </h3>
                {open && canEdit ? (
                  <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirmLock(true)}>
                    Allotment Lock
                  </button>
                ) : null}
              </div>
              <div className="file-number-toolbar">
                <ExportButtons
                  columns={PLACEMENT_COLUMNS}
                  rows={placementRows}
                  filename={`seat-allotment-${allotment.examDate}`}
                  title={`Seat Allotment ${dmy(allotment.examDate)} ${allotment.shiftName}`}
                />
              </div>
              <div className="table-scroll">
                <table className="table practical-table practical-nopin">
                  <thead>
                    <tr>
                      {PLACEMENT_COLUMNS.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {placementRows.map((p) => (
                      <tr key={`${p.hallId}:${p.seatNo}`}>
                        <td>{p.sr}</td>
                        <td>{p.hallName}</td>
                        <td>{p.row}</td>
                        <td>{p.seatNo}</td>
                        <td>{p.name}</td>
                        <td>{p.enrollmentNo}</td>
                        <td>{p.specialityName}</td>
                        <td>{p.courseName}</td>
                        <td>{p.paper}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {confirmLock ? (
        <ConfirmDialog
          title="Are you sure?"
          message="Lock Allotment. Once locked, this exam date and shift can no longer be re-allotted."
          onYes={lock}
          onNo={() => setConfirmLock(false)}
        />
      ) : null}
    </Shell>
  );
}
