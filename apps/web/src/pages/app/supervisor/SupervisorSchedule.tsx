import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field, ResultDialog } from '../../../components/ui';
import { del, get, patch, post } from '../../../api';
import { dmy, sessionText, useSupervisorMeta, type ScheduleRow } from './common';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return iso ? DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '' : '';
}

type Form = { _id?: string; examName: string; examDate: string; shift: string; studentCount: string };
const EMPTY: Form = { examName: '', examDate: '', shift: '', studentCount: '' };
type Prefill = { papers: { course: string; speciality: string; paper: string; candidates: number }[]; examName: string; studentCount: number };

/** Old "Add Schedule": sittings of the active supervisor session (date, day, shift, exam, students, time). */
export function SupervisorSchedulePage() {
  const { meta, error: metaError } = useSupervisorMeta();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<string> } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const active = meta?.sessions.find((s) => s._id === meta.activeSessionId) || null;

  async function load() {
    if (!active) return;
    try {
      setRows(await get<ScheduleRow[]>(`/supervisor/schedule?sessionId=${active._id}`));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, [active?._id]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || `${dmy(r.examDate)} ${r.day} ${r.shift} ${r.examName}`.toLowerCase().includes(q));
  }, [rows, search]);

  const time = meta?.shifts.find((s) => s.name === form?.shift)?.time || '';

  function submit() {
    if (!form) return;
    setFormError(null);
    if (!form.examName.trim()) return setFormError('Please Enter Exam Name.');
    if (!form.examDate) return setFormError('Please enter Date.');
    if (!form.shift) return setFormError('Please Select Shift.');
    if (form.studentCount === '' || !/^\d+$/.test(form.studentCount)) return setFormError('Please Enter Number of Students.');
    const body = { ...form, studentCount: Number(form.studentCount), sessionId: active?._id };
    setConfirm({
      title: 'Are you sure?',
      message: form._id ? 'You want to Update.' : 'You want to Add.',
      run: async () => {
        if (form._id) {
          const r = await patch<{ affected: string[] }>(`/supervisor/schedule/${form._id}`, body);
          setForm(null);
          return r.affected?.length
            ? `Updated successfully. The duty of ${r.affected.join(', ')} moved to the new date / shift.`
            : 'Updated successfully.';
        }
        await post('/supervisor/schedule', body);
        setForm(null);
        return 'Added successfully.';
      },
    });
  }

  async function loadPrefill() {
    if (!form?.examDate || !form.shift) return setFormError('Select the Date and Shift first.');
    setFormError(null);
    try {
      const p = await get<Prefill>(`/supervisor/schedule/prefill?examDate=${form.examDate}&shift=${form.shift}`);
      setPrefill(p);
      if (!p.papers.length) setFormError('No paper is scheduled in Add Venue on this date and shift.');
    } catch (err: any) {
      setFormError(err.message);
    }
  }

  async function run() {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    try {
      setDone(await c.run());
      await load();
    } catch (err: any) {
      if (form) setFormError(err.message);
      else setError(err.message);
    }
  }

  const exportCols = [
    { key: 'sr', label: 'Sr.No.' },
    { key: 'date', label: 'Date' },
    { key: 'day', label: 'Day' },
    { key: 'shift', label: 'Shift' },
    { key: 'examName', label: 'Name of Examination' },
    { key: 'studentCount', label: 'Number of Students' },
    { key: 'time', label: 'Time' },
  ];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, date: dmy(r.examDate), day: r.day, shift: r.shift, examName: r.examName, studentCount: r.studentCount, time: r.time }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Add Schedule</h1>
          <p>{active ? `Supervisor Session : ${sessionText(active)}` : 'Supervisor Session'}</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta && !active ? <div className="error">No supervisor session is active. Set one on Supervisor Session first.</div> : null}
      <div className="card">
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Schedule <span className="practical-count">{shown.length}</span>
          </h3>
          {meta?.can.edit && active ? (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setForm({ ...EMPTY });
                setPrefill(null);
                setFormError(null);
              }}
            >
              Add Schedule
            </button>
          ) : null}
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="supervisor-schedule" title="Add Schedule" />
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
                  <th>Sr.No.</th>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Shift</th>
                  <th>Name of Examination</th>
                  <th>Number of Students</th>
                  <th>Time</th>
                  <th>Supervisors</th>
                  {meta?.can.edit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    <td>{i + 1}</td>
                    <td className="nowrap">{dmy(r.examDate)}</td>
                    <td>{r.day}</td>
                    <td>{r.shift}</td>
                    <td>{r.examName}</td>
                    <td>{r.studentCount}</td>
                    <td className="nowrap">{r.time}</td>
                    <td>{r.supervisors}</td>
                    {meta?.can.edit ? (
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="btn small secondary"
                            onClick={() => {
                              setForm({ _id: r._id, examName: r.examName, examDate: r.examDate, shift: r.shift, studentCount: String(r.studentCount) });
                              setPrefill(null);
                              setFormError(null);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() =>
                              setConfirm({
                                title: 'Are you sure?',
                                message: `You want to Delete the ${r.shift} sitting of ${dmy(r.examDate)}.`,
                                run: async () => {
                                  await del(`/supervisor/schedule/${r._id}`);
                                  return 'Deleted successfully.';
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
          <p className="practical-empty">{active ? 'No schedule added for this session yet.' : ''}</p>
        )}
      </div>

      {form && meta ? (
        <div className="modal-overlay dialog-overlay" role="presentation">
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <h2>{form._id ? 'Edit Schedule' : 'Add Schedule'}</h2>
            <ErrorBox error={formError} />
            <div className="grid cols-2">
              <Field label="Date" required>
                <input className="input" type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} />
              </Field>
              <Field label="Day" required>
                <input className="input" value={dayOf(form.examDate)} disabled />
              </Field>
              <Field label="Shift" required>
                <select className="input" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                  <option value="">--Select Shift--</option>
                  {meta.shifts.map((s) => (
                    <option key={s.name}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Time" required>
                <input className="input" value={time} disabled placeholder="Enter Exam Time" />
              </Field>
              <Field label="Name of Examination" required>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={500}
                  placeholder="Enter Name of Examination"
                  value={form.examName}
                  onChange={(e) => setForm({ ...form, examName: e.target.value })}
                />
              </Field>
              <Field label="Number of Students" required>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="Enter Number of Students"
                  value={form.studentCount}
                  onChange={(e) => setForm({ ...form, studentCount: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                />
              </Field>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn small secondary" onClick={loadPrefill}>
                Prefill from papers
              </button>
              <span className="practical-muted">Papers entered in Eligible Candidate → Add Venue for this date and shift.</span>
            </div>
            {prefill?.papers.length ? (
              <div className="table-scroll" style={{ marginTop: 8 }}>
                <table className="table practical-table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Speciality</th>
                      <th>Paper</th>
                      <th>Eligible candidates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prefill.papers.map((p, i) => (
                      <tr key={i}>
                        <td>{p.course}</td>
                        <td>{p.speciality}</td>
                        <td>{p.paper}</td>
                        <td>{p.candidates}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setForm({ ...form, examName: prefill.examName, studentCount: String(prefill.studentCount) })}
                >
                  Use these ({prefill.studentCount} students)
                </button>
              </div>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={submit}>
                Submit
              </button>
              <button type="button" className="btn secondary" onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirm ? <ConfirmDialog title={confirm.title} message={confirm.message} onYes={run} onNo={() => setConfirm(null)} /> : null}
      {done ? <ResultDialog ok message={done} onClose={() => setDone(null)} /> : null}
    </Shell>
  );
}
