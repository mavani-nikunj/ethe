import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { MONTHS } from '../../../dept';
import { get, post } from '../../../api';
import { BulkResultDialog, type BulkResult } from '../practical/common';
import {
  CANDIDATE_COLUMNS,
  candidateCell,
  candidateQuery,
  searchRows,
  sessionLabel,
  sessionYears,
  useEligibleMeta,
  type CandidateFilters,
  type CandidateRow,
} from './common';

/** Previous Candidate (old header "Old Candidate"): bring candidates of a past session into the current one. */
export function EligiblePreviousPage() {
  const { meta, error: metaError } = useEligibleMeta();
  const [filters, setFilters] = useState<CandidateFilters>({ sessionId: '', courseId: '', specialityId: '' });
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  // Old screen: Session Month and Session Year as two separate dropdowns.
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');

  const current = meta?.sessions.find((s) => s._id === meta.currentSessionId) || null;
  const years = useMemo(() => sessionYears(meta?.sessions || []), [meta]);
  const specs = useMemo(
    () => (meta?.specialities || []).filter((s) => !filters.courseId || String(s.courseId) === filters.courseId),
    [meta, filters.courseId],
  );

  // Start on the latest earlier session, the usual source of re-appearing candidates.
  useEffect(() => {
    if (!meta || month || year) return;
    const past = meta.sessions.find((s) => s._id !== meta.currentSessionId);
    if (past) {
      setMonth(past.month);
      setYear(String(past.year));
    }
  }, [meta]);

  const shown = useMemo(() => searchRows(rows, search), [rows, search]);

  if (meta && !meta.can.edit) return <Navigate to="/app/eligible/eligible" replace />;

  async function load() {
    setError(null);
    if (!filters.courseId) {
      setError('Name of Course is required.');
      return;
    }
    if (!month || !year) {
      setError('Session Month and Session Year are required.');
      return;
    }
    const session = meta?.sessions.find((s) => s.month === month && String(s.year) === year);
    if (!session) {
      setRows([]);
      setSelected(new Set());
      setSearched(true);
      setError(`There is no ${month} ${year} session, so it has no candidates.`);
      return;
    }
    if (session._id === meta?.currentSessionId) {
      setError(`${month} ${year} is the current session. Choose an earlier session to bring candidates from.`);
      return;
    }
    const sessionId = session._id;
    setFilters((f) => ({ ...f, sessionId }));
    setLoading(true);
    try {
      setRows(await get<CandidateRow[]>(`/eligible/previous?${candidateQuery({ ...filters, sessionId })}`));
      setSelected(new Set());
      setSearched(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function carry() {
    setConfirming(false);
    try {
      setResult(await post<BulkResult>('/eligible/previous/carry', { ids: [...selected], targetSessionId: meta?.currentSessionId }));
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message);
    }
  }

  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...CANDIDATE_COLUMNS.map((c) => ({ key: c.key, label: c.label }))];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...Object.fromEntries(CANDIDATE_COLUMNS.map((c) => [c.key, candidateCell(r, c.key)])) }));
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r._id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Old Candidate</h1>
          <p>Previous Candidate — pick an earlier session and send its candidates into {current ? sessionLabel(current) : 'the current session'}.</p>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {!meta?.currentSessionId && meta ? <div className="error">No academic session is active. Activate a session first.</div> : null}
      {meta ? (
        <div className="card practical-filters">
          {meta.scopeNote ? <div className="error">{meta.scopeNote}</div> : null}
          <div className="grid cols-2">
            <Field label="Name of Course" required>
              <select
                className="input"
                value={filters.courseId}
                onChange={(e) => setFilters((f) => ({ ...f, courseId: e.target.value, specialityId: '' }))}
              >
                <option value="">-- Select Course --</option>
                {meta.courses.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name of Speciality">
              <select className="input" value={filters.specialityId} onChange={(e) => setFilters((f) => ({ ...f, specialityId: e.target.value }))}>
                <option value="">-- All Speciality --</option>
                {specs.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Session Month" required>
              <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">-- Select Month --</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <div className="practical-filter-actions">
              <Field label="Session Year" required>
                <select className="input" value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="">-- Select Year --</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="button" className="btn gold" onClick={load}>
                Search
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Candidate <span className="practical-count">{shown.length}</span>
          </h3>
          <div className="row">
            <button
              type="button"
              className="btn small"
              disabled={!selected.size || !meta?.currentSessionId}
              onClick={() => setConfirming(true)}
            >
              Send in Current Session
            </button>
          </div>
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="previous-candidates" title="Old Candidate" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Enrollment no., name, email…" />
          </label>
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((r) => r._id)))}
                    />
                  </th>
                  <th>Sr.No.</th>
                  {CANDIDATE_COLUMNS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r._id}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r._id)} onChange={() => toggle(r._id)} />
                    </td>
                    <td>{i + 1}</td>
                    {CANDIDATE_COLUMNS.map((c) => (
                      <td key={c.key}>{candidateCell(r, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">
            {searched ? 'No candidates in that session for this course.' : 'Choose a course and an earlier session, then Search.'}
          </p>
        )}
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Send in Current Session"
          message={`Send ${selected.size} candidate(s) into ${current ? sessionLabel(current) : 'the current session'} as Old candidates?`}
          onYes={carry}
          onNo={() => setConfirming(false)}
        />
      ) : null}
      {result ? <BulkResultDialog title="Send in Current Session" result={result} noun="candidate" onClose={() => setResult(null)} /> : null}
    </Shell>
  );
}
