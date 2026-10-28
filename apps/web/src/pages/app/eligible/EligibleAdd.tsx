import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../../components/Shell';
import { ErrorBox, Field } from '../../../components/ui';
import { get, patch, post } from '../../../api';
import { QuickAddDialog, sessionLabel, useEligibleMeta, type CandidateRow, type Named } from './common';

type Form = {
  sessionId: string;
  courseId: string;
  specialityId: string;
  departmentId: string;
  enrollmentNo: string;
  name: string;
  dob: string;
  mobile: string;
  email: string;
};

const EMPTY: Form = {
  sessionId: '',
  courseId: '',
  specialityId: '',
  departmentId: '',
  enrollmentNo: '',
  name: '',
  dob: '',
  mobile: '',
  email: '',
};

export function EligibleAddPage() {
  const [params] = useSearchParams();
  const editId = params.get('id') || '';
  const navigate = useNavigate();
  const { meta, setMeta, error: metaError } = useEligibleMeta();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<'speciality' | 'department' | null>(null);
  const [loaded, setLoaded] = useState<CandidateRow | null>(null);

  useEffect(() => {
    if (meta && !form.sessionId && !editId) setForm((f) => ({ ...f, sessionId: meta.currentSessionId || meta.sessions[0]?._id || '' }));
  }, [meta]);

  useEffect(() => {
    if (!editId) {
      setLoaded(null);
      setForm((f) => ({ ...EMPTY, sessionId: f.sessionId }));
      return;
    }
    get<CandidateRow>(`/eligible/candidates/${editId}`)
      .then((r) => {
        setLoaded(r);
        setForm({
          sessionId: String(r.sessionId),
          courseId: String(r.courseId),
          specialityId: String(r.specialityId),
          departmentId: r.departmentId ? String(r.departmentId) : '',
          enrollmentNo: r.enrollmentNo,
          name: r.name,
          dob: r.dob,
          mobile: r.mobile,
          email: r.email,
        });
      })
      .catch((err) => setError(err.message));
  }, [editId]);

  const specs = useMemo(
    () => (meta?.specialities || []).filter((s) => form.courseId && String(s.courseId) === form.courseId),
    [meta, form.courseId],
  );

  if (meta && !meta.can.edit) return <Navigate to="/app/eligible/eligible" replace />;

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function pickCourse(courseId: string) {
    const course = meta?.courses.find((c) => c._id === courseId);
    setForm((f) => ({
      ...f,
      courseId,
      specialityId: '',
      // Old screen fell back to the course's department when none was chosen.
      departmentId: f.departmentId || (course?.departmentId ? String(course.departmentId) : ''),
    }));
    setErrors((e) => ({ ...e, courseId: undefined, specialityId: undefined }));
  }

  function validate() {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!form.courseId) e.courseId = 'Required';
    if (!form.specialityId) e.specialityId = 'Required';
    if (!form.departmentId) e.departmentId = 'Required';
    if (!form.enrollmentNo.trim()) e.enrollmentNo = 'Required';
    if (form.name.trim().length < 3) e.name = 'At least 3 characters';
    if (!form.dob) e.dob = 'Required';
    if (!/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, ''))) e.mobile = '10-digit mobile number';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Valid email required';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit() {
    setError(null);
    setNotice(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (editId) {
        await patch(`/eligible/candidates/${editId}`, form);
        navigate(loaded && !loaded.eligible ? '/app/eligible/not-eligible' : '/app/eligible/eligible');
        return;
      }
      await post('/eligible/candidates', form);
      setNotice(`Added successfully. ${form.name} is in the List of Eligible Candidate.`);
      setForm((f) => ({ ...EMPTY, sessionId: f.sessionId, courseId: f.courseId, departmentId: f.departmentId }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setErrors({});
    setError(null);
    setNotice(null);
    if (editId) navigate(-1);
    else setForm((f) => ({ ...EMPTY, sessionId: f.sessionId }));
  }

  async function addSpeciality(name: string) {
    const row = await post<Named & { courseId: string }>('/eligible/specialities', { courseId: form.courseId, name });
    setMeta((m) => (m ? { ...m, specialities: [...m.specialities, row].sort((a, b) => a.name.localeCompare(b.name)) } : m));
    set('specialityId', row._id);
    setQuick(null);
  }

  async function addDepartment(name: string) {
    const row = await post<Named>('/eligible/departments', { name });
    setMeta((m) => (m ? { ...m, departments: [...m.departments, row].sort((a, b) => a.name.localeCompare(b.name)) } : m));
    set('departmentId', row._id);
    setQuick(null);
  }

  const plus = (onClick: () => void, title: string, disabled?: boolean) => (
    <button type="button" className="practical-plus" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      +
    </button>
  );

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Add Last year Candidate Details</h1>
          <p>{editId ? 'Edit Old Candidate' : 'Add Old Candidate'}</p>
        </div>
        <Link className="btn secondary" to="/app/eligible/eligible">
          List of Eligible Candidate
        </Link>
      </div>
      <ErrorBox error={metaError || error} />
      {notice ? <div className="practical-notice">{notice}</div> : null}
      {meta ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Please fill form</h3>
          <h4 className="practical-subhead">Course</h4>
          <div className="grid cols-2">
            <Field label="Name of Course" required error={errors.courseId}>
              <select className="input" value={form.courseId} disabled={!!editId && !loaded} onChange={(e) => pickCourse(e.target.value)}>
                <option value="">-- Select Course --</option>
                {meta.courses.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Name of Speciality"
              required
              error={errors.specialityId}
              extra={plus(() => setQuick('speciality'), form.courseId ? 'Add Speciality' : 'Select a course first', !form.courseId)}
            >
              <select className="input" value={form.specialityId} onChange={(e) => set('specialityId', e.target.value)}>
                <option value="">{form.courseId ? '-- Select Speciality --' : '-- Select Course first --'}</option>
                {specs.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name of Department" required error={errors.departmentId} extra={plus(() => setQuick('department'), 'Add Department')}>
              <select className="input" value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                <option value="">-- Select Department --</option>
                {meta.departments.map((d) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Session" required>
              <select className="input" value={form.sessionId} disabled={!!editId} onChange={(e) => set('sessionId', e.target.value)}>
                {meta.sessions.map((s) => (
                  <option key={s._id} value={s._id}>
                    {sessionLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <h4 className="practical-subhead">Candidate</h4>
          <div className="grid cols-2">
            <Field label="Enrollment No." required error={errors.enrollmentNo}>
              <input
                className="input"
                value={form.enrollmentNo}
                onChange={(e) => set('enrollmentNo', e.target.value)}
                placeholder="Enter Enrollment No."
                maxLength={50}
              />
            </Field>
            <Field label="Name of Candidate" required error={errors.name}>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Enter Name of Candidate"
                maxLength={200}
              />
            </Field>
            <Field label="DOB of Candidate" required error={errors.dob}>
              <input
                className="input"
                type="date"
                value={form.dob}
                max={new Date().toISOString().slice(0, 10)}
                min="1920-01-01"
                onChange={(e) => set('dob', e.target.value)}
              />
            </Field>
            <Field label="Mobile No. of Candidate" required error={errors.mobile}>
              <input
                className="input"
                inputMode="numeric"
                value={form.mobile}
                onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="Enter Mobile No. of Candidate"
                maxLength={10}
              />
            </Field>
            <Field label="Email Id of Candidate" required error={errors.email}>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="Enter Email Id of Candidate"
                maxLength={100}
              />
            </Field>
          </div>
          <div className="practical-actions-right">
            <button type="button" className="btn" disabled={busy} onClick={submit}>
              {editId ? 'Update' : 'Add'}
            </button>
            <button type="button" className="btn secondary" onClick={reset}>
              {editId ? 'Cancel' : 'Reset'}
            </button>
          </div>
        </div>
      ) : null}
      {quick === 'speciality' ? (
        <QuickAddDialog title="Add Speciality" label="Speciality Name" onSave={addSpeciality} onClose={() => setQuick(null)} />
      ) : null}
      {quick === 'department' ? (
        <QuickAddDialog title="Add Department" label="Department Name" onSave={addDepartment} onClose={() => setQuick(null)} />
      ) : null}
    </Shell>
  );
}
