import { useEffect, useMemo, useState } from 'react';
import { del, get, patch, post } from '../../../api';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { QuickAddDialog, dmy, type EligibleMeta, type Named } from './common';

export type PaperRow = {
  _id: string;
  courseId: string;
  specialityId: string;
  paper: string;
  examDate: string;
  shiftId: string;
  timeSlotId: string;
  venue: string;
  fees: number;
  courseName: string;
  specialityName: string;
  shiftName: string;
  timeName: string;
};

type Form = {
  courseId: string;
  specialityId: string;
  paper: string;
  shiftId: string;
  fees: string;
  examDate: string;
  timeSlotId: string;
  venue: string;
};

const blank = (courseId = '', specialityId = ''): Form => ({
  courseId,
  specialityId,
  paper: '',
  shiftId: '',
  fees: '',
  examDate: '',
  timeSlotId: '',
  venue: '',
});

/** Old venue table: Sr.No. · Course · Speciality · Paper · Shift · Date · Time · Venue · Fees (now in the right order). */
const COLUMNS = [
  { key: 'courseName', label: 'Course' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'paper', label: 'Paper' },
  { key: 'shiftName', label: 'Shift' },
  { key: 'date', label: 'Date' },
  { key: 'timeName', label: 'Time' },
  { key: 'venue', label: 'Venue' },
  { key: 'fees', label: 'Fees' },
];

/**
 * "Add Venue" modal from List of Eligible Candidate: the paper schedule of the session for each
 * speciality, with the session's venue table underneath. View-only roles see just the table.
 */
