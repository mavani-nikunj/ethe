import { FormEvent, useEffect, useMemo, useState } from 'react';
import { MONTHS } from '../../../dept';
import { get, post } from '../../../api';
import { useAuth } from '../../../auth';
import { Shell } from '../../../components/Shell';
import { ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { ExaminerEditDialog, ListInput, PracticalMeta, PracticalRow, usePracticalMeta } from './common';

const PAGE = 25;

/** Download Examiner Details: every examiner entered across all sessions, filtered by type. */
export function PracticalExaminersPage() {
  const { meta } = usePracticalMeta();
  const [type, setType] = useState('');
  const [rows, setRows] = useState<PracticalRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PracticalRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(t = type) {
    if (!t) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await get<PracticalRow[]>(`/practical/history?type=${t}`));
      setPage(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(type);
  }, [type]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.mobile, r.courseName, r.specialityName, r.instituteName, r.department].join(' ').toLowerCase().includes(q),
    );
  }, [rows, search]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const safePage = Math.min(page, pages);
  const pageRows = shown.slice((safePage - 1) * PAGE, safePage * PAGE);

  const cols = [
    { key: 'courseName', label: 'Course Name' },
    { key: 'specialityName', label: 'Speciality' },
    { key: 'name', label: 'Examiner Name' },
    { key: 'designation', label: 'Designation' },
    { key: 'department', label: 'Department Name' },
    { key: 'instituteName', label: 'Institute Name' },
    { key: 'instituteAddress', label: 'Institute Address' },
    { key: 'mobile', label: 'Mobile Number' },
    { key: 'email', label: 'Email Id' },
    { key: 'examMonth', label: 'Exam Month' },
    { key: 'examYear', label: 'Exam Year' },
  ];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...Object.fromEntries(cols.map((c) => [c.key, (r as any)[c.key] ?? ''])) }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Download Examiner</h1>
          <p>All examiners entered in earlier and current sessions. Pick a type to list them; edit to correct contact details.</p>
        </div>
        {meta?.can.edit ? (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add Examiner
          </button>
        ) : null}
      </div>
      <ErrorBox error={error} />
      {notice ? <div className="practical-notice">{notice}</div> : null}
      <div className="card">
        <div className="practical-inline">
          <label className="field" style={{ margin: 0, minWidth: 280 }}>
            <span>Select Examiner Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">-- Select Examiner --</option>
              {(meta?.types || []).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="practical-toolbar" style={{ marginTop: 12 }}>
          <h3 className="practical-total">
            Total Examiner <span className="practical-count">{shown.length}</span>
          </h3>
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={[{ key: 'sr', label: 'Sr.No.' }, ...cols]} rows={exportRows} filename="practical-examiners" title="Download Examiner" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : pageRows.length ? (
          <div className="table-scroll">
            <table className={`table${meta?.can.edit ? '' : ' practical-nopin'}`}>
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  {cols.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  {meta?.can.edit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r._id}>
                    <td>{(safePage - 1) * PAGE + i + 1}</td>
                    {cols.map((c) => (
                      <td key={c.key}>{(r as any)[c.key]}</td>
                    ))}
                    {meta?.can.edit ? (
                      <td>
                        <button type="button" className="btn small secondary" onClick={() => setEditing(r)}>
                          Edit
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{type ? 'No examiners of this type yet.' : 'Select an examiner type.'}</p>
        )}
        {pages > 1 ? (
          <div className="pager">
            <button type="button" className="btn small secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              Previous
            </button>
            <span className="pager-meta">
              Page {safePage} of {pages}
            </span>
            <button type="button" className="btn small secondary" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>
              Next
            </button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <ExaminerEditDialog
          id={editing._id}
          basePath={editing.source === 'detail' ? '/practical/examiner-details' : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
      {adding && meta ? (
        <AddExaminerDialog
          meta={meta}
          defaultType={type}
          onClose={() => setAdding(false)}
          onSaved={(savedType) => {
            setAdding(false);
            setNotice('Examiner added. Send the board to the Assoc. Dean from "Assigned Examiner Send to Assoc. Dean".');
            if (savedType === type) load(type);
            else setType(savedType);
          }}
        />
      ) : null}
    </Shell>
  );
}

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

const OTHER = '__other__';

/**
 * Same "Appointment Form" as Appointment of Examiner, opened from Download Examiner.
 * An examiner always sits on a speciality board, so session / course / speciality are picked first.
 */
function AddExaminerDialog({
  meta,
  defaultType,
  onClose,
  onSaved,
}: {
  meta: PracticalMeta;
  defaultType: string;
  onClose: () => void;
  onSaved: (type: string) => void;
}) {
  const { user } = useAuth();
  const homeInstitute = user?.institute?.name || '';
  const blank = (type = ''): ExaminerForm => ({
    type,
    pick: '',
    facultyId: '',
    name: '',
    designation: '',
    department: '',
    instituteName: type === 'EXTERNAL' ? '' : homeInstitute,
    instituteAddress: '',
    city: '',
    mobile: '',
    email: '',
    alternateMobile: '',
    alternateEmail: '',
  });

  const current = meta.sessions.find((s) => s._id === meta.currentSessionId);
  const [month, setMonth] = useState(current && MONTHS.includes(current.month as any) ? current.month : '');
  const [year, setYear] = useState(current ? String(current.year) : '');
  const [courseId, setCourseId] = useState('');
  const [form, setForm] = useState<ExaminerForm>(blank(defaultType));
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [lookups, setLookups] = useState<Record<string, string[]>>({ DESIGNATION: [], DEPARTMENT: [] });
  const [addLookup, setAddLookup] = useState<{ kind: string; title: string } | null>(null);
  const [addValue, setAddValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [...new Set<number>([now - 1, now, now + 1, ...meta.sessions.map((s) => s.year)])].sort((a, b) => b - a);
  }, [meta.sessions]);
  const isExternal = form.type === 'EXTERNAL';
  const set = (k: keyof ExaminerForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    get('/practical/lookups').then(setLookups).catch(() => undefined);
  }, []);


  useEffect(() => {
    if (!form.type) {
      setSuggestions([]);
      return;
    }
    get<Suggestion[]>(`/practical/suggestions?type=${form.type}`)
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, [form.type]);

  function pickName(key: string) {
    if (key === OTHER) {
      setForm((f) => ({ ...f, pick: OTHER, facultyId: '', name: '' }));
      return;
    }
    const s = suggestions.find((x) => x.key === key);
    if (!s) {
      setForm((f) => ({ ...f, pick: '', facultyId: '', name: '' }));
      return;
    }
    setForm((f) => ({
      ...f,
      pick: key,
      facultyId: s.facultyId || '',
      name: s.name || '',
      designation: s.designation || f.designation,
      department: s.department || f.department,
      instituteName: s.instituteName || (f.type === 'EXTERNAL' ? '' : homeInstitute),
      instituteAddress: s.instituteAddress || f.instituteAddress,
      city: s.city || '',
      mobile: s.mobile || '',
      email: s.email || '',
      alternateMobile: s.alternateMobile || '',
      alternateEmail: s.alternateEmail || '',
    }));
  }

  async function saveLookup() {
    const value = addValue.trim();
    if (!addLookup || !value) return;
    try {
      await post('/practical/lookups', { kind: addLookup.kind, name: value });
      setLookups((l) => ({ ...l, [addLookup.kind]: [...new Set([...(l[addLookup.kind] || []), value])].sort() }));
      set(addLookup.kind === 'DESIGNATION' ? 'designation' : 'department', value);
    } catch (err: any) {
      setError(err.message);
    }
    setAddLookup(null);
    setAddValue('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!month || !year) return setError('Select Exam Month and Exam Year');
    if (!courseId) return setError('Select a Course');
    if (!form.type) return setError('Select an Examiner Type');
    if (!form.name.trim()) return setError('Select or enter the Name of Examiner');
    setBusy(true);
    try {
      await post('/practical/examiner-details', { ...form, month, year, courseId });
      onSaved(form.type);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const plus = (kind: string, title: string) => (
    <button
      type="button"
      className="practical-plus"
      title={title}
      aria-label={title}
      onClick={() => {
        setAddValue('');
        setAddLookup({ kind, title });
      }}
    >
      +
    </button>
  );

  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <form className="modal-card dialog-card practical-edit-card practical-add-card" role="dialog" aria-modal="true" onSubmit={submit}>
        <div className="practical-form-tag">Appointment Form</div>
        <ErrorBox error={error} />
        <div className="grid cols-3">
          <Field label="Exam Month" required>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">-- Select Month --</option>
              {MONTHS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Exam Year" required>
            <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">-- Select Year --</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </Field>
          <Field label="Course" required>
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">-- Select Course --</option>
              {meta.courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <Field label="Examiner Type" required>
            <select className="input" value={form.type} onChange={(e) => setForm(blank(e.target.value))}>
              <option value="">-- Select Examiner --</option>
              {meta.types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Institute Address" required>
            <input className="input" value={form.instituteAddress} onChange={(e) => set('instituteAddress', e.target.value)} />
          </Field>
          <Field label="Name of Examiner" required>
            <select className="input" value={form.pick} disabled={!form.type} onChange={(e) => pickName(e.target.value)}>
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
            {form.pick === OTHER ? (
              <input
                className="input"
                style={{ marginTop: 6 }}
                placeholder="Enter examiner name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            ) : null}
          </Field>
          <Field label="Mobile No." required>
            <input className="input" maxLength={10} inputMode="numeric" value={form.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Designation" required extra={plus('DESIGNATION', 'Add Designation')}>
            <ListInput value={form.designation} options={lookups.DESIGNATION || []} onChange={(v) => set('designation', v)} placeholder="-- Select Designation --" />
          </Field>
          <Field label="Email ID" required>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Department" required extra={plus('DEPARTMENT', 'Add Department')}>
            <ListInput value={form.department} options={lookups.DEPARTMENT || []} onChange={(v) => set('department', v)} placeholder="-- Select Department --" />
          </Field>
          <Field label="Alternate Mobile">
            <input
              className="input"
              maxLength={10}
              inputMode="numeric"
              value={form.alternateMobile}
              onChange={(e) => set('alternateMobile', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Institute Name" required>
            <input className="input" value={form.instituteName} onChange={(e) => set('instituteName', e.target.value)} />
          </Field>
          <Field label="Alternate Email Id">
            <input className="input" type="email" value={form.alternateEmail} onChange={(e) => set('alternateEmail', e.target.value)} />
          </Field>
          {isExternal ? (
            <Field label="City Name" required>
              <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
          ) : null}
        </div>
        {addLookup ? (
          <div className="practical-inline" style={{ marginTop: 12, alignItems: 'flex-end' }}>
            <Field label={addLookup.title} required>
              <input className="input" value={addValue} autoFocus onChange={(e) => setAddValue(e.target.value)} />
            </Field>
            <button type="button" className="btn small" disabled={!addValue.trim()} onClick={saveLookup}>
              Save
            </button>
            <button type="button" className="btn small secondary" onClick={() => setAddLookup(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}
