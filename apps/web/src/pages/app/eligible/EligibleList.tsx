import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Shell } from '../../../components/Shell';
import { ConfirmDialog, ErrorBox, ExportButtons } from '../../../components/ui';
import { get, post } from '../../../api';
import { BulkResultDialog, ReasonDialog, type BulkResult } from '../practical/common';
import { ELIGIBLE_MENU } from './menu';
import { VenueDialog } from './VenueDialog';
import {
  CANDIDATE_COLUMNS,
  WITH_PAPER_COLUMNS,
  CandidateFilterBar,
  candidateCell,
  candidateQuery,
  searchRows,
  useEligibleMeta,
  type CandidateFilters,
  type CandidateRow,
} from './common';

/** Old page headers: "Eligible Candidate" / "Not Eligible Candidate". */
const VIEWS: Record<string, { title: string; eligible: boolean; withPaper?: boolean; empty: string }> = {
  eligible: { title: 'Eligible Candidate', eligible: true, empty: 'No eligible candidates for this session.' },
  'not-eligible': { title: 'Not Eligible Candidate', eligible: false, empty: 'No candidates are marked not eligible for this session.' },
  'with-paper': {
    title: 'Eligible Candidate and Seat Allotment',
    eligible: true,
    withPaper: true,
    empty: 'No eligible candidate has a paper yet. Use Add Venue to schedule papers for their speciality.',
  },
};

type Pending = { kind: 'not-eligible' | 'eligible'; ids: string[]; single?: CandidateRow };

