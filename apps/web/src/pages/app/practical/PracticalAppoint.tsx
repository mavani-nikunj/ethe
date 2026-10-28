import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, get, patch, post, api } from '../../../api';
import { useAuth } from '../../../auth';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, Field, Pill } from '../../../components/ui';
import { MONTHS } from '../../../dept';
import { ListInput, PracticalRow, usePracticalMeta } from './common';

type Schedule = {
  _id?: string;
  department: string;
  subjectCode: string;
  totalStudents: string;
  totalMarks: string;
  tentativeSchedule: string;
  examTypeId: string;
};
const emptySchedule = (): Schedule => ({
  department: '',
  subjectCode: '',
  totalStudents: '',
  totalMarks: '',
  tentativeSchedule: '',
  examTypeId: '',
});

type ExaminerForm = {
  type: string;
  pick: string;
  facultyId: string;
  name: string;
  designation: string;
  department: string;
  instituteName: string;
  instituteAddress: string;
  city: string;
  mobile: string;
  email: string;
  alternateMobile: string;
  alternateEmail: string;
};

type Suggestion = {
  key: string;
  facultyId?: string;
  name: string;
  designation?: string;
  department?: string;
  instituteName?: string;
  instituteAddress?: string;
  city?: string;
  mobile?: string;
  email?: string;
  alternateMobile?: string;
  alternateEmail?: string;
};

const OTHER = '__other__';

function str(v: unknown) {
  return v === undefined || v === null ? '' : String(v);
}

