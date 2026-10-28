import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Shell } from '../../components/Shell';
import { Empty, ErrorBox, ExportButtons, Field } from '../../components/ui';
import { SessionFilter } from '../../components/SessionFilter';
import { applySessionParams, useSessionFilter } from '../../session';
import { RevisionLetterPrint, type RevisionLetterDoc } from '../../components/RevisionLetterPrint';

type LetterKindFilter = 'CG' | 'EXAMINER';

const EXPORT_COLS = [
  { key: 'thesisNumber', label: 'Thesis no.' },
  { key: 'courseName', label: 'Course' },
  { key: 'specialityName', label: 'Speciality' },
  { key: 'candidateName', label: 'Candidate' },
  { key: 'examinerName', label: 'Examiner' },
  { key: 'examinerDesignation', label: 'Designation' },
];

export function ApprovedLettersPage() {
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  const [kind, setKind] = useState<LetterKindFilter>('CG');
  const [courseId, setCourseId] = useState('');
  const [specialityId, setSpecialityId] = useState('');
  const [courses, setCourses] = useState<any[]>([]);
  const [specialities, setSpecialities] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [printDocs, setPrintDocs] = useState<RevisionLetterDoc[] | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

  const specsForCourse = specialities.filter((s) => {
    if (!courseId) return true;
    return !s.courseId || String(s.courseId) === String(courseId);
  });

  function load(next?: { kind?: LetterKindFilter; month?: string; year?: string; courseId?: string; specialityId?: string }) {
    const curKind = next?.kind ?? kind;
    const curMonth = next?.month !== undefined ? next.month : month;
    const curYear = next?.year !== undefined ? next.year : year;
    const curCourse = next?.courseId !== undefined ? next.courseId : courseId;
    const curSpec = next?.specialityId !== undefined ? next.specialityId : specialityId;
    const params = applySessionParams(new URLSearchParams(), curMonth, curYear);
    params.set('kind', curKind);
    if (curCourse) params.set('courseId', curCourse);
    if (curSpec) params.set('specialityId', curSpec);
    setLoading(true);
    setError(null);
    get(`/files/approved-letters?${params.toString()}`)
      .then((data) => {
        setItems(Array.isArray(data?.items) ? data.items : []);
        setSelected([]);
      })
      .catch((e: any) => setError(e.message || 'Could not load approved letters'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    get('/masters/courses')
      .then((c) => setCourses(Array.isArray(c) ? c : []))
      .catch(() => setCourses([]));
    get('/masters/specialities')
      .then((s) => setSpecialities(Array.isArray(s) ? s : []))
      .catch(() => setSpecialities([]));
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, month, year, kind, courseId, specialityId]);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleAll() {
    if (selected.length === items.length) setSelected([]);
    else setSelected(items.map((r) => r.id));
  }

  async function printSelected() {
    const rows = items.filter((r) => selected.includes(r.id));
    if (!rows.length) {
      setError('Tick at least one row to print');
      return;
    }
    setPrintBusy(true);
    setError(null);
    try {
      const letters = await Promise.all(
        rows.map((r) =>
          get(`/files/${r.fileId}/letters/revision?kind=${kind}&panelIndex=${r.panelIndex}`),
        ),
      );
      setPrintDocs(letters);
    } catch (e: any) {
      setError(e.message || 'Could not load letters');
    } finally {
      setPrintBusy(false);
    }
  }

  const title =
    kind === 'EXAMINER' ? 'Examiner revised thesis letter (approved AD)' : 'Chief Guide revision letter (approved AD)';

  return (
    <Shell mode="app">
      <div className="page-head">
        <div>
          <h1>Download approved letter</h1>
          <p className="guide-muted">Print Assoc Dean–approved revision letters. This does not send mail.</p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <Field label="Session">
            <SessionFilter
              sessions={sessions}
              month={month}
              year={year}
              onChange={(m, y) => {
                setMonth(m);
                setYear(y);
              }}
            />
          </Field>
          <Field label="Letter type">
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value === 'EXAMINER' ? 'EXAMINER' : 'CG')}
            >
              <option value="CG">Chief Guide revision letter (approved AD)</option>
              <option value="EXAMINER">Examiner revised thesis letter (approved AD)</option>
            </select>
          </Field>
          <Field label="Course">
            <select
              className="input"
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setSpecialityId('');
              }}
            >
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Speciality">
            <select className="input" value={specialityId} onChange={(e) => setSpecialityId(e.target.value)}>
              <option value="">All specialities</option>
              {specsForCourse.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <div className="files-toolbar" style={{ marginBottom: 12 }}>
          <b>
            {title}: {items.length}
            {loading ? ' (loading…)' : ''}
          </b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ExportButtons columns={EXPORT_COLS} rows={items} filename="approved-revision-letters" title={title} />
            <button type="button" className="btn small" disabled={printBusy || !selected.length} onClick={printSelected}>
              {printBusy ? 'Loading letters…' : 'Print letter'}
            </button>
          </div>
        </div>
        {!items.length ? (
          <Empty>No approved revision letters in this session.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.length === items.length}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Thesis no.</th>
                  <th>Course</th>
                  <th>Speciality</th>
                  <th>Candidate</th>
                  <th>Examiner</th>
                  <th>Designation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.candidateName || row.thesisNumber}`}
                      />
                    </td>
                    <td>{row.thesisNumber || '—'}</td>
                    <td>{row.courseName || '—'}</td>
                    <td>{row.specialityName || '—'}</td>
                    <td>{row.candidateName || '—'}</td>
                    <td>{row.examinerName || '—'}</td>
                    <td>{row.examinerDesignation || '—'}</td>
                    <td>
                      <Link className="btn small secondary" to={`/app/files/${row.fileId}`}>
                        File 360
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {printDocs ? <RevisionLetterPrint letters={printDocs} onClose={() => setPrintDocs(null)} /> : null}
    </Shell>
  );
}
