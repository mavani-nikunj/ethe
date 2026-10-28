import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, patch, postWithProgress, type UploadProgress } from '../../api';
import { progressLabel, thesisFileProblem, uploadFailureMessage } from '../../upload';
import { formatBytes } from '../../imageShrink';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, ResultDialog } from '../../components/ui';
import { useAuth } from '../../auth';
import { MONTHS, formatDate, monthsFromSessions, validateCandidate, yearsFromSessions } from '../../dept';

const emptyForm = {
  sessionMonth: '',
  sessionYear: String(new Date().getFullYear()),
  sessionId: '',
  courseId: '',
  departmentId: '',
  specialityId: '',
  enrollmentNo: '',
  candidateName: '',
  dob: '',
  mobile: '',
  candidateEmail: '',
  title: '',
  chiefGuideId: '',
  coGuideIds: [] as string[],
};

function guideMatches(s: any, courseId?: string, departmentId?: string) {
  const courseIds = (s.courseIds || []).map((id: any) => String(id));
  if (courseId && courseIds.length) return courseIds.includes(String(courseId));
  if (departmentId && s.departmentId) return String(s.departmentId) === String(departmentId);
  return true;
}

export function ThesisForm({
  id,
  embedded,
  onSaved,
  onCancel,
}: {
  id?: string;
  embedded?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const editing = Boolean(id);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [hasPdf, setHasPdf] = useState(false);
  const [existingDoc, setExistingDoc] = useState<{
    path: string;
    originalName?: string;
    version?: number;
    uploadedAt?: string | Date;
    uploadedBy?: string;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [lookups, setLookups] = useState<any>({
    courseTypes: [],
    courses: [],
    departments: [],
    sessions: [],
    specialities: [],
    faculty: [],
  });
  const [form, setForm] = useState<any>({ ...emptyForm });
  const [pdf, setPdf] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [guideForm, setGuideForm] = useState({ name: '', email: '', designation: '', mobile: '' });
  const [maxCoGuides, setMaxCoGuides] = useState(0);
  const [minCoGuides, setMinCoGuides] = useState(0);
  const [plus, setPlus] = useState<'session' | 'course' | 'speciality' | null>(null);
  const [plusForm, setPlusForm] = useState<any>({});
  const [plusErr, setPlusErr] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const mappedCourses = lookups.courses || [];
  const selectedCourse = mappedCourses.find((c: any) => String(c._id) === String(form.courseId));
  const mappedDepts = useMemo(() => {
    const all = lookups.departments || [];
    if (selectedCourse?.departmentId) {
      return all.filter((d: any) => String(d._id) === String(selectedCourse.departmentId));
    }
    return all;
  }, [lookups.departments, selectedCourse?.departmentId]);

  const guides = useMemo(
    () => (lookups.faculty || []).filter((s: any) => guideMatches(s, form.courseId, form.departmentId)),
    [lookups.faculty, form.courseId, form.departmentId],
  );

  async function loadLookups() {
    const [courseTypes, courses, departments, sessions, specialities, faculty] = await Promise.all([
      get('/masters/course-types'),
      get('/masters/courses'),
      get('/masters/departments'),
      get('/masters/sessions'),
      get('/masters/specialities'),
      get('/masters/faculty'),
    ]);
    setLookups({ courseTypes, courses, departments, sessions, specialities, faculty });
    return { courseTypes, courses, departments, sessions, specialities, faculty };
  }

  useEffect(() => {
    loadLookups().then(({ sessions, courses, departments }) => {
      const current = sessions.find((s: any) => s.current) || sessions[0];
      const onlyCourse = courses.length === 1 ? courses[0] : null;
      const deptFromCourse = onlyCourse?.departmentId
        ? String(onlyCourse.departmentId)
        : departments.length === 1
          ? String(departments[0]._id)
          : '';
      setForm((f: any) => ({
        ...f,
        courseId: f.courseId || (onlyCourse ? String(onlyCourse._id) : ''),
        departmentId: f.departmentId || deptFromCourse,
        sessionMonth: f.sessionMonth || current?.month || '',
        sessionYear: f.sessionYear || String(current?.year || new Date().getFullYear()),
        sessionId: f.sessionId || current?._id || '',
      }));
    });
    if (id) {
      get(`/files/${id}`).then((d) => {
        const f = d.file;
        setReadOnly(f.status !== 'DRAFT');
        const docs = f.documents || [];
        const thesisDoc = docs.filter((doc: any) => !doc.kind || doc.kind === 'THESIS').slice(-1)[0] || null;
        setExistingDoc(thesisDoc);
        setHasPdf(Boolean(thesisDoc?.path || docs.some((doc: any) => doc.kind === 'THESIS' || doc.path)));
        setForm({
          sessionId: f.sessionId || '',
          sessionMonth: d.session?.month || '',
          sessionYear: String(d.session?.year || ''),
          courseId: f.courseId || '',
          departmentId: f.departmentId || '',
          specialityId: f.specialityId || '',
          enrollmentNo: f.candidate?.enrollmentNo || '',
          candidateName: f.candidate?.name || '',
          dob: String(f.candidate?.dob || '').slice(0, 10),
          mobile: f.candidate?.mobile || '',
          candidateEmail: f.candidate?.email || '',
          title: f.title || '',
          chiefGuideId: f.chiefGuideId || '',
          coGuideIds: (f.coGuideIds || []).map((x: any) => String(x)),
        });
      });
    }
  }, [id]);

  useEffect(() => {
    const course = lookups.courses.find((c: any) => String(c._id) === String(form.courseId));
    const type = lookups.courseTypes.find((t: any) => String(t._id) === String(course?.courseTypeId));
    if (!type?.blueprintId) {
      setMaxCoGuides(0);
      setMinCoGuides(0);
      return;
    }
    get(`/blueprints/${type.blueprintId}`)
      .then((bp) => {
        setMaxCoGuides(bp.guidePolicy?.maxCoGuides || 0);
        setMinCoGuides(bp.guidePolicy?.minCoGuides || 0);
      })
      .catch(() => {
        setMaxCoGuides(0);
        setMinCoGuides(0);
      });
  }, [form.courseId, lookups.courses, lookups.courseTypes]);

  function resetForm() {
    const onlyCourse = mappedCourses.length === 1 ? mappedCourses[0] : null;
    const current = lookups.sessions.find((s: any) => s.current) || lookups.sessions[0];
    setForm({
      ...emptyForm,
      courseId: onlyCourse ? String(onlyCourse._id) : '',
      departmentId: onlyCourse?.departmentId ? String(onlyCourse.departmentId) : '',
      sessionMonth: current?.month || '',
      sessionYear: String(current?.year || new Date().getFullYear()),
      sessionId: current?._id || '',
    });
    setPdf(null);
    setExistingDoc(null);
    setShowPreview(false);
    setFieldErr({});
    setError(null);
    setGuideForm({ name: '', email: '', designation: '', mobile: '' });
  }

  async function savePlus(e: FormEvent) {
    e.preventDefault();
    setPlusErr(null);
    try {
      if (plus === 'session') {
        if (!plusForm.month || !plusForm.year) throw new Error('Month and year are required');
        const created = await post('/masters/sessions', { month: plusForm.month, year: Number(plusForm.year), current: false });
        const sessions = await get('/masters/sessions');
        setLookups((l: any) => ({ ...l, sessions }));
        setForm((f: any) => ({ ...f, sessionId: created._id, sessionMonth: created.month, sessionYear: String(created.year) }));
      }
      if (plus === 'course') {
        if (!plusForm.name || !plusForm.courseTypeId) throw new Error('Course name and course type are required');
        const created = await post('/masters/courses', {
          name: plusForm.name,
          code: plusForm.code,
          courseTypeId: plusForm.courseTypeId,
          departmentId: plusForm.departmentId || form.departmentId || user?.departmentIds?.[0],
        });
        const courses = await get('/masters/courses');
        setLookups((l: any) => ({ ...l, courses }));
        setForm((f: any) => ({
          ...f,
          courseId: created._id,
          specialityId: '',
          departmentId: created.departmentId ? String(created.departmentId) : f.departmentId,
        }));
      }
      if (plus === 'speciality') {
        if (!form.courseId) throw new Error('Select a course first');
        if (!plusForm.name) throw new Error('Speciality name is required');
        const created = await post('/masters/specialities', { name: plusForm.name, courseId: form.courseId });
        const specialities = await get('/masters/specialities');
        setLookups((l: any) => ({ ...l, specialities }));
        set('specialityId', created._id);
      }
      setPlus(null);
      setPlusForm({});
    } catch (err: any) {
      setPlusErr(err.message);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const errors = validateCandidate(form, { requirePdf: !editing, hasPdf: Boolean(pdf) || hasPdf });
    const pdfProblem = pdf ? thesisFileProblem(pdf) : null;
    if (pdfProblem) errors.pdf = pdfProblem;
    setFieldErr(errors);
    if (Object.keys(errors).length) {
      setError('Please correct the highlighted fields.');
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const session =
        lookups.sessions.find(
          (s: any) => s.month === form.sessionMonth && String(s.year) === String(form.sessionYear),
        ) || lookups.sessions.find((s: any) => String(s._id) === String(form.sessionId));
      const payload = {
        ...form,
        sessionId: session?._id || form.sessionId,
        sessionMonth: form.sessionMonth,
        sessionYear: form.sessionYear,
        mobile: String(form.mobile || '').replace(/\D/g, ''),
      };
      if (editing) {
        await patch(`/files/${id}`, payload);
        if (pdf) {
          const fd = new FormData();
          fd.append('kind', 'THESIS');
          fd.append('file', pdf);
          setUpload({ loaded: 0, total: pdf.size, percent: 0 });
          const updated = await postWithProgress<any>(`/files/${id}/documents`, fd, setUpload);
          if (updated?.documents) {
            const latest = (updated.documents || []).filter((doc: any) => !doc.kind || doc.kind === 'THESIS').slice(-1)[0];
            if (latest) {
              setExistingDoc(latest);
              setHasPdf(true);
            }
          }
          setPdf(null);
        }
        setOk('Thesis updated successfully.');
        return;
      }
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      if (pdf) fd.append('thesis', pdf);
      if (pdf) setUpload({ loaded: 0, total: pdf.size, percent: 0 });
      await postWithProgress('/files', fd, setUpload);
      resetForm();
      setOk('Thesis added successfully.');
    } catch (err: any) {
      setError(uploadFailureMessage(err));
    } finally {
      setBusy(false);
      setUpload(null);
    }
  }

  const specs = lookups.specialities.filter(
    (s: any) => !form.courseId || !s.courseId || String(s.courseId) === String(form.courseId),
  );
  const monthOpts = monthsFromSessions(lookups.sessions, form.sessionMonth);
  const yearOpts = yearsFromSessions(lookups.sessions, form.sessionYear);

  const formBody = (
    <>
      {readOnly && (
        <p className="okbox">
          This thesis is already in the examination workflow.{' '}
          <Link to={`/app/files/${id}`}>Open File 360</Link>
        </p>
      )}
      <ErrorBox error={error} />
      <p className="dept-all-req">* All fields are mandatory</p>
      <h3 className="dept-sec">Session</h3>
      <div className="form-pair">
      <Field
        label="Month"
        required
        error={fieldErr.sessionMonth}
        extra={
          !readOnly ? (
            <button type="button" className="plus-btn" onClick={() => { setPlus('session'); setPlusForm({ month: '', year: form.sessionYear }); setPlusErr(null); }}>
              +
            </button>
          ) : null
        }
      >
        <select className="input" value={form.sessionMonth} disabled={readOnly} onChange={(e) => set('sessionMonth', e.target.value)} required>
          <option value="">Select month</option>
          {monthOpts.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Year" required>
        <select className="input" value={form.sessionYear} disabled={readOnly} onChange={(e) => set('sessionYear', e.target.value)} required>
          {yearOpts.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>
      </div>
      <h3 className="dept-sec">Course</h3>
      <div className="form-pair">
      <Field
        label="Name of Course"
        required
        error={fieldErr.courseId}
        extra={
          !readOnly ? (
            <button type="button" className="plus-btn" onClick={() => { setPlus('course'); setPlusForm({ name: '', courseTypeId: '', departmentId: form.departmentId }); setPlusErr(null); }}>
              +
            </button>
          ) : null
        }
      >
        <select
          className="input"
          value={form.courseId}
          disabled={readOnly || mappedCourses.length === 1}
          onChange={(e) => {
            const next = e.target.value;
            const course = mappedCourses.find((c: any) => String(c._id) === next);
            setForm((f: any) => ({
              ...f,
              courseId: next,
              specialityId: '',
              departmentId: course?.departmentId ? String(course.departmentId) : f.departmentId,
            }));
          }}
          required
        >
          <option value="">-- Select Course --</option>
          {mappedCourses.map((s: any) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Name of Speciality"
        required
        error={fieldErr.specialityId}
        extra={
          !readOnly ? (
            <button type="button" className="plus-btn" onClick={() => { setPlus('speciality'); setPlusForm({ name: '' }); setPlusErr(null); }}>
              +
            </button>
          ) : null
        }
      >
        <select className="input" value={form.specialityId} disabled={readOnly} onChange={(e) => set('specialityId', e.target.value)} required>
          <option value="">-- Select Speciality --</option>
          {specs.map((s: any) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      </div>
      <Field label="Name of Department" required error={fieldErr.departmentId}>
        <select
          className="input"
          value={form.departmentId}
          required
          disabled={readOnly || Boolean(selectedCourse?.departmentId) || mappedDepts.length === 1}
          onChange={(e) => set('departmentId', e.target.value)}
        >
          <option value="">-- Select Department --</option>
          {mappedDepts.map((s: any) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <h3 className="dept-sec">Candidate</h3>
      <div className="form-pair">
      <Field label="Enrollment No." required error={fieldErr.enrollmentNo}>
        <input className="input" value={form.enrollmentNo} disabled={readOnly} onChange={(e) => set('enrollmentNo', e.target.value)} required />
      </Field>
      <Field label="Name of Candidate" required error={fieldErr.candidateName}>
        <input className="input" value={form.candidateName} disabled={readOnly} onChange={(e) => set('candidateName', e.target.value)} required />
      </Field>
      <Field label="DOB of Candidate" required error={fieldErr.dob}>
        <input
          className="input"
          type="date"
          max={new Date().toISOString().slice(0, 10)}
          min="1920-01-01"
          value={String(form.dob || '').slice(0, 10)}
          disabled={readOnly}
          onChange={(e) => set('dob', e.target.value)}
          required
        />
      </Field>
      <Field label="Mobile No. of Candidate" required error={fieldErr.mobile}>
        <input
          className="input"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit mobile number"
          value={form.mobile}
          disabled={readOnly}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
            set('mobile', digits);
            if (fieldErr.mobile) {
              const ok = /^[6-9]\d{9}$/.test(digits);
              setFieldErr((prev) => ({ ...prev, mobile: ok ? '' : prev.mobile }));
            }
          }}
          onBlur={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            if (!digits) {
              setFieldErr((prev) => ({ ...prev, mobile: 'Mobile No. of Candidate is required' }));
            } else if (!/^[6-9]\d{9}$/.test(digits)) {
              setFieldErr((prev) => ({ ...prev, mobile: 'Enter a valid 10-digit mobile number (starting with 6-9)' }));
            } else {
              setFieldErr((prev) => ({ ...prev, mobile: '' }));
            }
          }}
          required
        />
      </Field>
      </div>
      <Field label="Email Id of Candidate" required error={fieldErr.candidateEmail}>
        <input
          className="input"
          type="email"
          placeholder="example@domain.com"
          value={form.candidateEmail}
          disabled={readOnly}
          onChange={(e) => {
            set('candidateEmail', e.target.value);
            if (fieldErr.candidateEmail) {
              const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value.trim());
              setFieldErr((prev) => ({ ...prev, candidateEmail: ok ? '' : prev.candidateEmail }));
            }
          }}
          onBlur={(e) => {
            const email = e.target.value.trim();
            if (!email) {
              setFieldErr((prev) => ({ ...prev, candidateEmail: 'Email Id of Candidate is required' }));
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              setFieldErr((prev) => ({ ...prev, candidateEmail: 'Enter a valid email address (must contain @ and .)' }));
            } else {
              setFieldErr((prev) => ({ ...prev, candidateEmail: '' }));
            }
          }}
          required
        />
      </Field>
      <h3 className="dept-sec">Thesis</h3>
      <Field label="Thesis title" required error={fieldErr.title}>
        <input className="input" value={form.title} disabled={readOnly} onChange={(e) => set('title', e.target.value)} required />
      </Field>
      {existingDoc?.path ? (
        <div
          style={{
            margin: '10px 0 16px',
            padding: '14px 16px',
            border: '1px solid var(--line, #cbd5e1)',
            borderRadius: '10px',
            background: 'var(--panel-bg, #f8fafc)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: '#fee2e2',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '13px',
                  flexShrink: 0,
                  border: '1px solid #fecaca',
                }}
              >
                PDF
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '14px', color: 'var(--text, #0f172a)' }}>
                    {existingDoc.originalName || 'thesis.pdf'}
                  </strong>
                  {existingDoc.version && (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 7px',
                        borderRadius: '4px',
                        background: '#e0e7ff',
                        color: '#3730a3',
                        fontWeight: 600,
                      }}
                    >
                      v{existingDoc.version}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '1px 7px',
                      borderRadius: '4px',
                      background: '#dcfce7',
                      color: '#15803d',
                      fontWeight: 600,
                    }}
                  >
                    Uploaded
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted, #64748b)', marginTop: '3px' }}>
                  {existingDoc.uploadedAt ? `Uploaded on ${formatDate(existingDoc.uploadedAt)}` : 'Thesis document attached'}
                  {existingDoc.uploadedBy ? ` · by ${existingDoc.uploadedBy}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <a
                className="btn secondary small"
                href={`/api/uploads/${existingDoc.path}`}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <span>View / Open PDF</span> ↗
              </a>
              <button
                type="button"
                className="btn secondary small"
                onClick={() => setShowPreview((prev) => !prev)}
              >
                {showPreview ? 'Hide Preview' : 'Preview'}
              </button>
            </div>
          </div>

          {showPreview && (
            <div style={{ marginTop: '12px', borderTop: '1px solid var(--line, #e2e8f0)', paddingTop: '12px' }}>
              <iframe
                className="thesis-frame thesis-frame-compact"
                title="Uploaded Thesis PDF Preview"
                src={`/api/uploads/${existingDoc.path}`}
                style={{ width: '100%', minHeight: '380px', border: '1px solid var(--line, #cbd5e1)', borderRadius: '6px' }}
              />
            </div>
          )}
        </div>
      ) : editing ? (
        <p className="guide-muted" style={{ margin: '8px 0 14px', fontSize: '13px' }}>
          No thesis PDF is currently uploaded.
        </p>
      ) : null}

      <Field
        label={existingDoc?.path ? 'Upload new Thesis PDF (optional)' : 'Thesis PDF'}
        required={!editing && !existingDoc?.path}
        error={fieldErr.pdf}
      >
        <input
          className="input"
          type="file"
          accept="application/pdf"
          disabled={readOnly}
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setPdf(file);
            const problem = file ? thesisFileProblem(file) : null;
            if (problem) setFieldErr((prev) => ({ ...prev, pdf: problem }));
            else if (file && fieldErr.pdf) {
              setFieldErr((prev) => ({ ...prev, pdf: '' }));
            }
          }}
        />
        {existingDoc?.path && !pdf && (
          <small style={{ display: 'block', marginTop: '5px', color: 'var(--muted, #64748b)', fontSize: '12px' }}>
            A thesis PDF is already uploaded above. Choose a new file only if you wish to replace it.
          </small>
        )}
        {pdf && (
          <small style={{ display: 'block', marginTop: '5px', color: '#0284c7', fontSize: '12px', fontWeight: 500 }}>
            ✓ Selected new file: {pdf.name} ({formatBytes(pdf.size)}). Saving will upload this file.
          </small>
        )}
      </Field>
      <h3 className="dept-sec">Chief Guide</h3>
      {minCoGuides > 0 && (
        <p style={{ color: 'var(--gold, #8a6d1b)', margin: 0 }}>This course type needs a Co-Guide in addition to the Chief Guide.</p>
      )}
      <Field label="Chief Guide" required error={fieldErr.chiefGuideId}>
        <select className="input" value={form.chiefGuideId} disabled={readOnly} onChange={(e) => set('chiefGuideId', e.target.value)} required>
          <option value="">Select faculty</option>
          {guides.map((s: any) => (
            <option key={s._id} value={s._id}>
              {s.name} ({s.email})
            </option>
          ))}
        </select>
      </Field>
      {maxCoGuides > 0 &&
        Array.from({ length: maxCoGuides }).map((_, i) => (
          <Field key={i} label={maxCoGuides === 1 ? 'Co-Guide' : `Co-Guide ${i + 1}`} required={i < minCoGuides}>
            <select
              className="input"
              value={form.coGuideIds[i] || ''}
              disabled={readOnly}
              onChange={(e) => {
                const next = [...form.coGuideIds];
                next[i] = e.target.value;
                set('coGuideIds', next);
              }}
            >
              <option value="">{i < minCoGuides ? 'Select co-guide' : 'None'}</option>
              {guides
                .filter((s: any) => s._id !== form.chiefGuideId && !form.coGuideIds.some((cid: string, j: number) => cid && cid === s._id && j !== i))
                .map((s: any) => (
                  <option key={s._id} value={s._id}>
                    {s.name} ({s.email})
                  </option>
                ))}
            </select>
          </Field>
        ))}
      <div>
        <h3>Add a new guide if they are not listed</h3>
        <div className="form-pair">
        <Field label="Guide name">
          <input className="input" placeholder="Guide name" value={guideForm.name} disabled={readOnly} onChange={(e) => setGuideForm({ ...guideForm, name: e.target.value })} />
        </Field>
        <Field label="Guide email">
          <input
            className="input"
            type="email"
            placeholder="e.g. guide@domain.edu"
            value={guideForm.email}
            disabled={readOnly}
            onChange={(e) => setGuideForm({ ...guideForm, email: e.target.value.trim() })}
          />
        </Field>
        </div>
        <div className="form-pair">
        <Field label="Contact (Mobile)" required>
          <input
            className="input"
            type="tel"
            maxLength={10}
            placeholder="10-digit mobile"
            value={guideForm.mobile}
            disabled={readOnly}
            onChange={(e) => setGuideForm({ ...guideForm, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
          />
        </Field>
        <Field label="Designation">
          <input className="input" placeholder="Designation" value={guideForm.designation} disabled={readOnly} onChange={(e) => setGuideForm({ ...guideForm, designation: e.target.value })} />
        </Field>
        </div>
        {!readOnly && (
          <button
            type="button"
            className="btn secondary small"
            style={{ marginTop: 8 }}
            onClick={async () => {
              const mobile = String(guideForm.mobile || '').replace(/\D/g, '');
              if (!guideForm.name.trim()) {
                setError('Guide name is required');
                return;
              }
              if (!guideForm.email.trim()) {
                setError('Guide email is required');
                return;
              }
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guideForm.email.trim())) {
                setError('Guide email is invalid (e.g. guide@domain.edu)');
                return;
              }
              if (!mobile) {
                setError('Contact is required');
                return;
              }
              if (!/^[6-9]\d{9}$/.test(mobile)) {
                setError('Contact must be a 10-digit Indian mobile number');
                return;
              }
              try {
                setError(null);
                const created = await post('/masters/faculty', {
                  ...guideForm,
                  mobile,
                  canGuide: true,
                  departmentId: form.departmentId,
                  courseId: form.courseId,
                });
                const faculty = await get('/masters/faculty');
                setLookups((l: any) => ({ ...l, faculty }));
                set('chiefGuideId', created._id);
                setGuideForm({ name: '', email: '', designation: '', mobile: '' });
              } catch (err: any) {
                setError(err.message);
              }
            }}
          >
            Save guide and select
          </button>
        )}
      </div>
      {!readOnly && (
        <div className="row dept-add-actions">
          <button className="btn" type="submit" disabled={busy}>
            {upload ? `${upload.percent}%` : editing ? 'Save' : 'Add'}
          </button>
          {upload && <span className="muted">{progressLabel(upload)}</span>}
          {!editing && (
            <button className="btn secondary" type="button" onClick={resetForm}>
              Reset
            </button>
          )}
          {embedded && onCancel && (
            <button className="btn secondary" type="button" onClick={onCancel}>
              Close
            </button>
          )}
        </div>
      )}
    </>
  );

  const successModal = ok ? (
    <ResultDialog
      ok
      message={ok}
      onClose={() => {
        setOk(null);
        onSaved?.();
      }}
    />
  ) : null;

  const plusModal = plus ? (
    <div className="modal-overlay" onClick={() => setPlus(null)}>
      <form className="card dialog-card" onClick={(e) => e.stopPropagation()} onSubmit={savePlus}>
        <h2>{plus === 'session' ? 'Add session' : plus === 'course' ? 'Add course' : 'Add speciality'}</h2>
        <ErrorBox error={plusErr} />
        {plus === 'session' && (
          <div className="form-pair">
            <Field label="Month" required>
              <select className="input" value={plusForm.month || ''} onChange={(e) => setPlusForm({ ...plusForm, month: e.target.value })} required>
                <option value="">Select</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Year" required>
              <input className="input" type="number" value={plusForm.year || ''} onChange={(e) => setPlusForm({ ...plusForm, year: e.target.value })} required />
            </Field>
          </div>
        )}
        {plus === 'course' && (
          <>
            <div className="form-pair">
              <Field label="Name of Course" required>
                <input className="input" value={plusForm.name || ''} onChange={(e) => setPlusForm({ ...plusForm, name: e.target.value })} required />
              </Field>
              <Field label="Course type" required>
                <select className="input" value={plusForm.courseTypeId || ''} onChange={(e) => setPlusForm({ ...plusForm, courseTypeId: e.target.value })} required>
                  <option value="">Select</option>
                  {lookups.courseTypes.map((t: any) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Department" required>
              <select
                className="input"
                value={plusForm.departmentId || form.departmentId || ''}
                onChange={(e) => setPlusForm({ ...plusForm, departmentId: e.target.value })}
                required
              >
                <option value="">Select department</option>
                {(lookups.departments || []).map((d: any) => (
                  <option key={d._id} value={d._id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {plus === 'speciality' && (
          <Field label="Name of Speciality" required>
            <input className="input" value={plusForm.name || ''} onChange={(e) => setPlusForm({ ...plusForm, name: e.target.value })} required />
          </Field>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" type="submit">
            Save
          </button>
          <button className="btn secondary" type="button" onClick={() => setPlus(null)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  ) : null;

  if (embedded) {
    return (
      <>
        <form className="dept-add-card" onSubmit={onSubmit}>
          {formBody}
        </form>
        {plusModal}
        {successModal}
      </>
    );
  }

  return (
    <>
      <div className="dept-hero">
        <h1>{editing ? 'Edit Thesis' : 'Add New Thesis'}</h1>
        <p>{editing ? 'Update the candidate details before sending to the Examination Section.' : 'Please fill form to upload new thesis'}</p>
      </div>
      <form className="card dept-add-card" onSubmit={onSubmit}>
        {formBody}
      </form>
      {plusModal}
      {successModal}
    </>
  );
}

export function NewThesisPage() {
  const { id } = useParams();
  return (
    <Shell mode="app">
      <ThesisForm id={id} />
    </Shell>
  );
}