export function EligibleListPage() {
  const { view = '' } = useParams();
  const config = VIEWS[view];
  const menuLabel = ELIGIBLE_MENU.find((m) => m.path === view)?.label;
  const { meta, error: metaError } = useEligibleMeta();
  const [filters, setFilters] = useState<CandidateFilters>({ sessionId: '', courseId: '', specialityId: '' });
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<{ title: string; result: BulkResult } | null>(null);
  const [venueOpen, setVenueOpen] = useState(false);

  useEffect(() => {
    if (meta && !filters.sessionId) setFilters((f) => ({ ...f, sessionId: meta.currentSessionId || meta.sessions[0]?._id || '' }));
  }, [meta]);

  async function load(f = filters) {
    if (!config || !f.sessionId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await get<CandidateRow[]>(`/eligible/candidates?${candidateQuery(f, { view })}`));
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRows([]);
    setSearch('');
    load();
  }, [view, filters.sessionId]);

  const shown = useMemo(() => searchRows(rows, search), [rows, search]);

  if (!config) return <Navigate to="/app/eligible/eligible" replace />;

  const canEdit = !!meta?.can.edit;
  // Old "Eligible Candidate and Seat Allotment" page had only Search and per-row Edit / Not Eligible:
  // no Add Venue, no Add Old Candidate, no tick-box bulk action.
  const listPage = !config.withPaper;
  const bulk = canEdit && listPage;
  const columns: { key: string; label: string }[] = config.withPaper
    ? WITH_PAPER_COLUMNS
    : config.eligible
      ? CANDIDATE_COLUMNS
      : [...CANDIDATE_COLUMNS, { key: 'notEligibleReason', label: 'Reason' }, { key: 'notEligibleBy', label: 'Marked by' }];
  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...columns.map((c) => ({ key: c.key, label: c.label }))];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...Object.fromEntries(columns.map((c) => [c.key, candidateCell(r, c.key)])) }));
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r._id));
  const shownCount = config.withPaper ? new Set(shown.map((r) => r._id)).size : shown.length;
  const bulkKind = config.eligible ? 'not-eligible' : 'eligible';
  const bulkLabel = config.eligible ? 'Not Eligible' : 'Eligible';

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function startBulk() {
    if (!selected.size) {
      setError('Select at least one candidate.');
      return;
    }
    setError(null);
    setPending({ kind: bulkKind, ids: [...selected] });
  }

  async function run(reason?: string) {
    const p = pending;
    setPending(null);
    if (!p) return;
    try {
      const res = await post<BulkResult>(`/eligible/candidates/${p.kind}`, { ids: p.ids, reason });
      setResult({ title: p.kind === 'not-eligible' ? 'Not Eligible successfully.' : 'Eligible successfully.', result: res });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const who = pending?.single ? `${pending.single.name} (${pending.single.enrollmentNo})` : `${pending?.ids.length || 0} selected candidate(s)`;

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{config.title}</h1>
          {menuLabel && menuLabel !== config.title ? <p>{menuLabel}</p> : null}
        </div>
        {canEdit && config.eligible && listPage ? (
          <Link className="btn secondary" to="/app/eligible/add">
            Add Old Candidate
          </Link>
        ) : null}
      </div>
      <ErrorBox error={metaError || error} />
      {meta ? (
        <CandidateFilterBar meta={meta} value={filters} onChange={setFilters} onSearch={() => load()}>
          {config.eligible && listPage ? (
            <button type="button" className="btn secondary" disabled={!filters.sessionId} onClick={() => setVenueOpen(true)}>
              {canEdit ? 'Add Venue' : 'Paper Schedule'}
            </button>
          ) : null}
        </CandidateFilterBar>
      ) : null}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Candidate <span className="practical-count">{shownCount}</span>
          </h3>
          {bulk ? (
            <div className="row">
              <button
                type="button"
                className={`btn small${config.eligible ? ' danger' : ''}`}
                disabled={loading}
                onClick={startBulk}
              >
                {bulkLabel}
              </button>
            </div>
          ) : null}
        </div>
        {!canEdit ? <p className="practical-muted">Only the Dealing Assistant can change eligibility.</p> : null}
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename={`candidates-${view}`} title={config.title} />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Enrollment no., name, email…" />
          </label>
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  {bulk ? (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((r) => r._id)))}
                      />
                    </th>
                  ) : null}
                  <th>Sr.No.</th>
                  {columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  {canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.rowKey || r._id}>
                    {bulk ? (
                      <td>
                        <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r._id)} onChange={() => toggle(r._id)} />
                      </td>
                    ) : null}
                    <td>{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c.key}>
                        {c.key === 'status' ? (
                          <span className={`pill ${r.status === 'New' ? 'navy' : 'warn'}`} title={r.carriedFrom ? `Carried from ${r.carriedFrom}` : undefined}>
                            {r.status}
                          </span>
                        ) : (
                          candidateCell(r, c.key)
                        )}
                      </td>
                    ))}
                    {canEdit ? (
                      <td>
                        <div className="row">
                          {r.status === 'Old' ? (
                            <Link className="btn small secondary" to={`/app/eligible/add?id=${r._id}`}>
                              Edit
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            className={`btn small${config.eligible ? ' danger' : ''}`}
                            onClick={() => setPending({ kind: bulkKind, ids: [r._id], single: r })}
                          >
                            {bulkLabel}
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
          <p className="practical-empty">{config.empty}</p>
        )}
      </div>
      {pending?.kind === 'not-eligible' ? (
        <ReasonDialog
          title="Not Eligible"
          message={`Do you want to not eligible ${who}?`}
          required
          yesLabel="Yes"
          onYes={(reason) => run(reason)}
          onNo={() => setPending(null)}
        />
      ) : null}
      {pending?.kind === 'eligible' ? (
        <ConfirmDialog
          title="Eligible"
          message={`Do you want to make ${who} eligible again?`}
          onYes={() => run()}
          onNo={() => setPending(null)}
        />
      ) : null}
      {venueOpen && meta ? (
        <VenueDialog
          meta={meta}
          sessionId={filters.sessionId}
          courseId={filters.courseId}
          specialityId={filters.specialityId}
          onClose={(changed) => {
            setVenueOpen(false);
            if (changed && config.withPaper) load();
          }}
        />
      ) : null}
      {result ? <BulkResultDialog title={result.title} result={result.result} noun="candidate" onClose={() => setResult(null)} /> : null}
    </Shell>
  );
}