export function VenueDialog({
  meta,
  sessionId,
  courseId,
  specialityId,
  onClose,
}: {
  meta: EligibleMeta;
  sessionId: string;
  courseId?: string;
  specialityId?: string;
  onClose: (changed: boolean) => void;
}) {
  const canEdit = meta.can.edit;
  const [form, setForm] = useState<Form>(blank(courseId, specialityId));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [shifts, setShifts] = useState<Named[]>([]);
  const [slots, setSlots] = useState<Named[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<'shift' | 'time' | null>(null);
  const [deleting, setDeleting] = useState<PaperRow | null>(null);
  const [changed, setChanged] = useState(false);

  async function loadPapers() {
    try {
      setPapers(await get<PaperRow[]>(`/eligible/papers?sessionId=${encodeURIComponent(sessionId)}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadPapers();
    get<Named[]>('/eligible/shifts').then(setShifts).catch(() => setShifts([]));
    get<Named[]>('/eligible/time-slots').then(setSlots).catch(() => setSlots([]));
  }, [sessionId]);

  const specs = useMemo(
    () => meta.specialities.filter((s) => form.courseId && String(s.courseId) === form.courseId),
    [meta.specialities, form.courseId],
  );

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(p: PaperRow) {
    setEditingId(p._id);
    setNotice(null);
    setError(null);
    setForm({
      courseId: String(p.courseId),
      specialityId: String(p.specialityId),
      paper: p.paper,
      shiftId: String(p.shiftId),
      fees: String(p.fees),
      examDate: p.examDate,
      timeSlotId: String(p.timeSlotId),
      venue: p.venue,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(blank(form.courseId, form.specialityId));
  }

  async function submit() {
    setError(null);
    setNotice(null);
    const missing = [
      ['courseId', 'Course'],
      ['specialityId', 'Speciality'],
      ['paper', 'Paper'],
      ['shiftId', 'Shift'],
      ['fees', 'Fees'],
      ['examDate', 'Date'],
      ['timeSlotId', 'Time'],
      ['venue', 'Venue'],
    ].filter(([k]) => !String(form[k as keyof Form]).trim());
    if (missing.length) {
      setError(`Please fill: ${missing.map(([, l]) => l).join(', ')}`);
      return;
    }
    setBusy(true);
    try {
      const body = { ...form, sessionId, fees: Number(form.fees) };
      if (editingId) {
        await patch(`/eligible/papers/${editingId}`, body);
        setNotice('Updated successfully.');
        setEditingId(null);
      } else {
        await post('/eligible/papers', body);
        setNotice('Added successfully.');
      }
      setChanged(true);
      setForm(blank(form.courseId, form.specialityId));
      await loadPapers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const p = deleting;
    setDeleting(null);
    if (!p) return;
    try {
      await del(`/eligible/papers/${p._id}`);
      if (editingId === p._id) cancelEdit();
      setChanged(true);
      await loadPapers();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function addShift(name: string) {
    const row = await post<Named>('/eligible/shifts', { name });
    setShifts((s) => (s.some((x) => x._id === row._id) ? s : [...s, row]));
    set('shiftId', row._id);
    setQuick(null);
  }

  async function addTime(name: string) {
    const row = await post<Named>('/eligible/time-slots', { name });
    setSlots((s) => (s.some((x) => x._id === row._id) ? s : [...s, row]));
    set('timeSlotId', row._id);
    setQuick(null);
  }

  const plus = (onClick: () => void, title: string) => (
    <button type="button" className="practical-plus" title={title} aria-label={title} onClick={onClick}>
      +
    </button>
  );
  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...COLUMNS];
  const exportRows = papers.map((p, i) => ({ sr: i + 1, ...p, date: dmy(p.examDate) }));

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card venue-card" role="dialog" aria-modal="true">
        <button type="button" className="venue-close" aria-label="Close" onClick={() => onClose(changed)}>
          ×
        </button>
        <h2>{canEdit ? 'Add Venue' : 'Paper Schedule'}</h2>
        <ErrorBox error={error} />
        {notice ? <div className="practical-notice">{notice}</div> : null}
        {canEdit ? (
          <>
            <div className="grid cols-2">
              <Field label="Course" required>
                <select
                  className="input"
                  value={form.courseId}
                  onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value, specialityId: '' }))}
                >
                  <option value="">-- Select Course --</option>
                  {meta.courses.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Speciality" required>
                <select className="input" value={form.specialityId} onChange={(e) => set('specialityId', e.target.value)}>
                  <option value="">{form.courseId ? '-- Select Speciality --' : '-- Select Course first --'}</option>
                  {specs.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Paper" required>
                <input className="input" value={form.paper} maxLength={200} onChange={(e) => set('paper', e.target.value)} placeholder="e.g. Paper I" />
              </Field>
              <Field label="Shift" required extra={plus(() => setQuick('shift'), 'Add Shift')}>
                <select className="input" value={form.shiftId} onChange={(e) => set('shiftId', e.target.value)}>
                  <option value="">---Select Shift---</option>
                  {shifts.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fees" required>
                <input
                  className="input"
                  inputMode="numeric"
                  value={form.fees}
                  maxLength={7}
                  onChange={(e) => set('fees', e.target.value.replace(/\D/g, '').slice(0, 7))}
                />
              </Field>
              <Field label="Date" required>
                <input className="input" type="date" value={form.examDate} onChange={(e) => set('examDate', e.target.value)} />
              </Field>
              <Field label="Time" required extra={plus(() => setQuick('time'), 'Add Time')}>
                <select className="input" value={form.timeSlotId} onChange={(e) => set('timeSlotId', e.target.value)}>
                  <option value="">---Select Time Slot---</option>
                  {slots.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Venue" required>
                <input className="input" value={form.venue} maxLength={300} onChange={(e) => set('venue', e.target.value)} />
              </Field>
            </div>
            <div className="practical-actions-right">
              <button type="button" className="btn" disabled={busy} onClick={submit}>
                {editingId ? 'Update' : 'Submit'}
              </button>
              {editingId ? (
                <button type="button" className="btn secondary" onClick={cancelEdit}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        <div className="file-number-toolbar" style={{ marginTop: 14 }}>
          <ExportButtons columns={exportCols} rows={exportRows} filename="paper-schedule" title="Paper Schedule" />
        </div>
        {papers.length ? (
          <div className="table-scroll">
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  {canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {papers.map((p, i) => (
                  <tr key={p._id} className={editingId === p._id ? 'row-editing' : undefined}>
                    <td>{i + 1}</td>
                    <td>{p.courseName}</td>
                    <td>{p.specialityName}</td>
                    <td>{p.paper}</td>
                    <td>{p.shiftName}</td>
                    <td>{dmy(p.examDate)}</td>
                    <td>{p.timeName}</td>
                    <td>{p.venue}</td>
                    <td>{p.fees}</td>
                    {canEdit ? (
                      <td>
                        <div className="row">
                          <button type="button" className="btn small secondary" onClick={() => startEdit(p)}>
                            Edit
                          </button>
                          <button type="button" className="btn small danger" onClick={() => setDeleting(p)}>
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
          <p className="practical-empty">No papers are scheduled for this session yet.</p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={() => onClose(changed)}>
            Close
          </button>
        </div>
      </div>
      {quick === 'shift' ? (
        <QuickAddDialog title="Add Shift" label="Shift Name" maxLength={200} onSave={addShift} onClose={() => setQuick(null)} />
      ) : null}
      {quick === 'time' ? (
        <QuickAddDialog title="Add Time" label="Time Name" maxLength={100} onSave={addTime} onClose={() => setQuick(null)} />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete paper"
          message={`Delete ${deleting.paper} of ${deleting.specialityName} on ${dmy(deleting.examDate)}?`}
          onYes={remove}
          onNo={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
