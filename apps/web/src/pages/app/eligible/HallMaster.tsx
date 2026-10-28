import { useEffect, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { del, get, patch, post } from '../../../api';

type HallSummary = { _id: string; name: string; totalSeats: number; activeSeats: number; rows: number };
type Seat = { row: number; seatNo: number; active: boolean };
type Hall = HallSummary & { seats: Seat[]; added?: number; skipped?: number[]; existing?: boolean };

const LIST_COLUMNS = [
  { key: 'sr', label: 'Sr.No.' },
  { key: 'name', label: 'Hall Name' },
  { key: 'totalSeats', label: 'Total Seat' },
  { key: 'activeSeats', label: 'Active Seat' },
];

/** Add Hall / Show modal: Hall Name → Process, then rows of seats and the Seat Structure of Hall. */
function HallDialog({ hallId, onClose }: { hallId: string | null; onClose: () => void }) {
  const [hall, setHall] = useState<Hall | null>(null);
  const [name, setName] = useState('');
  const [row, setRow] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRow, setConfirmRow] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!hallId) return;
    get<Hall>(`/eligible/halls/${hallId}`)
      .then((h) => {
        setHall(h);
        setName(h.name);
      })
      .catch((err) => setError(err.message));
  }, [hallId]);

  const startN = Number(start);
  const endN = Number(end);
  const total = start && end && endN >= startN ? endN - startN + 1 : 0;

  async function process() {
    setError(null);
    setNotice(null);
    if (!name.trim()) {
      setError('Please Enter Hall Name.');
      return;
    }
    setBusy(true);
    try {
      if (hall) {
        setHall(await patch<Hall>(`/eligible/halls/${hall._id}`, { name }));
        setNotice('Hall name saved.');
      } else {
        const h = await post<Hall>('/eligible/halls', { name });
        setHall(h);
        setName(h.name);
        setNotice(h.existing ? `Hall "${h.name}" already exists — its seats are shown below.` : 'Hall added. Now add its rows of seats.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function checkRow() {
    setError(null);
    setNotice(null);
    if (!(Number(row) > 0)) return setError('Please Enter Row No and greater Than Zero.');
    if (!(startN > 0)) return setError('Please Enter Start Seat Number and greater Than Zero.');
    if (!(endN > 0)) return setError('Please Enter End Seat Number  and greater Than Zero.');
    if (endN < startN) return setError('Please Enter End is Greater than Start');
    setConfirmRow(true);
  }

  async function addRow() {
    setConfirmRow(false);
    if (!hall) return;
    setBusy(true);
    try {
      const h = await post<Hall>(`/eligible/halls/${hall._id}/rows`, { row: Number(row), startSeat: startN, endSeat: endN });
      setHall(h);
      const skipped = h.skipped?.length ? ` Skipped seat no. already in this hall: ${h.skipped.join(', ')}.` : '';
      setNotice(`Added successfully: ${h.added} seat(s) in row ${row}.${skipped}`);
      setRow(String(Number(row) + 1));
      setStart('');
      setEnd('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(seat: Seat) {
    if (!hall) return;
    try {
      setHall(await patch<Hall>(`/eligible/halls/${hall._id}/seats/${seat.seatNo}`, { active: !seat.active }));
      setNotice(`Seat ${seat.seatNo}: status successfully changed.`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeSeat(seat: Seat) {
    if (!hall) return;
    try {
      setHall(await del<Hall>(`/eligible/halls/${hall._id}/seats/${seat.seatNo}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeHall() {
    setConfirmDelete(false);
    if (!hall) return;
    try {
      await del(`/eligible/halls/${hall._id}`);
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card venue-card" role="dialog" aria-modal="true">
        <button type="button" className="venue-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2>{hall ? hall.name : 'Add Hall'}</h2>
        <ErrorBox error={error} />
        {notice ? <div className="practical-notice">{notice}</div> : null}
        <div className="practical-inline hall-name-row">
          <Field label="Hall Name" required>
            <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && process()} />
          </Field>
          <button type="button" className="btn" disabled={busy} onClick={process}>
            {hall ? 'Save name' : 'Process'}
          </button>
          {!hall ? (
            <button type="button" className="btn secondary" onClick={() => setName('')}>
              Reset
            </button>
          ) : (
            <button type="button" className="btn small danger" onClick={() => setConfirmDelete(true)}>
              Delete hall
            </button>
          )}
        </div>
        {hall ? (
          <>
            <h4 className="practical-subhead">Add a row of seats</h4>
            <div className="grid cols-4">
              <Field label="Row No" required>
                <input className="input" inputMode="numeric" value={row} onChange={(e) => setRow(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="Start Seat No" required>
                <input className="input" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="End Seat No" required>
                <input className="input" inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="Total Seat">
                <input className="input" value={total || ''} readOnly tabIndex={-1} />
              </Field>
            </div>
            <div className="practical-actions-right">
              <button type="button" className="btn" disabled={busy} onClick={checkRow}>
                Submit
              </button>
            </div>
            <h4 className="practical-subhead">
              Seat Structure of Hall · {hall.totalSeats} seat(s), {hall.activeSeats} active
            </h4>
            {hall.seats.length ? (
              <div className="table-scroll hall-seats">
                <table className="table practical-table practical-nopin">
                  <thead>
                    <tr>
                      <th>Sr.No.</th>
                      <th>Hall Name</th>
                      <th>Row Number</th>
                      <th>Seat No</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hall.seats.map((s, i) => (
                      <tr key={s.seatNo}>
                        <td>{i + 1}</td>
                        <td>{hall.name}</td>
                        <td>{s.row}</td>
                        <td>{s.seatNo}</td>
                        <td>
                          <div className="row">
                            <button
                              type="button"
                              className={`btn small ${s.active ? 'seat-on' : 'seat-off'}`}
                              aria-pressed={s.active}
                              title="Switch this seat on or off"
                              onClick={() => toggle(s)}
                            >
                              {s.active ? 'Active' : 'Deactive'}
                            </button>
                            <button type="button" className="btn small secondary" onClick={() => removeSeat(s)}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="practical-empty">No seats yet. Add a row above.</p>
            )}
          </>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {confirmRow ? (
        <ConfirmDialog
          title="Are you sure?"
          message={`You want to Save this: row ${row}, seats ${startN} to ${endN} (${total} seat(s)).`}
          onYes={addRow}
          onNo={() => setConfirmRow(false)}
        />
      ) : null}
      {confirmDelete && hall ? (
        <ConfirmDialog
          title="Delete hall"
          message={`Delete ${hall.name} and its ${hall.totalSeats} seat(s)?`}
          onYes={removeHall}
          onNo={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

export function HallMasterPage() {
  const [halls, setHalls] = useState<HallSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string | null } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setHalls(await get<HallSummary[]>('/eligible/halls'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const exportRows = halls.map((h, i) => ({ sr: i + 1, ...h }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Hall Master</h1>
          <p>Exam halls and their seats, shared by the whole institute.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Halls <span className="practical-count">{halls.length}</span>
          </h3>
          <button type="button" className="btn small" onClick={() => setOpen({ id: null })}>
            Add Hall
          </button>
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={LIST_COLUMNS} rows={exportRows} filename="hall-master" title="Hall Master" />
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : halls.length ? (
          <div className="table-scroll">
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  {LIST_COLUMNS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {halls.map((h, i) => (
                  <tr key={h._id}>
                    <td>{i + 1}</td>
                    <td>{h.name}</td>
                    <td>{h.totalSeats}</td>
                    <td>{h.activeSeats}</td>
                    <td>
                      <button type="button" className="btn small secondary" onClick={() => setOpen({ id: h._id })}>
                        Show
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">No halls yet. Use Add Hall.</p>
        )}
      </div>
      {open ? (
        <HallDialog
          hallId={open.id}
          onClose={() => {
            setOpen(null);
            load();
          }}
        />
      ) : null}
    </Shell>
  );
}
