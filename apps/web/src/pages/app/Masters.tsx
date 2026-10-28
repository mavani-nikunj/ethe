import { FormEvent, useEffect, useState } from 'react';
import { get, post, patch, del } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, Pill, ConfirmDialog } from '../../components/ui';
import { notifySessionChanged } from '../../session';
import { isCourseRole, roleLabel, isValidEmail, isValidMobile, cleanMobile } from '@ethesis/shared';

const KINDS = [
  { key: 'departments', label: 'Departments', fields: ['name', 'code'] },
  { key: 'course-types', label: 'Course types', fields: ['name', 'code'] },
  { key: 'courses', label: 'Courses', fields: ['name', 'code'] },
  { key: 'specialities', label: 'Specialities', fields: ['name'] },
  { key: 'sessions', label: 'Sessions', fields: ['month', 'year'] },
  { key: 'geo-buckets', label: 'Geography buckets', fields: ['label', 'code'] },
  { key: 'role-labels', label: 'Role labels', fields: ['systemRole', 'code', 'label'] },
];

export function MastersPage() {
  const [kind, setKind] = useState('departments');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [courseTypes, setCourseTypes] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingActive, setPendingActive] = useState<any>(null);
  const spec = KINDS.find((k) => k.key === kind)!;

  const extraHeaders =
    kind === 'courses'
      ? ['type', 'department']
      : kind === 'course-types'
        ? ['courses', 'blueprint']
        : kind === 'specialities'
          ? ['type', 'course']
          : kind === 'sessions'
            ? ['status']
            : [];

  async function load(k = kind) {
    setRows(await get(`/masters/${k}`));
    if (k === 'courses' || k === 'specialities' || k === 'course-types' || k === 'geo-buckets') {
      const [types, courseRows, depts] = await Promise.all([
        get('/masters/course-types'),
        get('/masters/courses'),
        get('/masters/departments'),
      ]);
      setCourseTypes(types);
      setCourses(courseRows);
      setDepartments(depts);
    }
  }
  useEffect(() => {
    load(kind);
    setForm({});
    setEditingId(null);
    setError(null);
  }, [kind]);

  function startEdit(row: any) {
    setEditingId(row._id);
    setError(null);
    const next: any = {};
    for (const f of spec.fields) next[f] = row[f] ?? '';
    if (row.courseTypeId) next.courseTypeId = String(row.courseTypeId);
    if (row.departmentId) next.departmentId = String(row.departmentId);
    if (row.courseId) next.courseId = String(row.courseId);
    setForm(next);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = { ...form };
    if (kind === 'specialities') delete payload.courseTypeId;
    try {
      setError(null);
      if (editingId) await patch(`/masters/${kind}/${editingId}`, payload);
      else await post(`/masters/${kind}`, payload);
      setForm({});
      setEditingId(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const filteredCourses = form.courseTypeId
    ? courses.filter((c) => String(c.courseTypeId) === String(form.courseTypeId))
    : courses;

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Masters</h1>
          <p>
            Create departments and courses here, then issue academic logins. Other lists (sessions, buckets) are consumed
            by thesis forms — they are not created inline.
          </p>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        {KINDS.map((k) => (
          <button key={k.key} className={`btn small ${kind === k.key ? '' : 'secondary'}`} onClick={() => setKind(k.key)}>
            {k.label}
          </button>
        ))}
        <button className={`btn small ${kind === 'staff' ? '' : 'secondary'}`} onClick={() => setKind('staff')}>
          Staff mapping
        </button>
      </div>
      {kind === 'staff' ? <StaffMaster /> : (
        <div className="grid cols-2">
          <form className="card" onSubmit={save}>
            <h3>{editingId ? `Edit ${spec.label}` : `Add ${spec.label}`}</h3>
            <ErrorBox error={error} />
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Edits and deletes are recorded in the activity log.</p>
            {kind === 'courses' ? (
              <div className="form-pair">
                <Field label="Course type" required>
                  <select
                    className="input"
                    value={form.courseTypeId || ''}
                    required
                    onChange={(e) => setForm({ ...form, courseTypeId: e.target.value, courseId: '' })}
                  >
                    <option value="">Select course type</option>
                    {courseTypes.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Department" required>
                  <select
                    className="input"
                    value={form.departmentId || ''}
                    required
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  >
                    <option value="">Select department</option>
                    {departments.map((d) => (
                      <option key={d._id} value={d._id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : kind === 'specialities' ? (
              <div className="form-pair">
                <Field label="Course type">
                  <select
                    className="input"
                    value={form.courseTypeId || ''}
                    onChange={(e) => setForm({ ...form, courseTypeId: e.target.value, courseId: '' })}
                  >
                    <option value="">Select course type</option>
                    {courseTypes.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Course" required>
                  <select
                    className="input"
                    value={form.courseId || ''}
                    required
                    onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                  >
                    <option value="">Select course</option>
                    {filteredCourses.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : kind === 'geo-buckets' ? (
              <Field label="Course type" required>
                <select
                  className="input"
                  value={form.courseTypeId || ''}
                  required
                  onChange={(e) => setForm({ ...form, courseTypeId: e.target.value, courseId: '' })}
                >
                  <option value="">Select course type</option>
                  {courseTypes.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {spec.fields.length > 1 ? (
              <div className="form-pair">
                {spec.fields.map((f) => (
                  <Field key={f} label={f}>
                    <input className="input" value={form[f] || ''} onChange={(e) => setForm({ ...form, [f]: f === 'year' ? Number(e.target.value) : e.target.value })} />
                  </Field>
                ))}
              </div>
            ) : (
              spec.fields.map((f) => (
                <Field key={f} label={f}>
                  <input className="input" value={form[f] || ''} onChange={(e) => setForm({ ...form, [f]: f === 'year' ? Number(e.target.value) : e.target.value })} />
                </Field>
              ))
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" type="submit">
                {editingId ? 'Save changes' : 'Save'}
              </button>
              {editingId && (
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm({});
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  {kind === 'geo-buckets' ? (
                    <>
                      <th>Course type</th>
                      <th>label</th>
                      <th>code</th>
                    </>
                  ) : (
                    spec.fields.map((f) => (
                      <th key={f}>{f}</th>
                    ))
                  )}
                  {extraHeaders.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => kind !== 'role-labels' || String(r.systemRole || r.code || '').toUpperCase() !== 'DEPARTMENT')
                  .map((r) => (
                  <tr key={r._id}>
                    {kind === 'geo-buckets' ? (
                      <>
                        <td>{r.courseTypeName || r.group || '—'}</td>
                        <td>{r.label || '—'}</td>
                        <td>{r.code || '—'}</td>
                      </>
                    ) : (
                      spec.fields.map((f) => {
                        const v = String(r[f] ?? '');
                        if (kind === 'role-labels' && f === 'systemRole' && (v === 'COURSE' || v === 'DEPARTMENT')) {
                          return <td key={f}>Academic</td>;
                        }
                        return <td key={f}>{v}</td>;
                      })
                    )}
                    {kind === 'sessions' && (
                      <td>
                        {r.current ? (
                          <span className="pill ok">Current</span>
                        ) : (
                          <button type="button" className="btn gold small" onClick={() => setPendingActive(r)}>
                            Active
                          </button>
                        )}
                      </td>
                    )}
                    {kind === 'courses' && (
                      <>
                        <td>{r.courseTypeName || '—'}</td>
                        <td>{r.departmentName || '—'}</td>
                      </>
                    )}
                    {kind === 'course-types' && (
                      <>
                        <td>{r.courseCount ?? 0}</td>
                        <td>{r.blueprintName || '—'}</td>
                      </>
                    )}
                    {kind === 'specialities' && (
                      <>
                        <td>{r.courseTypeName || '—'}</td>
                        <td>{r.courseName || '—'}</td>
                      </>
                    )}
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <button type="button" className="btn ghost small" onClick={() => startEdit(r)}>
                          Edit
                        </button>
                        <button
                          className="btn ghost small"
                          onClick={() => {
                            if (!confirm(`Delete this ${spec.label.replace(/s$/, '')}? This cannot be undone. The action is logged.`)) return;
                            del(`/masters/${kind}/${r._id}`).then(() => load()).catch((e: any) => setError(e?.message || 'Failed to delete'));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {pendingActive && (
        <ConfirmDialog
          title="Set academic session"
          message="Set this as the academic session for all logins?"
          detail={`${pendingActive.month} ${pendingActive.year}`}
          yesLabel="Active"
          onYes={() => {
            post('/masters/sessions/activate', { month: pendingActive.month, year: pendingActive.year })
              .then(() => {
                notifySessionChanged();
                setPendingActive(null);
                load();
              })
              .catch((err: any) => {
                setError(err.message);
                setPendingActive(null);
              });
          }}
          onNo={() => setPendingActive(null)}
        />
      )}
    </Shell>
  );
}

function canonicalSlot(slot?: string) {
  const raw = String(slot || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (raw === 'ASSOCIATE_DEAN' || raw === 'ASSOCDEAN' || raw === 'AD') return 'ASSOC_DEAN';
  return raw;
}

const emptyStaff = {
  name: '',
  email: '',
  role: 'COURSE',
  authoritySlot: '',
  status: 'INVITED',
  departmentIds: [] as string[],
  courseIds: [] as string[],
};

function StaffMaster() {
  const [rows, setRows] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [form, setForm] = useState<any>(emptyStaff);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [staffRows, deptRows, courseRows] = await Promise.all([
      get('/masters/staff'),
      get('/masters/departments'),
      get('/masters/courses'),
    ]);
    setRows(staffRows);
    setDepts(deptRows);
    setCourses(courseRows);
  }
  useEffect(() => {
    load();
  }, []);

  function startEdit(row: any) {
    setEditingId(row._id);
    setInvite(null);
    setError(null);
    setForm({
      name: row.name || '',
      email: row.email || '',
      role: row.role || 'COURSE',
      authoritySlot: canonicalSlot(row.authoritySlot),
      status: row.status || 'ACTIVE',
      departmentIds: (row.departmentIds || []).map((id: any) => String(id)),
      courseIds: (row.courseIds || []).map((id: any) => String(id)),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function resetPassword(row: any) {
    if (!confirm(`Reset password for ${row.email} to Welcome@123?`)) return;
    setError(null);
    try {
      const res = await post(`/masters/staff/${row._id}/reset-password`, {});
      setInvite({ user: { email: res.email }, tempPassword: res.tempPassword });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeRow(row: any) {
    if (!confirm(`Delete staff login ${row.name} (${row.email})? This cannot be undone. The action is logged.`)) return;
    setError(null);
    try {
      await del(`/masters/staff/${row._id}`);
      if (editingId === row._id) {
        setEditingId(null);
        setForm(emptyStaff);
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="staff-split">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            if (isCourseRole(form.role)) {
              if (!(form.courseIds || []).length) {
                setError('Map this login to at least one course');
                return;
              }
            } else if (!['ACADEMIC', 'TRAVEL', 'DEALING', 'AUTHORITY'].includes(form.role) && !(form.departmentIds || []).length) {
              setError('Select at least one department');
              return;
            }
            if (editingId) {
              await patch(`/masters/staff/${editingId}`, form);
              setEditingId(null);
              setForm(emptyStaff);
              setInvite(null);
            } else {
              setInvite(await post('/masters/staff', form));
              setForm(emptyStaff);
            }
            await load();
          } catch (err: any) {
            setError(err.message);
          }
        }}
      >
        <h3>{editingId ? 'Update staff login' : 'Map a staff user'}</h3>
        <ErrorBox error={error} />
        {invite && (
          <div className="okbox">
            {invite.user?.email} — temporary password: <b>{invite.tempPassword}</b>
          </div>
        )}
        <div className="grid cols-3">
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email" required>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, authoritySlot: e.target.value === 'AUTHORITY' ? form.authoritySlot : '' })}>
              <option value="COURSE">Academic</option>
              <option value="DEALING">DEALING</option>
              <option value="AUTHORITY">AUTHORITY</option>
              <option value="ACADEMIC">Academic Section</option>
              <option value="TRAVEL">Travel Manager</option>
              <option value="INSTITUTE_ADMIN">INSTITUTE_ADMIN</option>
            </select>
          </Field>
          <Field label="Authority slot (if AUTHORITY)">
            <select value={form.authoritySlot} onChange={(e) => setForm({ ...form, authoritySlot: e.target.value })}>
              <option value="">Select slot</option>
              <option value="ACE">ACE</option>
              <option value="AO">AO</option>
              <option value="ASSOC_DEAN">Associate Dean</option>
            </select>
          </Field>
          {editingId && (
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="INVITED">INVITED</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="DISABLED">DISABLED</option>
              </select>
            </Field>
          )}
          {isCourseRole(form.role) || form.role === 'DEALING' || form.role === 'AUTHORITY' ? (
            <div className="field">
              <span>
                Courses
                {isCourseRole(form.role) && <span className="req"> *</span>}
              </span>
              <div className="check-list">
                {courses.length ? (
                  courses.map((c) => {
                    const id = String(c._id);
                    const checked = (form.courseIds || []).includes(id);
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm({
                              ...form,
                              courseIds: checked
                                ? form.courseIds.filter((x: string) => x !== id)
                                : [...(form.courseIds || []), id],
                            })
                          }
                        />
                        {c.courseTypeName ? `${c.name} (${c.courseTypeName})` : c.name}
                      </label>
                    );
                  })
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Add courses in Masters first.</span>
                )}
              </div>
              <span className="field-hint">
                {form.role === 'DEALING'
                  ? 'Tick the courses this Dealing login handles (practical boards are limited to them). Leave all unticked for every course.'
                  : form.role === 'AUTHORITY' && form.authoritySlot === 'ASSOC_DEAN'
                    ? 'The Associate Dean approves practical examiners and sees eligible candidates only for the courses ticked here (none ticked = none).'
                    : form.role === 'AUTHORITY'
                      ? 'Limits Practical Examiner and Eligible Candidate work to the ticked courses. Leave all unticked for every course.'
                      : 'Tick every course this login should see. One email can cover multiple courses.'}
              </span>
            </div>
          ) : form.role === 'ACADEMIC' || form.role === 'TRAVEL' ? (
            <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
              {form.role === 'TRAVEL' ? 'Travel Manager' : 'Academic Section'} does not need a course or department mapping.
            </p>
          ) : (
            <div className="field">
              <span>
                Departments
                <span className="req"> *</span>
              </span>
              <div className="check-list">
                {depts.length ? (
                  depts.map((d) => {
                    const id = String(d._id);
                    const checked = form.departmentIds.includes(id);
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm({
                              ...form,
                              departmentIds: checked
                                ? form.departmentIds.filter((x: string) => x !== id)
                                : [...form.departmentIds, id],
                            })
                          }
                        />
                        {d.name}
                      </label>
                    );
                  })
                ) : (
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Add departments in Masters first.</span>
                )}
              </div>
              <span className="field-hint">
                Tick every department this login should see. One email can cover multiple departments.
              </span>
            </div>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" type="submit">
            {editingId ? 'Save changes' : 'Create staff login'}
          </button>
          {editingId && (
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyStaff);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      <div className="card staff-grid-card">
        <h3 style={{ marginBottom: 10 }}>Staff logins</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Slot</th>
              <th>Password</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td>
                  {r.name}
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email}</div>
                </td>
                <td>{roleLabel(r.role)}</td>
                <td>{r.authoritySlot || '—'}</td>
                <td>
                  <div>
                    {r.mustChangePassword && r.tempPassword ? (
                      <code>{r.tempPassword}</code>
                    ) : r.mustChangePassword ? (
                      <code>Welcome@123</code>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>Set by user</span>
                    )}
                  </div>
                  <button type="button" className="link" onClick={() => resetPassword(r)}>
                    Reset to default
                  </button>
                </td>
                <td>
                  <Pill status={r.status} />
                </td>
                <td>
                  <div className="row">
                    <button type="button" className="btn secondary small" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                    <button type="button" className="btn ghost small" onClick={() => removeRow(r)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const emptyFaculty = {
  name: '',
  email: '',
  mobile: '',
  designation: '',
  employeeId: '',
  qualification: '',
  specialization: '',
  affiliation: '',
  registrationNo: '',
  city: '',
  bucketCode: '',
  canGuide: true,
};

export function PeoplePage({ kind }: { kind: 'faculty' | 'examiners' }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [form, setForm] = useState<any>(emptyFaculty);
  const path = kind === 'faculty' ? '/masters/faculty' : '/masters/examiners';
  const faculty = kind === 'faculty';

  async function load() {
    setRows(await get(path));
  }
  useEffect(() => {
    load();
  }, [kind]);

  const visible = rows.filter((r) => {
    if (!q.trim()) return true;
    const hay = [r.name, r.email, r.mobile, r.designation, r.employeeId, r.qualification, r.specialization, r.affiliation, r.registrationNo, r.city]
      .join(' ')
      .toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{faculty ? 'Guides / faculty' : 'Examiner pool'}</h1>
          <p>{faculty ? 'Add the guide details above. Search and remove records from the list below.' : 'Examiner directory for this institute.'}</p>
        </div>
      </div>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.name.trim()) {
            setError('Name is required');
            return;
          }
          if (!isValidEmail(form.email)) {
            setError('Please enter a valid email address');
            return;
          }
          let cleanMob = '';
          if (form.mobile && form.mobile.trim() !== '') {
            cleanMob = cleanMobile(form.mobile);
            if (!isValidMobile(cleanMob)) {
              setError('Mobile must be a valid 10-digit Indian number starting with 6-9');
              return;
            }
          }
          setError(null);
          setBusy(true);
          try {
            await post(path, { ...form, mobile: cleanMob || undefined, canGuide: true });
            setForm(emptyFaculty);
            await load();
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>Add details</h3>
        <ErrorBox error={error} />
        <div className="form-pair">
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email" required>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} required />
            {form.email.trim() && !isValidEmail(form.email) && (
              <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                Please enter a valid email address
              </span>
            )}
          </Field>
          <Field label="Mobile">
            <input
              className="input"
              maxLength={10}
              placeholder="10-digit mobile"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            />
            {form.mobile && !isValidMobile(form.mobile) && (
              <span className="field-hint" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>
                Must be 10 digits starting with 6, 7, 8, or 9
              </span>
            )}
          </Field>
          <Field label="Designation">
            <input className="input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          </Field>
          {faculty && (
            <>
              <Field label="Employee / faculty ID">
                <input className="input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
              </Field>
              <Field label="Qualification">
                <input className="input" value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} />
              </Field>
              <Field label="Specialization">
                <input className="input" value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} />
              </Field>
              <Field label="Registration no.">
                <input className="input" value={form.registrationNo} onChange={(e) => setForm({ ...form, registrationNo: e.target.value })} />
              </Field>
              <Field label="Affiliation">
                <input className="input" value={form.affiliation} onChange={(e) => setForm({ ...form, affiliation: e.target.value })} />
              </Field>
              <Field label="City">
                <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
            </>
          )}
          {kind === 'examiners' && (
            <>
              <Field label="Affiliation">
                <input className="input" value={form.affiliation} onChange={(e) => setForm({ ...form, affiliation: e.target.value })} />
              </Field>
              <Field label="Bucket code">
                <input className="input" value={form.bucketCode} onChange={(e) => setForm({ ...form, bucketCode: e.target.value })} />
              </Field>
            </>
          )}
        </div>
        <button className="btn" style={{ marginTop: 12 }} type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Add'}
        </button>
      </form>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            className="input table-filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, mobile, designation…"
          />
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>{visible.length} of {rows.length}</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Designation</th>
                {faculty ? (
                  <>
                    <th>Emp. ID</th>
                    <th>Qualification</th>
                    <th>Specialization</th>
                    <th>Reg. no.</th>
                    <th>Affiliation</th>
                    <th>City</th>
                  </>
                ) : (
                  <th>Bucket</th>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={faculty ? 11 : 6} style={{ color: 'var(--muted)' }}>
                    {rows.length === 0 ? 'No guides added yet.' : 'No matching records.'}
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <tr key={r._id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.mobile || '—'}</td>
                  <td>{r.designation || '—'}</td>
                  {faculty ? (
                    <>
                      <td>{r.employeeId || '—'}</td>
                      <td>{r.qualification || '—'}</td>
                      <td>{r.specialization || '—'}</td>
                      <td>{r.registrationNo || '—'}</td>
                      <td>{r.affiliation || '—'}</td>
                      <td>{r.city || '—'}</td>
                    </>
                  ) : (
                    <td>{r.bucketCode || '—'}</td>
                  )}
                  <td>
                    <button
                      className="btn ghost small"
                      onClick={async () => {
                        if (!confirm(`Delete ${r.name}? This cannot be undone. The action is logged.`)) return;
                        try {
                          await del(`${path}/${r._id}`);
                          await load();
                        } catch (err: any) {
                          setError(err.message);
                        }
                      }}
                    >
                      Delete
                    </button>
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
