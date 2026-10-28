import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { Shell } from '../../components/Shell';
import { Pill } from '../../components/ui';
import { useAuth } from '../../auth';
import { SessionFilter } from '../../components/SessionFilter';
import { applySessionParams, sessionBody, useSessionFilter } from '../../session';

type Tab = 'files' | 'submissions' | 'tracking' | 'results';

export function ReportsPage({ initialTab }: { initialTab?: Tab }) {
  const { user } = useAuth();
  const [columns, setColumns] = useState<{ key: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [data, setData] = useState<any>({ columns: [], rows: [] });
  const [tracking, setTracking] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any>({ numbered: [], awaitingNumber: [] });
  const [results, setResults] = useState<any>({ held: [], released: [] });
  const [tab, setTab] = useState<Tab>(initialTab || 'files');
  const { sessions, month, year, setMonth, setYear, ready } = useSessionFilter();
  const canHold = user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN' || user?.role === 'AUTHORITY';
  const canAck = user?.role === 'ACADEMIC' || canHold;

  function sessionQs() {
    return applySessionParams(new URLSearchParams(), month, year).toString();
  }

  useEffect(() => {
    if (!ready) return;
    get('/reports/columns').then((cols) => {
      setColumns(cols);
      setSelected(cols.map((c: any) => c.key));
    });
    get(`/reports/examiner-tracking?${sessionQs()}`).then(setTracking);
    get(`/files/submissions?${sessionQs()}`).then(setSubmissions);
    get(`/files/results?${sessionQs()}`).then(setResults);
  }, [ready, month, year]);

  async function run() {
    setData(await post('/reports/files', { columns: selected, ...sessionBody(month, year) }));
  }

  async function toggleResult(id: string, hold: boolean) {
    await post(`/files/${id}/act`, { action: hold ? 'HOLD_RESULT' : 'RELEASE_RESULT' });
    setResults(await get(`/files/results?${sessionQs()}`));
  }

  async function acknowledge(id: string) {
    await post(`/files/${id}/act`, { action: 'ACKNOWLEDGE_RESULT' });
    setResults(await get(`/files/results?${sessionQs()}`));
  }

  function exportCsv() {
    const cols = data.columns || [];
    const lines = [
      cols.map((c: any) => c.label).join(','),
      ...data.rows.map((r: any) => cols.map((c: any) => JSON.stringify(r[c.key] ?? '')).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ethesis-report.csv';
    a.click();
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'files', label: 'File report' },
    { id: 'submissions', label: 'Submitted / awaiting number' },
    { id: 'tracking', label: 'Examiner tracking' },
    { id: 'results', label: 'Hold / release' },
  ];

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{tab === 'results' ? 'Hold / release' : 'Reports'}</h1>
          <p>
            Thesis-core reports only — submitted files, examiner status, and result hold. Not exam-hall or travel booking.
          </p>
        </div>
        <div className="row">
          {tabs.map((t) => (
            <button key={t.id} className={`btn small ${tab === t.id ? '' : 'secondary'}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-grid">
        <SessionFilter sessions={sessions} month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
      </div>
      {tab === 'files' && (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            {columns.map((c) => (
              <label key={c.key} style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, c.key] : selected.filter((k) => k !== c.key))
                  }
                />{' '}
                {c.label}
              </label>
            ))}
            <button className="btn small" onClick={run}>
              Run
            </button>
            <button className="btn secondary small" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                {(data.columns || []).map((c: any) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.rows || []).map((r: any) => (
                <tr key={r.id}>
                  {(data.columns || []).map((c: any) => (
                    <td key={c.key}>{String(r[c.key] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'submissions' && (
        <div className="grid cols-2">
          <div className="card">
            <h3>Numbered / submitted to exam ({submissions.numbered?.length || 0})</h3>
            <FileMini rows={submissions.numbered || []} />
          </div>
          <div className="card">
            <h3>Awaiting thesis number ({submissions.awaitingNumber?.length || 0})</h3>
            <FileMini rows={submissions.awaitingNumber || []} />
          </div>
        </div>
      )}
      {tab === 'tracking' && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Thesis</th>
                <th>Candidate</th>
                <th>Examiner</th>
                <th>Bucket</th>
                <th>Consent</th>
                <th>Vet</th>
                <th>Verdict</th>
                <th>Travel</th>
              </tr>
            </thead>
            <tbody>
              {tracking.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.fileId ? <Link to={`/app/files/${r.fileId}`}>{r.thesisNumber || '—'}</Link> : r.thesisNumber || '—'}
                  </td>
                  <td>{r.candidate}</td>
                  <td>
                    {r.examiner}
                    {r.email ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email}</div> : null}
                  </td>
                  <td>{r.bucket}</td>
                  <td>
                    <Pill status={r.consentStatus} />
                  </td>
                  <td>
                    <Pill status={r.vetStatus} />
                  </td>
                  <td>
                    <Pill status={r.verdict} />
                    {r.grade ? <div style={{ fontSize: 11 }}>{String(r.grade).replaceAll('_', ' ')}</div> : null}
                  </td>
                  <td>{r.travel || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'results' && (
        <div className="grid cols-2">
          <div className="card">
            <h3>Held ({results.held?.length || 0})</h3>
            <ResultMini rows={results.held || []} canHold={canHold} canAck={canAck} onToggle={toggleResult} onAck={acknowledge} hold={false} />
          </div>
          <div className="card">
            <h3>Released ({results.released?.length || 0})</h3>
            <ResultMini rows={results.released || []} canHold={canHold} canAck={canAck} onToggle={toggleResult} onAck={acknowledge} hold />
          </div>
        </div>
      )}
    </Shell>
  );
}

function FileMini({ rows }: { rows: any[] }) {
  if (!rows.length) return <p style={{ color: 'var(--muted)' }}>None.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Candidate</th>
          <th>No.</th>
          <th>Stage</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r._id}>
            <td>
              <Link to={`/app/files/${r._id}`}>{r.candidate?.name}</Link>
            </td>
            <td>{r.thesisNumber || '—'}</td>
            <td>{r.currentStageCode}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultMini({
  rows,
  canHold,
  canAck,
  onToggle,
  onAck,
  hold,
}: {
  rows: any[];
  canHold: boolean;
  canAck?: boolean;
  onToggle: (id: string, hold: boolean) => void;
  onAck?: (id: string) => void;
  hold: boolean;
}) {
  if (!rows.length) return <p style={{ color: 'var(--muted)' }}>None.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Candidate</th>
          <th>No.</th>
          <th>Result</th>
          <th>Academic</th>
          {canHold || canAck ? <th /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r._id}>
            <td>
              <Link to={`/app/files/${r._id}`}>{r.candidate?.name}</Link>
            </td>
            <td>{r.thesisNumber || '—'}</td>
            <td>
              <Pill status={r.resultStatus} />
            </td>
            <td>{r.academicAcknowledgedBy ? `Acknowledged (${r.academicAcknowledgedBy})` : '—'}</td>
            {canHold || canAck ? (
              <td>
                <div className="row" style={{ gap: 6 }}>
                  {canHold ? (
                    <button className="btn small" onClick={() => onToggle(r._id, hold)}>
                      {hold ? 'Hold' : 'Release'}
                    </button>
                  ) : null}
                  {canAck && !r.academicAcknowledgedAt ? (
                    <button className="btn secondary small" onClick={() => onAck?.(r._id)}>
                      Acknowledge
                    </button>
                  ) : null}
                </div>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
