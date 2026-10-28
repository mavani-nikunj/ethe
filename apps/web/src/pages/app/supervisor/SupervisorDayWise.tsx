import { useEffect, useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { get } from '../../../api';
import { SessionFilterBar, StatusPill, dmy, useSessionChoice, useSupervisorMeta } from './common';

type Row = {
  key: string;
  examDate: string;
  day: string;
  shift: string;
  reportingTime: string;
  examName: string;
  name: string;
  designation: string;
  department: string;
  instituteName: string;
  address: string;
  mobile: string;
  email: string;
  status: string;
  statusLabel: string;
};

const COLS: { key: keyof Row | 'date'; label: string }[] = [
  { key: 'date', label: 'Exam Date' },
  { key: 'day', label: 'Day' },
  { key: 'shift', label: 'Exam Shift' },
  { key: 'name', label: 'Name' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'instituteName', label: 'Institute' },
  { key: 'address', label: 'Address' },
  { key: 'mobile', label: 'MobileNo' },
  { key: 'email', label: 'EmailId' },
  { key: 'reportingTime', label: 'Reporting Time' },
];

const cell = (r: Row, k: string) => (k === 'date' ? dmy(r.examDate) : String((r as any)[k] ?? ''));

/**
 * Old "Day Wise Supervisor": one row per duty, by date then Morning before Evening.
 * "By date range" replaces the hidden old Timing Report.
 */
export function SupervisorDayWisePage() {
  const { meta, error: metaError } = useSupervisorMeta();
  const [sessionId, setSessionId] = useSessionChoice(meta);
  const [mode, setMode] = useState<'session' | 'range'>('session');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load() {
    setError(null);
    try {
      if (mode === 'range') {
        if (!from || !to) return setError('Select both From Date and To Date');
        setRows(await get<Row[]>(`/supervisor/day-wise?from=${from}&to=${to}`));
      } else if (sessionId) {
        setRows(await get<Row[]>(`/supervisor/day-wise?sessionId=${sessionId}`));
      }
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    if (mode === 'session') load();
  }, [sessionId, mode]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => !q || [r.name, r.email, r.mobile, r.shift, dmy(r.examDate)].join(' ').toLowerCase().includes(q));
  }, [rows, search]);
  const people = new Set(shown.map((r) => r.email)).size;
  const exportCols = [{ key: 'sr', label: 'Sr.No.' }, ...COLS.map((c) => ({ key: c.key, label: c.label }))];
  const exportRows = shown.map((r, i) => ({ sr: i + 1, ...Object.fromEntries(COLS.map((c) => [c.key, cell(r, c.key)])) }));

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>Day Wise Supervisor</h1>
          <p>Duty roster: who reports on which exam date and shift.</p>
        </div>
        <div className="row">
          <button type="button" className={`btn small${mode === 'session' ? '' : ' secondary'}`} onClick={() => setMode('session')}>
            By session
          </button>
          <button type="button" className={`btn small${mode === 'range' ? '' : ' secondary'}`} onClick={() => setMode('range')}>
            By date range
          </button>
        </div>
      </div>
      <ErrorBox error={metaError || error} />
      {meta && mode === 'session' ? <SessionFilterBar meta={meta} sessionId={sessionId} onChange={setSessionId} onSearch={load} /> : null}
      {mode === 'range' ? (
        <div className="card practical-filters">
          <div className="grid cols-2">
            <Field label="From Date" required>
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <div className="practical-filter-actions">
              <Field label="To Date" required>
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
            Total Supervisor <span className="practical-count">{people}</span>
          </h3>
          <span className="practical-muted">{shown.length} duties</span>
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={exportCols} rows={exportRows} filename="day-wise-supervisor" title="Day Wise Supervisor" />
          <label className="field table-filter" style={{ margin: 0 }}>
            <span>Search</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        {shown.length ? (
          <div className="table-scroll">
            <table className="table practical-table">
              <thead>
                <tr>
                  <th>Sr.No.</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="nowrap">
                      {c.label}
                    </th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.key}>
                    <td>{i + 1}</td>
                    {COLS.map((c) => (
                      <td key={c.key} className={c.key === 'date' ? 'nowrap' : undefined}>
                        {cell(r, c.key)}
                      </td>
                    ))}
                    <td>
                      <StatusPill status={r.status} label={r.statusLabel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">No duty found.</p>
        )}
        <p className="practical-muted">Supervisors who regretted or were withdrawn are not listed.</p>
      </div>
    </Shell>
  );
}