export function PracticalAppointPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const { meta, setMeta, error: metaError } = usePracticalMeta();
  const homeInstitute = user?.institute?.name || '';
  const emptyExaminer = (): ExaminerForm => ({
    type: '',
    pick: '',
    facultyId: '',
    name: '',
    designation: '',
    department: '',
    instituteName: homeInstitute,
    instituteAddress: '',
    city: '',
    mobile: '',
    email: '',
    alternateMobile: '',
    alternateEmail: '',
  });

  const [month, setMonth] = useState('');
  const [otherMonth, setOtherMonth] = useState('');
  const [year, setYear] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [courseId, setCourseId] = useState(params.get('CId') || '');
  const [specialityId, setSpecialityId] = useState(params.get('SId') || '');
  const [schedule, setSchedule] = useState<Schedule>(emptySchedule());
  const [lookups, setLookups] = useState<Record<string, string[]>>({ DESIGNATION: [], DEPARTMENT: [], SCHEDULE: [] });
  const [examiner, setExaminer] = useState<ExaminerForm>(emptyExaminer());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [board, setBoard] = useState<PracticalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ kind: string; title: string } | null>(null);
  const [addValue, setAddValue] = useState('');
  const [deleting, setDeleting] = useState<PracticalRow | null>(null);

  const canEdit = !!meta?.can.edit;
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const set = new Set<number>([now - 1, now, now + 1, ...(meta?.sessions || []).map((s) => s.year)]);
    return [...set].sort((a, b) => b - a);
  }, [meta]);
  const specs = useMemo(
    () => (meta?.specialities || []).filter((s) => !courseId || String(s.courseId) === courseId),
    [meta, courseId],
  );

  // Default to the active academic session.
  useEffect(() => {
    if (!meta || month) return;
    const cur = meta.sessions.find((s) => s._id === meta.currentSessionId) || meta.sessions[0];
    if (cur) {
      setMonth(MONTHS.includes(cur.month as any) ? cur.month : 'Other');
      if (!MONTHS.includes(cur.month as any)) setOtherMonth(cur.month);
      setYear(String(cur.year));
      setSessionId(cur._id);
    }
  }, [meta]);

  useEffect(() => {
    get('/practical/lookups').then(setLookups).catch(() => undefined);
  }, []);

  // Resolve the session for the chosen month/year (find or create, like the old "Other" month).
  useEffect(() => {
    const m = month === 'Other' ? otherMonth.trim() : month;
    if (!meta || !m || !year) return;
    const found = meta.sessions.find((s) => s.month === m && String(s.year) === year);
    if (found) {
      setSessionId(found._id);
      return;
    }
    if (!canEdit || month === 'Other') {
      setSessionId('');
      return;
    }
    post('/practical/sessions', { month: m, year })
      .then((row: any) => {
        setSessionId(row._id);
        setMeta((mm) => (mm ? { ...mm, sessions: [...mm.sessions, { _id: row._id, month: row.month, year: row.year, current: false }] } : mm));
      })
      .catch((err) => setError(err.message));
  }, [month, year, meta?.sessions.length]);

  async function loadBoard(sid = sessionId, spec = specialityId) {
    if (!sid || !spec) {
      setBoard([]);
      return;
    }
    try {
      setBoard(await get<PracticalRow[]>(`/practical/examiners?view=assigned&sessionId=${sid}&specialityId=${spec}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Load the speciality schedule + current board whenever session / speciality changes.
  useEffect(() => {
    setSchedule(emptySchedule());
    if (!sessionId || !specialityId) {
      setBoard([]);
      return;
    }
    get(`/practical/schedule?sessionId=${sessionId}&specialityId=${specialityId}`)
      .then((row: any) => {
        if (row) {
          setSchedule({
            _id: row._id,
            department: str(row.department),
            subjectCode: str(row.subjectCode),
            totalStudents: str(row.totalStudents),
            totalMarks: str(row.totalMarks),
            tentativeSchedule: str(row.tentativeSchedule),
            examTypeId: str(row.examTypeId),
          });
        }
      })
      .catch((err) => setError(err.message));
    loadBoard(sessionId, specialityId);
  }, [sessionId, specialityId]);

  // Name picker list depends on examiner type (externals come from past externals + pool).
  useEffect(() => {
    if (!examiner.type) {
      setSuggestions([]);
      return;
    }
    get<Suggestion[]>(`/practical/suggestions?type=${examiner.type}`)
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, [examiner.type]);

  const setS = (k: keyof Schedule, v: string) => setSchedule((s) => ({ ...s, [k]: v }));
  const setE = (k: keyof ExaminerForm, v: string) => setExaminer((e) => ({ ...e, [k]: v }));

  async function saveSchedule(): Promise<string | null> {
    setError(null);
    if (!sessionId) {
      setError('Select a valid Exam Month and Exam Year');
      return null;
    }
    if (!courseId || !specialityId) {
      setError('Select Course and Speciality');
      return null;
    }
    const row = await api<any>('/practical/schedule', {
      method: 'PUT',
      body: JSON.stringify({ sessionId, courseId, specialityId, ...schedule }),
    });
    setSchedule((s) => ({ ...s, _id: row._id }));
    return row._id;
  }

  async function onUpdateSchedule() {
    setBusy(true);
    try {
      if (await saveSchedule()) setNotice('Speciality details saved.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateSpeciality() {
    const current = specs.find((s) => s._id === specialityId);
    if (!current) {
      setError('Select the speciality to rename');
      return;
    }
    setAddValue(current.name);
    setAdding({ kind: 'RENAME_SPECIALITY', title: 'Update Speciality' });
  }

  function pickName(key: string) {
    if (key === OTHER) {
      setExaminer((e) => ({ ...e, pick: OTHER, facultyId: '', name: '' }));
      return;
    }
    const s = suggestions.find((x) => x.key === key);
    if (!s) {
      setExaminer((e) => ({ ...e, pick: '', facultyId: '', name: '' }));
      return;
    }
    setExaminer((e) => ({
      ...e,
      pick: key,
      facultyId: s.facultyId || '',
      name: s.name || '',
      designation: s.designation || e.designation,
      department: s.department || e.department,
      instituteName: s.instituteName || (e.type === 'EXTERNAL' ? '' : homeInstitute),
      instituteAddress: s.instituteAddress || e.instituteAddress,
      city: s.city || '',
      mobile: s.mobile || '',
      email: s.email || '',
      alternateMobile: s.alternateMobile || '',
      alternateEmail: s.alternateEmail || '',
    }));
  }

  function onTypeChange(type: string) {
    setExaminer({ ...emptyExaminer(), type, instituteName: type === 'EXTERNAL' ? '' : homeInstitute });
  }

  async function submitExaminer(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!examiner.type) return setError('Select an Examiner Type');
    if (!examiner.name.trim()) return setError('Select or enter the Name of Examiner');
    setBusy(true);
    try {
      if (editingId) {
        await patch(`/practical/examiners/${editingId}`, examiner);
        setNotice('Examiner updated.');
      } else {
        const scheduleId = schedule._id || (await saveSchedule());
        if (!scheduleId) return;
        await post('/practical/examiners', { ...examiner, scheduleId });
        setNotice('Examiner added. Send the board to the Assoc. Dean from "Assigned Examiner Send to Assoc. Dean".');
      }
      setExaminer(emptyExaminer());
      setEditingId(null);
      await loadBoard();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: PracticalRow) {
    setEditingId(r._id);
    setExaminer({
      type: r.type,
      pick: OTHER,
      facultyId: '',
      name: r.name,
      designation: r.designation || '',
      department: r.department || '',
      instituteName: r.instituteName || '',
      instituteAddress: r.instituteAddress || '',
      city: r.city || '',
      mobile: r.mobile,
      email: r.email,
      alternateMobile: r.alternateMobile || '',
      alternateEmail: r.alternateEmail || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function confirmDelete() {
    const r = deleting;
    setDeleting(null);
    if (!r) return;
    try {
      await del(`/practical/examiners/${r._id}`);
      await loadBoard();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveAdd() {
    const value = addValue.trim();
    if (!adding || !value) return;
    try {
      if (adding.kind === 'SPECIALITY') {
        if (!courseId) throw new Error('Select the course first');
        const row: any = await post('/practical/specialities', { courseId, name: value });
        setMeta((m) => (m ? { ...m, specialities: [...m.specialities, row] } : m));
        setSpecialityId(row._id);
      } else if (adding.kind === 'RENAME_SPECIALITY') {
        const row: any = await patch(`/practical/specialities/${specialityId}`, { name: value });
        setMeta((m) => (m ? { ...m, specialities: m.specialities.map((s) => (s._id === row._id ? row : s)) } : m));
        setNotice('Speciality updated.');
      } else if (adding.kind === 'EXAM_TYPE') {
        const row: any = await post('/masters/exam-types', { name: value });
        setMeta((m) => (m ? { ...m, examTypes: [...m.examTypes, row] } : m));
        setS('examTypeId', row._id);
      } else {
        await post('/practical/lookups', { kind: adding.kind, name: value });
        setLookups((l) => ({ ...l, [adding.kind]: [...new Set([...(l[adding.kind] || []), value])].sort() }));
        if (adding.kind === 'SCHEDULE') setS('tentativeSchedule', value);
        if (adding.kind === 'DESIGNATION') setE('designation', value);
        if (adding.kind === 'DEPARTMENT') {
          if (adding.title.includes('Examiner')) setE('department', value);
          else setS('department', value);
        }
      }
      setAdding(null);
      setAddValue('');
    } catch (err: any) {
      setError(err.message);
      setAdding(null);
    }
  }

  const plus = (kind: string, title: string) =>
    canEdit ? (
      <button
        type="button"
        className="practical-plus"
        title={title}
        aria-label={title}
        onClick={() => {
          setAddValue('');
          setAdding({ kind, title });
        }}
      >
        +
      </button>
    ) : null;

  const isExternal = examiner.type === 'EXTERNAL';

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Appointment of Examiner</h1>
          <p>Enter the speciality details once per session, then add the Chairperson, Internal, Observer, External examiners and Exam Coordinator.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {notice ? <div className="practical-notice">{notice}</div> : null}
      {!meta ? (
        <p className="practical-empty">Loading…</p>
      ) : (
        <>
          <div className="card">
            <div className="grid cols-4">
              <Field label="Exam Month">
                <select className="input" value={month} disabled={!canEdit} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">-- Select Month --</option>
                  {MONTHS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </Field>
              {month === 'Other' ? (
                <Field label="Other Month">
                  <div className="practical-inline">
                    <input className="input" value={otherMonth} onChange={(e) => setOtherMonth(e.target.value)} placeholder="e.g. Supplementary-1" />
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        post('/practical/sessions', { month: otherMonth, year })
                          .then((row: any) => {
                            setMeta((mm) =>
                              mm ? { ...mm, sessions: [...mm.sessions, { _id: row._id, month: row.month, year: row.year, current: false }] } : mm,
                            );
                            setSessionId(row._id);
                          })
                          .catch((err) => setError(err.message))
                      }
                    >
                      Submit
                    </button>
                  </div>
                </Field>
              ) : null}
              <Field label="Exam Year">
                <select className="input" value={year} disabled={!canEdit} onChange={(e) => setYear(e.target.value)}>
                  <option value="">-- Select Year --</option>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <Field label="Course" required>
                <select
                  className="input"
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setSpecialityId('');
                  }}
                >
                  <option value="">-- All Course --</option>
                  {meta.courses.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Speciality" required extra={plus('SPECIALITY', 'Add Speciality')}>
                <select className="input" value={specialityId} onChange={(e) => setSpecialityId(e.target.value)}>
                  <option value="">-- All Speciality --</option>
                  {specs.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department" required extra={plus('DEPARTMENT', 'Add Department')}>
                <ListInput value={schedule.department} options={lookups.DEPARTMENT} onChange={(v) => setS('department', v)} />
              </Field>
              <Field label="Tentative Practical Schedule" required extra={plus('SCHEDULE', 'Add Tentative Practical Schedule')}>
                <ListInput value={schedule.tentativeSchedule} options={lookups.SCHEDULE} onChange={(v) => setS('tentativeSchedule', v)} />
              </Field>
              <Field label="Subject Code" required>
                <input className="input" value={schedule.subjectCode} onChange={(e) => setS('subjectCode', e.target.value)} />
              </Field>
              <Field label="Exam Name" extra={plus('EXAM_TYPE', 'Add Exam Name')}>
                <select className="input" value={schedule.examTypeId} onChange={(e) => setS('examTypeId', e.target.value)}>
                  <option value="">-- All Exam type--</option>
                  {meta.examTypes.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Total Student" required>
                <input className="input" inputMode="numeric" value={schedule.totalStudents} onChange={(e) => setS('totalStudents', e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="Total Marks">
                <input className="input" inputMode="numeric" value={schedule.totalMarks} onChange={(e) => setS('totalMarks', e.target.value.replace(/\D/g, ''))} />
              </Field>
            </div>
            {canEdit ? (
              <div className="practical-actions-right">
                <button type="button" className="btn secondary" disabled={busy || !specialityId} onClick={onUpdateSpeciality}>
                  Update Speciality
                </button>
                <button type="button" className="btn" disabled={busy || !specialityId} onClick={onUpdateSchedule}>
                  Update
                </button>
              </div>
            ) : null}
          </div>

          {canEdit ? (
            <form className="card practical-appoint-form" onSubmit={submitExaminer}>
              <div className="practical-form-tag">{editingId ? 'Edit Examiner' : 'Appointment Form'}</div>
              <div className="grid cols-2">
                <Field label="Examiner Type" required>
                  <select className="input" value={examiner.type} disabled={!!editingId} onChange={(e) => onTypeChange(e.target.value)}>
                    <option value="">-- Select Examiner --</option>
                    {meta.types.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Institute Address" required>
                  <input className="input" value={examiner.instituteAddress} onChange={(e) => setE('instituteAddress', e.target.value)} />
                </Field>
                <Field label="Name of Examiner" required>
                  {editingId ? (
                    <input className="input" value={examiner.name} onChange={(e) => setE('name', e.target.value)} />
                  ) : (
                    <>
                      <select className="input" value={examiner.pick} disabled={!examiner.type} onChange={(e) => pickName(e.target.value)}>
                        <option value="">{isExternal ? '-- Select External Examiner --' : '-- Select Chief Guide --'}</option>
                        <option value={OTHER}>Other (type the name)</option>
                        {suggestions.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.name}
                            {s.city ? ` — ${s.city}` : ''}
                            {s.email ? ` (${s.email})` : ''}
                          </option>
                        ))}
                      </select>
                      {examiner.pick === OTHER ? (
                        <input
                          className="input"
                          style={{ marginTop: 6 }}
                          placeholder="Enter examiner name"
                          value={examiner.name}
                          onChange={(e) => setE('name', e.target.value)}
                        />
                      ) : null}
                    </>
                  )}
                </Field>
                <Field label="Mobile No." required>
                  <input className="input" maxLength={10} inputMode="numeric" value={examiner.mobile} onChange={(e) => setE('mobile', e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Field label="Designation" required extra={plus('DESIGNATION', 'Add Designation')}>
                  <ListInput value={examiner.designation} options={lookups.DESIGNATION} onChange={(v) => setE('designation', v)} placeholder="-- Select Designation --" />
                </Field>
                <Field label="Email ID" required>
                  <input className="input" type="email" value={examiner.email} onChange={(e) => setE('email', e.target.value)} />
                </Field>
                <Field label="Department" required extra={plus('DEPARTMENT', 'Add Examiner Department')}>
                  <ListInput value={examiner.department} options={lookups.DEPARTMENT} onChange={(v) => setE('department', v)} placeholder="-- Select Department --" />
                </Field>
                <Field label="Alternate Mobile">
                  <input className="input" maxLength={10} inputMode="numeric" value={examiner.alternateMobile} onChange={(e) => setE('alternateMobile', e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Field label="Institute Name" required>
                  <input className="input" value={examiner.instituteName} onChange={(e) => setE('instituteName', e.target.value)} />
                </Field>
                <Field label="Alternate Email Id">
                  <input className="input" type="email" value={examiner.alternateEmail} onChange={(e) => setE('alternateEmail', e.target.value)} />
                </Field>
                {isExternal ? (
                  <Field label="City Name" required>
                    <input className="input" value={examiner.city} onChange={(e) => setE('city', e.target.value)} />
                  </Field>
                ) : null}
              </div>
              <div className="practical-actions-right">
                {editingId ? (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setEditingId(null);
                      setExaminer(emptyExaminer());
                    }}
                  >
                    Cancel edit
                  </button>
                ) : (
                  <button type="button" className="btn secondary" onClick={() => setExaminer(emptyExaminer())}>
                    Reset
                  </button>
                )}
                <button type="submit" className="btn" disabled={busy || !specialityId}>
                  {editingId ? 'Update' : 'Submit'}
                </button>
              </div>
              {!specialityId ? <p className="practical-muted">Select the Course and Speciality above first.</p> : null}
            </form>
          ) : null}

          <div className="card" style={{ marginTop: 14 }}>
            <h3 className="practical-subhead">Detail of Examiner</h3>
            {board.length ? (
              <div className="table-scroll">
                <table className={`table${canEdit ? '' : ' practical-nopin'}`}>
                  <thead>
                    <tr>
                      <th>Sr.No.</th>
                      <th>ExaminerType</th>
                      <th>Name</th>
                      <th>Designation</th>
                      <th>Department</th>
                      <th>InstituteName</th>
                      <th>City</th>
                      <th>MobileNo</th>
                      <th>Email</th>
                      <th>Status</th>
                      {canEdit ? <th>Action</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {board.map((r, i) => (
                      <tr key={r._id}>
                        <td>{i + 1}</td>
                        <td>{r.typeLabel}</td>
                        <td>{r.name}</td>
                        <td>{r.designation}</td>
                        <td>{r.department}</td>
                        <td>{r.instituteName}</td>
                        <td>{r.city}</td>
                        <td>{r.mobile}</td>
                        <td>{r.email}</td>
                        <td>
                          <span title={r.statusLabel}>
                            <Pill status={r.statusLabel} />
                          </span>
                        </td>
                        {canEdit ? (
                          <td>
                            <div className="row">
                              <button type="button" className="btn small secondary" onClick={() => startEdit(r)}>
                                Edit
                              </button>
                              {['PENDING', 'DEAN_REJECTED', 'REGRETTED'].includes(r.status) ? (
                                <button type="button" className="btn small danger" onClick={() => setDeleting(r)}>
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="practical-empty">{specialityId ? 'No examiners added for this speciality yet.' : 'Select a course and speciality to see its board.'}</p>
            )}
          </div>
        </>
      )}

      {adding ? (
        <div className="modal-overlay dialog-overlay" role="presentation">
          <div className="modal-card dialog-card" role="dialog" aria-modal="true">
            <h2>{adding.title}</h2>
            <Field label="Name" required>
              <input className="input" value={addValue} autoFocus onChange={(e) => setAddValue(e.target.value)} />
            </Field>
            <div className="dialog-actions">
              <button type="button" className="btn" disabled={!addValue.trim()} onClick={saveAdd}>
                Save
              </button>
              <button type="button" className="btn secondary" onClick={() => setAdding(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete Examiner"
          message={`Delete ${deleting.name} (${deleting.typeLabel})?`}
          yesLabel="Delete"
          noLabel="Cancel"
          onYes={confirmDelete}
          onNo={() => setDeleting(null)}
        />
      ) : null}
    </Shell>
  );
}
