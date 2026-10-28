import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, ExportButtons, Field, ResultDialog } from '../../components/ui';
import { formatDate } from '../../dept';
import { ThesisForm } from './NewThesis';
import { SessionFilter } from '../../components/SessionFilter';
import { applySessionParams, useSessionFilter } from '../../session';
import { compareByCourseThenCandidate } from '../../fileSort';

const THESIS_GRID_COLS = [
  { key: 'courseTypeName', label: 'Course type' },
  { key: 'courseName', label: 'Course' },
  { key: 'departmentName', label: 'Department' },
  { key: 'candidateName', label: 'Candidate' },
  { key: 'enrollmentNo', label: 'EnrollmentNo' },
  { key: 'dob', label: 'DOB' },
  { key: 'mobile', label: 'Contact' },
  { key: 'email', label: 'EmailId' },
];

function thesisExportRow(r: any) {
  return {
    courseTypeName: r.courseTypeName,
    courseName: r.courseName,
    departmentName: r.departmentName,
    candidateName: r.candidate?.name,
    enrollmentNo: r.candidate?.enrollmentNo,
    dob: formatDate(r.candidate?.dob),
    mobile: r.candidate?.mobile,
    email: r.candidate?.email,
  };
}

function sentToExamMessage(count: number) {
  if (count === 1) return 'Candidate sent successfully to the Examination Section.';
  return `${count} candidates sent successfully to the Examination Section.`;
}

function latestThesisDoc(docs: any[] = []) {
  const theses = docs.filter((d) => !d.kind || d.kind === 'THESIS');
  return theses.length ? theses[theses.length - 1] : null;
}

function ViewInfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
}

function ThesisViewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    get(`/files/${id}`)
      .then(setData)
      .catch((e: any) => setError(e.message));
  }, [id]);
  const file = data?.file;
  const c = file?.candidate || {};
  const guide = data?.chiefGuide || {};
  const session = data?.session ? [data.session.month, data.session.year].filter(Boolean).join(' ') : '';
  const coGuides: any[] = data?.coGuides || [];
  const thesis = latestThesisDoc(file?.documents);
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-card modal-card-wide thesis-view-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thesis-view-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="thesis-view-title">Candidate details</h2>
          <button type="button" className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        <ErrorBox error={error} />
        {!data && !error && <p className="guide-muted">Loading candidate details…</p>}
        {file && (
          <>
            <div className="info-section thesis-view-first">
              <h3>Candidate</h3>
              <dl className="info-dl">
                <ViewInfoRow label="Name" value={c.name} />
                <ViewInfoRow label="Enrollment no." value={c.enrollmentNo} />
                <ViewInfoRow label="Date of birth" value={formatDate(c.dob)} />
                <ViewInfoRow label="Mobile" value={c.mobile} />
                <ViewInfoRow label="Email" value={c.email} />
              </dl>
            </div>
            <div className="info-section">
              <h3>Thesis</h3>
              <dl className="info-dl">
                <ViewInfoRow label="Title" value={file.title} />
                <ViewInfoRow label="Course" value={data.course?.name} />
                <ViewInfoRow label="Speciality" value={data.speciality?.name} />
                <ViewInfoRow label="Department" value={data.department?.name} />
                <ViewInfoRow label="Session" value={session} />
              </dl>
            </div>
            <div className="info-section">
              <h3>Chief Guide</h3>
              <dl className="info-dl">
                <ViewInfoRow label="Name" value={guide.name || file.chiefGuideName} />
                <ViewInfoRow label="Email" value={guide.email || file.chiefGuideEmail} />
                <ViewInfoRow label="Designation" value={guide.designation} />
                <ViewInfoRow label="Mobile" value={guide.mobile} />
              </dl>
            </div>
            {coGuides.length > 0 && (
              <div className="info-section">
                <h3>Co-guides</h3>
                <ul className="info-list">
                  {coGuides.map((g) => (
                    <li key={g._id || g.email}>
                      {g.name}
                      {g.designation ? ` · ${g.designation}` : ''}
                      {g.email ? ` · ${g.email}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="info-section">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Uploaded thesis</h3>
                {thesis?.path && (
                  <a className="btn small" href={`/api/uploads/${thesis.path}`} target="_blank" rel="noreferrer">
                    Open PDF
                  </a>
                )}
              </div>
              {thesis?.path ? (
                <>
                  <p className="guide-muted" style={{ margin: '8px 0' }}>
                    {thesis.originalName || 'thesis.pdf'}
                    {thesis.version ? ` · v${thesis.version}` : ''}
                  </p>
                  <iframe className="thesis-frame thesis-frame-compact" title="Uploaded thesis PDF" src={`/api/uploads/${thesis.path}`} />
                </>
              ) : (
                <p className="info-empty">No thesis PDF uploaded yet.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function DeptEditListPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  async function load() {
    try {
      const params = applySessionParams(new URLSearchParams({ bucket: 'added' }), month, year);
      setRows(await get(`/files?${params}`));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, month, year]);

  // Derive unique course and department options from loaded rows
  const courseOptions = Array.from(
    new Map(rows.filter((r) => r.courseId && r.courseName).map((r) => [String(r.courseId), r.courseName])).entries(),
  ).map(([id, name]) => ({ id, name }));

  const deptOptions = Array.from(
    new Map(rows.filter((r) => r.departmentId && r.departmentName).map((r) => [String(r.departmentId), r.departmentName])).entries(),
  ).map(([id, name]) => ({ id, name }));

  const hasFilters = Boolean(q.trim() || courseFilter || deptFilter);

  function clearFilters() {
    setQ('');
    setCourseFilter('');
    setDeptFilter('');
  }

  const visible = rows.filter((r) => {
    if (courseFilter && String(r.courseId) !== courseFilter) return false;
    if (deptFilter && String(r.departmentId) !== deptFilter) return false;
    if (q.trim()) {
      const hay = [r.candidate?.enrollmentNo, r.candidate?.name, r.courseName, r.departmentName].join(' ').toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }).sort(compareByCourseThenCandidate);
  const cols = THESIS_GRID_COLS;
  const exportRows = visible.map(thesisExportRow);
  return (
    <Shell mode="app">
      <div className="dept-hero">
        <h1>Edit Thesis</h1>
        <p>Drafts still with the department. Open a row to update details, title, PDF and guide.</p>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>Total Thesis {visible.length}</b>
          <ExportButtons columns={cols} rows={exportRows} filename="edit-thesis" />
        </div>
        <div className="filter-grid">
          <SessionFilter sessions={sessions} month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <select
            className="input"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">-- All Courses --</option>
            {courseOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">-- All Departments --</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input className="input" placeholder="Search by name, enrollment, course…" value={q} onChange={(e) => setQ(e.target.value)} />
          {hasFilters && (
            <button type="button" className="btn secondary small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Sr.No.</th>
              <th>Course type</th>
              <th>Course</th>
              <th>Department</th>
              <th>Candidate</th>
              <th>EnrollmentNo</th>
              <th>DOB</th>
              <th>Contact</th>
              <th>EmailId</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r._id}>
                <td>{i + 1}</td>
                <td>{r.courseTypeName || '—'}</td>
                <td>{r.courseName}</td>
                <td>{r.departmentName || '—'}</td>
                <td>{r.candidate?.name}</td>
                <td>{r.candidate?.enrollmentNo}</td>
                <td>{formatDate(r.candidate?.dob)}</td>
                <td>{r.candidate?.mobile}</td>
                <td>{r.candidate?.email}</td>
                <td>
                  <button type="button" className="btn small" onClick={() => setEditId(r._id)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editId && (
        <div className="modal-overlay" onClick={() => setEditId(null)}>
          <div className="modal-card thesis-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Edit Thesis</h2>
              <button type="button" className="btn secondary small" onClick={() => setEditId(null)}>
                Close
              </button>
            </div>
            <ThesisForm
              id={editId}
              embedded
              onSaved={() => {
                load();
                setEditId(null);
              }}
              onCancel={() => setEditId(null)}
            />
          </div>
        </div>
      )}
    </Shell>
  );
}

export function DeptAddedPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  const [courseFilter, setCourseFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [readinessFilter, setReadinessFilter] = useState('');
  const [q, setQ] = useState('');
  async function load() {
    const params = applySessionParams(new URLSearchParams({ bucket: 'added' }), month, year);
    setRows(await get(`/files?${params}`));
  }
  useEffect(() => {
    if (!ready) return;
    load().catch((e) => setError(e.message));
  }, [ready, month, year]);
  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function send(ids: string[]) {
    if (!ids.length || sending) return;
    setError(null);
    setOk(null);
    const blocked = rows.filter((r) => ids.includes(r._id) && !r.sendReady);
    if (blocked.length) {
      setError(blocked.map((r) => `${r.candidate?.enrollmentNo}: ${(r.sendBlockers || []).join('; ')}`).join(' '));
      return;
    }
    setSending(true);
    try {
      let count = ids.length;
      let failNote = '';
      if (ids.length === 1) {
        await post(`/files/${ids[0]}/send`, {});
      } else {
        const result = await post('/files/send', { ids });
        count = Array.isArray(result?.sent) ? result.sent.length : ids.length;
        const failed = Array.isArray(result?.failed) ? result.failed : [];
        if (failed.length) {
          failNote = failed.map((f: any) => f.message).filter(Boolean).join(' ');
        }
      }
      setSelected([]);
      if (count > 0) {
        setOk(failNote ? `${sentToExamMessage(count)} ${failNote}` : sentToExamMessage(count));
      } else {
        setError(failNote || 'Could not send selected candidates.');
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }
  // Derive dropdown options from loaded rows
  const courseOptions = Array.from(
    new Map(rows.filter((r) => r.courseId && r.courseName).map((r) => [String(r.courseId), r.courseName as string])).entries(),
  ).map(([id, name]) => ({ id, name }));

  const deptOptions = Array.from(
    new Map(rows.filter((r) => r.departmentId && r.departmentName).map((r) => [String(r.departmentId), r.departmentName as string])).entries(),
  ).map(([id, name]) => ({ id, name }));

  const hasFilters = Boolean(q.trim() || courseFilter || deptFilter || readinessFilter);

  function clearFilters() {
    setQ('');
    setCourseFilter('');
    setDeptFilter('');
    setReadinessFilter('');
  }

  const visible = rows.filter((r) => {
    if (courseFilter && String(r.courseId) !== courseFilter) return false;
    if (deptFilter && String(r.departmentId) !== deptFilter) return false;
    if (readinessFilter === 'ready' && !r.sendReady) return false;
    if (readinessFilter === 'blocked' && r.sendReady) return false;
    if (q.trim()) {
      const hay = [r.candidate?.enrollmentNo, r.candidate?.name, r.candidate?.email, r.courseName, r.departmentName]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }).sort(compareByCourseThenCandidate);

  const exportRows = visible.map(thesisExportRow);
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.includes(r._id));
  return (
    <Shell mode="app">
      <div className="dept-hero">
        <h1>Send to Examination Section</h1>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>
            Total Thesis {visible.length}
            {selected.length > 0 ? ` · Selected ${selected.length}` : ''}
          </b>
          <button className="btn danger small" type="button" onClick={() => send(selected)} disabled={!selected.length || sending}>
            {selected.length > 0
              ? `Send ${selected.length} to Examination Section`
              : 'Send to Examination Section'}
          </button>
        </div>
        <div className="filter-grid" style={{ marginTop: 10 }}>
          <SessionFilter sessions={sessions} month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
        </div>
        <div className="filter-grid" style={{ marginTop: 8 }}>
          <select
            className="input"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">-- All Courses --</option>
            {courseOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">-- All Departments --</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={readinessFilter}
            onChange={(e) => setReadinessFilter(e.target.value)}
            aria-label="Filter by send readiness"
          >
            <option value="">-- All Statuses --</option>
            <option value="ready">✅ Ready to Send</option>
            <option value="blocked">⚠️ Has Blockers</option>
          </select>
          <input
            className="input"
            placeholder="Search by name, enrollment, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {hasFilters && (
            <button type="button" className="btn secondary small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <ExportButtons columns={THESIS_GRID_COLS} rows={exportRows} filename="added-thesis" />
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => setSelected(allVisibleSelected ? [] : visible.map((r) => r._id))}
                  aria-label="Select all visible"
                />
              </th>
              <th>Sr.No.</th>
              <th>Course type</th>
              <th>Course</th>
              <th>Department</th>
              <th>Candidate</th>
              <th>EnrollmentNo</th>
              <th>DOB</th>
              <th>Contact</th>
              <th>EmailId</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r._id}>
                <td>
                  <input type="checkbox" checked={selected.includes(r._id)} onChange={() => toggle(r._id)} />
                </td>
                <td>{i + 1}</td>
                <td>{r.courseTypeName || '—'}</td>
                <td>{r.courseName}</td>
                <td>{r.departmentName || '—'}</td>
                <td>{r.candidate?.name}</td>
                <td>{r.candidate?.enrollmentNo}</td>
                <td>{formatDate(r.candidate?.dob)}</td>
                <td>{r.candidate?.mobile}</td>
                <td>{r.candidate?.email}</td>
                <td>
                  <div className="table-actions">
                    <button className="icon-edit" type="button" title="Edit" onClick={() => setEditId(r._id)}>
                      ✎
                    </button>
                    <button className="link" type="button" onClick={() => setViewId(r._id)}>
                      click here to view
                    </button>
                    <button className="btn small" type="button" disabled={sending} onClick={() => send([r._id])}>
                      Send to Examination Section
                    </button>
                  </div>
                  {!r.sendReady && (
                    <div className="field-error">{(r.sendBlockers || []).join('. ')}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {editId && (
        <div className="modal-overlay" onClick={() => setEditId(null)}>
          <div className="modal-card thesis-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Edit Thesis</h2>
              <button type="button" className="btn secondary small" onClick={() => setEditId(null)}>
                Close
              </button>
            </div>
            <ThesisForm
              id={editId}
              embedded
              onSaved={() => {
                load();
                setEditId(null);
              }}
              onCancel={() => setEditId(null)}
            />
          </div>
        </div>
      )}
      {viewId && <ThesisViewModal id={viewId} onClose={() => setViewId(null)} />}
      {ok && <ResultDialog ok message={ok} onClose={() => setOk(null)} />}
    </Shell>
  );
}

export function DeptSubmittedPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [courseId, setCourseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();

  // Client-side filters
  const [deptFilter, setDeptFilter] = useState('');
  const [q, setQ] = useState('');

  async function load(next = courseId, nextMonth = month, nextYear = year) {
    const params = applySessionParams(new URLSearchParams({ bucket: 'submitted' }), nextMonth, nextYear);
    if (next) params.set('courseId', next);
    setRows(await get(`/files?${params}`));
  }
  useEffect(() => {
    get('/masters/courses').then(setCourses).catch(() => setCourses([]));
  }, []);
  useEffect(() => {
    if (!ready) return;
    load(courseId).catch((e) => setError(e.message));
  }, [ready, month, year]);

  // Derive department options from loaded rows
  const deptOptions = Array.from(
    new Map(
      rows
        .filter((r) => r.departmentId && r.departmentName)
        .map((r) => [String(r.departmentId), r.departmentName as string]),
    ).entries(),
  ).map(([id, name]) => ({ id, name }));

  const hasFilters = Boolean(q.trim() || deptFilter);

  function clearFilters() {
    setQ('');
    setDeptFilter('');
  }

  const visible = rows.filter((r) => {
    if (deptFilter && String(r.departmentId) !== deptFilter) return false;
    if (q.trim()) {
      const hay = [r.candidate?.enrollmentNo, r.candidate?.name, r.candidate?.email, r.courseName, r.departmentName]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }).sort(compareByCourseThenCandidate);

  const exportRows = visible.map(thesisExportRow);

  return (
    <Shell mode="app">
      <div className="dept-hero">
        <h1>Submitted to Examination Section</h1>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        {/* Server-side filters — Course + Session */}
        <form
          className="filter-grid"
          onSubmit={(e) => {
            e.preventDefault();
            load(courseId).catch((err) => setError(err.message));
          }}
        >
          <Field label="Name of Course">
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">-- Select Course --</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <SessionFilter sessions={sessions} month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <button className="btn gold" type="submit">
            Search
          </button>
        </form>
        {/* Client-side filters — Department + Text search */}
        <div className="filter-grid" style={{ marginTop: 8 }}>
          <select
            className="input"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">-- All Departments --</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Search by name, enrollment, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {hasFilters && (
            <button type="button" className="btn secondary small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <b>Total Thesis {visible.length}</b>
          <ExportButtons columns={THESIS_GRID_COLS} rows={exportRows} filename="submitted-thesis" />
        </div>
        <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Sr.No.</th>
              <th>Course type</th>
              <th>Course</th>
              <th>Department</th>
              <th>Candidate</th>
              <th>EnrollmentNo</th>
              <th>DOB</th>
              <th>Contact</th>
              <th>EmailId</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r._id}>
                <td>{i + 1}</td>
                <td>{r.courseTypeName || '—'}</td>
                <td>{r.courseName}</td>
                <td>{r.departmentName || '—'}</td>
                <td>
                  <Link to={`/app/files/${r._id}`}>{r.candidate?.name}</Link>
                </td>
                <td>{r.candidate?.enrollmentNo}</td>
                <td>{formatDate(r.candidate?.dob)}</td>
                <td>{r.candidate?.mobile}</td>
                <td>{r.candidate?.email}</td>
                <td>
                  <Link className="btn small" to={`/app/files/${r._id}`}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </Shell>
  );
}

const DEFAULT_DESIGNATIONS = [
  'Professor',
  'Professor & Head',
  'Additional Professor',
  'Associate Professor',
  'Assistant Professor',
];

function emptyGuideForm() {
  return {
    name: '',
    designation: '',
    departmentId: '',
    mobile: '',
    email: '',
    alternateMobile: '',
    alternateEmail: '',
    facultyId: '',
  };
}

function GuideField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`guide-field${error ? ' has-error' : ''}`}>
      <label className="guide-label">
        <span className="guide-label-text">{label}</span>
        {required ? <span className="guide-req">*</span> : <span className="guide-req-spacer" />}
      </label>
      <div className="guide-control">
        {children}
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}

export function DeptGuidesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [courseId, setCourseId] = useState('');
  const [dealingFilter, setDealingFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState(emptyGuideForm());
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [designations, setDesignations] = useState<string[]>(DEFAULT_DESIGNATIONS);
  const [plusKind, setPlusKind] = useState<'designation' | 'department' | null>(null);
  const [plusValue, setPlusValue] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load(next = courseId) {
    const params = new URLSearchParams({ session: 'all' });
    if (next) params.set('courseId', next);
    const [files, fac] = await Promise.all([get(`/files?${params}`), get('/masters/faculty')]);
    setRows(files);
    setFaculty(fac);
    const extra = (fac || [])
      .map((f: any) => String(f.designation || '').trim())
      .filter((v: string) => Boolean(v));
    setDesignations([...new Set([...DEFAULT_DESIGNATIONS, ...extra])]);
  }
  useEffect(() => {
    get('/masters/courses').then(setCourses).catch(() => setCourses([]));
    get('/masters/departments').then(setDepts).catch(() => setDepts([]));
    get('/masters/staff').then((st) => setStaffMembers(Array.isArray(st) ? st.filter((u: any) => u.role === 'DEALING') : [])).catch(() => setStaffMembers([]));
    load(courseId).catch((e) => setError(e.message));
  }, []);

  function openEdit(row: any) {
    const guide = faculty.find((f) => String(f._id) === String(row.chiefGuideId));
    setEditRow(row);
    setFieldErr({});
    setOk(null);
    setError(null);
    setForm({
      name: guide?.name || row.chiefGuideName || '',
      designation: guide?.designation || row.chiefGuideDesignation || '',
      departmentId: String(guide?.departmentId || row.departmentId || ''),
      mobile: guide?.mobile || row.chiefGuideMobile || '',
      email: guide?.email || row.chiefGuideEmail || '',
      alternateMobile: guide?.alternateMobile || row.chiefGuideAlternateMobile || '',
      alternateEmail: guide?.alternateEmail || row.chiefGuideAlternateEmail || '',
      facultyId: guide?._id || row.chiefGuideId || '',
    });
    const designation = String(guide?.designation || row.chiefGuideDesignation || '').trim();
    if (designation) setDesignations((d) => [...new Set([...d, designation])]);
  }

  function resetForm() {
    setFieldErr({});
    setError(null);
    setPlusKind(null);
    setForm(emptyGuideForm());
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim() || form.name.trim().length < 3) next.name = 'Name of Chief Guide is required';
    if (!form.designation) next.designation = 'Designation of Chief Guide is required';
    if (!form.departmentId) next.departmentId = 'Department of Chief Guide is required';
    const mobile = form.mobile.replace(/\D/g, '');
    if (!mobile) next.mobile = 'Mobile No. of Chief Guide is required';
    else if (!/^[6-9]\d{9}$/.test(mobile)) next.mobile = 'Mobile No. must be a 10-digit Indian mobile number';
    if (!form.email.trim()) next.email = 'Email Id of Chief Guide is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address';
    const altM = form.alternateMobile.replace(/\D/g, '');
    if (altM && !/^[6-9]\d{9}$/.test(altM)) next.alternateMobile = 'Enter a 10-digit Indian mobile number';
    if (form.alternateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.alternateEmail.trim())) {
      next.alternateEmail = 'Enter a valid email address';
    }
    return next;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const errors = validate();
    setFieldErr(errors);
    if (Object.keys(errors).length) {
      setError('Please fill all mandatory fields.');
      return;
    }
    setError(null);
    try {
      await post(`/files/${editRow._id}/chief-guide`, form);
      setOk('Chief Guide saved.');
      setEditRow(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const cols = [
    { key: 'courseName', label: 'Course' },
    { key: 'chiefGuideName', label: 'ChiefGuideName' },
    { key: 'chiefGuideDesignation', label: 'Designation' },
    { key: 'departmentName', label: 'Department' },
    { key: 'chiefGuideMobile', label: 'Contact' },
    { key: 'chiefGuideEmail', label: 'EmailId' },
  ];
  const hasFilters = Boolean(q.trim() || designationFilter || deptFilter || dealingFilter || courseId);

  function clearFilters() {
    setQ('');
    setDesignationFilter('');
    setDeptFilter('');
    setDealingFilter('');
    setCourseId('');
    load('').catch((err) => setError(err.message));
  }

  // Derive unique designation options from loaded rows
  const designationOptions = Array.from(
    new Set(rows.map((r) => String(r.chiefGuideDesignation || '').trim()).filter(Boolean)),
  ).sort();

  // Derive department options from master departments or loaded rows
  const deptOptions =
    depts.length > 0
      ? depts.map((d: any) => ({ id: String(d._id), name: d.name }))
      : Array.from(
          new Map(
            rows
              .filter((r) => r.departmentId && r.departmentName)
              .map((r) => [String(r.departmentId), r.departmentName as string]),
          ).entries(),
        ).map(([id, name]) => ({ id, name }));

  const visible = rows.filter((r) => {
    if (designationFilter && r.chiefGuideDesignation !== designationFilter) return false;
    if (deptFilter && String(r.departmentId) !== deptFilter) return false;
    if (dealingFilter && r.dealingUserId && String(r.dealingUserId) !== dealingFilter) return false;
    if (q.trim()) {
      const hay = [r.courseName, r.chiefGuideName, r.chiefGuideDesignation, r.departmentName, r.chiefGuideMobile, r.chiefGuideEmail]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  return (
    <Shell mode="app">
      <div className="dept-hero">
        <h1>Edit Chief Guide</h1>
      </div>
      <div className="card">
        <ErrorBox error={!editRow ? error : null} />
        {ok && <div className="okbox">{ok}</div>}
        <form
          className="filter-grid"
          onSubmit={(e) => {
            e.preventDefault();
            load(courseId).catch((err) => setError(err.message));
          }}
        >
          {staffMembers.length > 0 && (
            <Field label="Dealing">
              <select className="input" value={dealingFilter} onChange={(e) => setDealingFilter(e.target.value)}>
                <option value="">-- All Dealing --</option>
                {staffMembers.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name || s.email}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Name of Course">
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">-- All Course --</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn gold" type="submit">
            Search
          </button>
        </form>
        <div className="filter-grid" style={{ marginTop: 10 }}>
          <select
            className="input"
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            aria-label="Filter by designation"
          >
            <option value="">-- All Designations --</option>
            {designationOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            className="input"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">-- All Departments --</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Search by name, email, contact…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {hasFilters && (
            <button type="button" className="btn secondary small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <b>Total Thesis {visible.length}</b>
          <ExportButtons columns={cols} rows={visible} filename="chief-guides" />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Sr.No.</th>
              <th>Course</th>
              <th>ChiefGuideName</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Contact</th>
              <th>EmailId</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r._id}>
                <td>{i + 1}</td>
                <td>{r.courseName}</td>
                <td>{r.chiefGuideName || '—'}</td>
                <td>{r.chiefGuideDesignation || '—'}</td>
                <td>{r.departmentName}</td>
                <td>{r.chiefGuideMobile || '—'}</td>
                <td>{r.chiefGuideEmail || '—'}</td>
                <td>
                  <button className="icon-edit" type="button" title="Edit" onClick={() => openEdit(r)}>
                    ✎
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editRow && (
        <div className="modal-overlay guide-modal-overlay" onClick={() => setEditRow(null)}>
          <div className="guide-modal" onClick={(e) => e.stopPropagation()}>
            <button className="guide-modal-close" type="button" aria-label="Close" onClick={() => setEditRow(null)}>
              ×
            </button>
            <div className="guide-modal-side">
              <div className="guide-modal-icon" aria-hidden>
                <svg viewBox="0 0 64 64" width="56" height="56" fill="none">
                  <rect x="15" y="13" width="34" height="42" rx="5" stroke="#111827" strokeWidth="3" fill="#fff" fillOpacity="0.15" />
                  <path d="M25 13V10a2.5 2.5 0 0 1 2.5-2.5h7a2.5 2.5 0 0 1 2.5 2.5v3" stroke="#111827" strokeWidth="3" strokeLinecap="round" />
                  <path d="M23 35l6 6 12-12" stroke="#111827" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p>Please fill all fields to add detail</p>
              <span className="guide-modal-next">›</span>
            </div>
            <form className="guide-modal-form" onSubmit={save}>
              <h2>Add Chief Guide</h2>
              <p className="guide-modal-req">All fields are mandatory</p>
              <ErrorBox error={error} />
              <div className="guide-form-grid">
                <GuideField label="Name of Chief Guide" required error={fieldErr.name}>
                  <input
                    className="input"
                    placeholder="Enter Name of Chief Guide"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </GuideField>
                <GuideField label="Designation of Chief Guide" required error={fieldErr.designation}>
                  <div className="guide-select-plus">
                    <select
                      className="input"
                      value={form.designation}
                      onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    >
                      <option value="">Select designation</option>
                      {designations.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="plus-btn"
                      title="Add designation"
                      onClick={() => {
                        setPlusKind((k) => (k === 'designation' ? null : 'designation'));
                        setPlusValue('');
                      }}
                    >
                      +
                    </button>
                  </div>
                </GuideField>
                <GuideField label="Department of Chief Guide" required error={fieldErr.departmentId}>
                  <div className="guide-select-plus">
                    <select
                      className="input"
                      value={form.departmentId}
                      onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    >
                      <option value="">Select department</option>
                      {depts.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="plus-btn"
                      title="Add department"
                      onClick={() => {
                        setPlusKind((k) => (k === 'department' ? null : 'department'));
                        setPlusValue('');
                      }}
                    >
                      +
                    </button>
                  </div>
                </GuideField>
                <GuideField label="Mobile No. of Chief Guide" required error={fieldErr.mobile}>
                  <input
                    className="input"
                    placeholder="Enter Mobile No. of Chief Guide"
                    value={form.mobile}
                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  />
                </GuideField>
                <GuideField label="Email Id of Chief Guide" required error={fieldErr.email}>
                  <input
                    className="input"
                    type="email"
                    placeholder="Enter Email Id of Chief Guide"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </GuideField>
                <GuideField label="Alternate Mobile No. of Chief Guide" error={fieldErr.alternateMobile}>
                  <input
                    className="input"
                    placeholder="Enter Alternate Mobile No. of Chief Guide"
                    value={form.alternateMobile}
                    onChange={(e) => setForm({ ...form, alternateMobile: e.target.value })}
                  />
                </GuideField>
                <GuideField label="Alternate Email Id of Chief Guide" error={fieldErr.alternateEmail}>
                  <input
                    className="input"
                    type="email"
                    placeholder="Enter Alternate Email Id of Chief Guide"
                    value={form.alternateEmail}
                    onChange={(e) => setForm({ ...form, alternateEmail: e.target.value })}
                  />
                </GuideField>
              </div>
              {plusKind === 'designation' && (
                <div className="guide-inline-add">
                  <input
                    className="input"
                    placeholder="New designation"
                    value={plusValue}
                    onChange={(e) => setPlusValue(e.target.value)}
                    style={{ maxWidth: 260 }}
                  />
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      const v = plusValue.trim();
                      if (!v) return;
                      setDesignations((d) => [...new Set([...d, v])]);
                      setForm((f) => ({ ...f, designation: v }));
                      setPlusKind(null);
                    }}
                  >
                    Add
                  </button>
                  <button type="button" className="btn small secondary" onClick={() => setPlusKind(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {plusKind === 'department' && (
                <div className="guide-inline-add">
                  <input
                    className="input"
                    placeholder="New department name"
                    value={plusValue}
                    onChange={(e) => setPlusValue(e.target.value)}
                    style={{ maxWidth: 260 }}
                  />
                  <button
                    type="button"
                    className="btn small"
                    onClick={async () => {
                      const v = plusValue.trim();
                      if (!v) return;
                      try {
                        const created = await post('/masters/departments', { name: v });
                        setDepts((d) => [...d, created]);
                        setForm((f) => ({ ...f, departmentId: created._id }));
                        setPlusKind(null);
                      } catch (err: any) {
                        setError(err.message);
                      }
                    }}
                  >
                    Add
                  </button>
                  <button type="button" className="btn small secondary" onClick={() => setPlusKind(null)}>
                    Cancel
                  </button>
                </div>
              )}
              <div className="guide-modal-actions">
                <button className="btn guide-submit" type="submit">
                  Submit
                </button>
                <button className="btn guide-reset" type="button" onClick={resetForm}>
                  Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}

const REPORTS: Record<string, { title: string; bucket: 'added' | 'submitted'; a4: boolean; file: string }> = {
  'not-submitted-excel': { title: 'Not Submitted', bucket: 'added', a4: false, file: 'not-submitted' },
  'not-submitted-a4': { title: 'Not Submitted', bucket: 'added', a4: true, file: 'not-submitted' },
  'submitted-excel': { title: 'Submitted', bucket: 'submitted', a4: false, file: 'submitted' },
  'submitted-a4': { title: 'Submitted', bucket: 'submitted', a4: true, file: 'submitted' },
};

export function DeptReportsPage() {
  const { kind = 'not-submitted-excel' } = useParams();
  const spec = REPORTS[kind] || REPORTS['not-submitted-excel'];
  const [rows, setRows] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [courseId, setCourseId] = useState('');
  const [printRow, setPrintRow] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  const [deptFilter, setDeptFilter] = useState('');
  const [q, setQ] = useState('');
  async function load(next = courseId, nextMonth = month, nextYear = year) {
    setError(null);
    const params = applySessionParams(new URLSearchParams({ kind: spec.bucket }), nextMonth, nextYear);
    if (next) params.set('courseId', next);
    const data = await get(`/files/department-report?${params}`);
    setRows(Array.isArray(data) ? data : []);
  }
  useEffect(() => {
    get('/masters/courses')
      .then((list) => setCourses(Array.isArray(list) ? list : []))
      .catch(() => setCourses([]));
  }, [kind]);
  useEffect(() => {
    if (!ready) return;
    load(courseId).catch((e) => setError(e.message || 'Failed to load report'));
  }, [kind, ready, month, year]);
  const cols = [
    { key: 'courseTypeName', label: 'Course type' },
    { key: 'courseName', label: 'Course' },
    { key: 'departmentName', label: 'DepartmentName' },
    { key: 'candidateName', label: 'Candidate' },
    { key: 'enrollmentNo', label: 'EnrollmentNo' },
    { key: 'specialityName', label: 'SpecialityName' },
    { key: 'dob', label: 'DOB' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'email', label: 'EmailId' },
    { key: 'title', label: 'TitleThesis' },
  ];
  const exportRows = rows.map((r) => ({
    courseTypeName: r.courseTypeName,
    enrollmentNo: r.candidate?.enrollmentNo,
    courseName: r.courseName,
    specialityName: r.specialityName,
    departmentName: r.departmentName,
    candidateName: r.candidate?.name,
    dob: r.candidate?.dob,
    mobile: r.candidate?.mobile,
    email: r.candidate?.email,
    title: r.title,
  }));

  // Derive department options from loaded rows
  const deptOptions = Array.from(
    new Map(
      rows
        .filter((r) => r.departmentId && r.departmentName)
        .map((r) => [String(r.departmentId), r.departmentName as string]),
    ).entries(),
  ).map(([id, name]) => ({ id, name }));

  const hasFilters = Boolean(q.trim() || deptFilter);

  function clearFilters() {
    setQ('');
    setDeptFilter('');
  }

  const visible = rows.filter((r) => {
    if (deptFilter && String(r.departmentId) !== deptFilter) return false;
    if (q.trim()) {
      const hay = [r.candidate?.enrollmentNo, r.candidate?.name, r.candidate?.email, r.courseName, r.departmentName, r.specialityName]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }).sort(compareByCourseThenCandidate);

  const filteredExportRows = visible.map((r) => ({
    courseTypeName: r.courseTypeName,
    enrollmentNo: r.candidate?.enrollmentNo,
    courseName: r.courseName,
    specialityName: r.specialityName,
    departmentName: r.departmentName,
    candidateName: r.candidate?.name,
    dob: r.candidate?.dob,
    mobile: r.candidate?.mobile,
    email: r.candidate?.email,
    title: r.title,
  }));
  if (printRow) {
    return (
      <Shell mode="app">
        <div className="print-a4">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn secondary small no-print" type="button" onClick={() => setPrintRow(null)}>
              Back
            </button>
            <button className="btn small no-print" type="button" onClick={() => window.print()}>
              Print
            </button>
          </div>
          <p className="print-date">Date: {new Date().toLocaleString('en-IN')}</p>
          <h2>{spec.title}</h2>
          <dl className="print-dl">
            <dt>Session</dt>
            <dd>{printRow.sessionName}</dd>
            <dt>Enrollment No.</dt>
            <dd>{printRow.candidate?.enrollmentNo}</dd>
            <dt>Name of Course</dt>
            <dd>{printRow.courseName}</dd>
            <dt>Name of Speciality</dt>
            <dd>{printRow.specialityName}</dd>
            <dt>Name of Department</dt>
            <dd>{printRow.departmentName}</dd>
            <dt>Name of Candidate</dt>
            <dd>{printRow.candidate?.name}</dd>
            <dt>DOB of Candidate</dt>
            <dd>{printRow.candidate?.dob}</dd>
            <dt>Mobile No. of Candidate</dt>
            <dd>{printRow.candidate?.mobile}</dd>
            <dt>Email Id of Candidate</dt>
            <dd>{printRow.candidate?.email}</dd>
            <dt>Thesis title</dt>
            <dd>{printRow.title || '—'}</dd>
            <dt>Submission On</dt>
            <dd>{formatDate(printRow.createdAt)}</dd>
          </dl>
        </div>
      </Shell>
    );
  }
  return (
    <Shell mode="app">
      <div className="dept-hero">
        <h1>{spec.title}</h1>
      </div>
      <div className="card">
        <ErrorBox error={error} />
        <form
          className="filter-grid"
          onSubmit={(e) => {
            e.preventDefault();
            load(courseId).catch((err) => setError(err.message));
          }}
        >
          <Field label="Name of Course">
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">-- All Course --</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <SessionFilter sessions={sessions} month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
          <button className="btn gold" type="submit">
            Search
          </button>
        </form>
        {/* Client-side filters */}
        <div className="filter-grid" style={{ marginTop: 8 }}>
          <select
            className="input"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">-- All Departments --</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Search by name, enrollment, speciality…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {hasFilters && (
            <button type="button" className="btn secondary small" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <b>Total {visible.length}</b>
          {!spec.a4 && <ExportButtons columns={cols} rows={filteredExportRows} filename={spec.file} />}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Sr.No.</th>
              <th>Course type</th>
              <th>Course</th>
              <th>DepartmentName</th>
              <th>Candidate</th>
              <th>EnrollmentNo</th>
              <th>SpecialityName</th>
              <th>DOB</th>
              <th>Mobile</th>
              <th>EmailId</th>
              <th>TitleThesis</th>
              {spec.a4 && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r._id}>
                <td>{i + 1}</td>
                <td>{r.courseTypeName || '—'}</td>
                <td>{r.courseName}</td>
                <td>{r.departmentName}</td>
                <td>{r.candidate?.name}</td>
                <td>{r.candidate?.enrollmentNo}</td>
                <td>{r.specialityName}</td>
                <td>{r.candidate?.dob}</td>
                <td>{r.candidate?.mobile}</td>
                <td>{r.candidate?.email}</td>
                <td>{r.title || '—'}</td>
                {spec.a4 && (
                  <td>
                    <button className="link" type="button" onClick={() => setPrintRow(r)}>
                      Print
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
