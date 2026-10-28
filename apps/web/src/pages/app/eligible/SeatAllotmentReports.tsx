import { useMemo, useState } from 'react';
import { Shell } from '../../../components/Shell';
import { ErrorBox, ExportButtons, Field } from '../../../components/ui';
import { get } from '../../../api';
import { useAuth } from '../../../auth';
import { dmy } from './common';

type ReportRow = {
  examDate: string;
  shiftName: string;
  hallName: string;
  row: number;
  seatNo: number;
  name: string;
  rollNo: string;
  specialityName: string;
  courseName: string;
  paper: string;
};

const COLUMNS = [
  { key: 'sr', label: 'Sr.No.' },
  { key: 'date', label: 'Date' },
  { key: 'shiftName', label: 'Shift' },
  { key: 'hallName', label: 'Hall Name' },
  { key: 'row', label: 'Row No' },
  { key: 'seatNo', label: 'Seat No' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'rollNo', label: 'Roll No' },
  { key: 'specialityName', label: 'Speciality Name' },
  { key: 'courseName', label: 'Course Name' },
  { key: 'paper', label: 'Paper' },
];

/** Seat Allotment Reports: locked allotments between two dates, plus a hall-wise seating chart for notice boards. */
export function SeatAllotmentReportsPage() {
  const { user } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setError(null);
    if (!from || !to) return setError('From Date and To Date are required');
    setLoading(true);
    try {
      setRows(await get<ReportRow[]>(`/eligible/allotment/report?from=${from}&to=${to}`));
      setSearched(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const exportRows = rows.map((r, i) => ({ sr: i + 1, ...r, date: dmy(r.examDate) }));
  /** One printed page per exam date + shift + hall. */
  const sheets = useMemo(() => {
    const map = new Map<string, { title: string; rows: ReportRow[] }>();
    for (const r of rows) {
      const key = `${r.examDate}|${r.shiftName}|${r.hallName}`;
      const sheet = map.get(key) || { title: `${r.hallName} — ${dmy(r.examDate)}, ${r.shiftName}`, rows: [] };
      sheet.rows.push(r);
      map.set(key, sheet);
    }
    return [...map.values()];
  }, [rows]);

  return (
    <Shell mode="app">
      <div className="page-title no-print">
        <div>
          <h1>Seat Allotment Reports</h1>
          <p>Locked seat allotments between two dates.</p>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card practical-filters no-print">
        <div className="grid cols-4">
          <Field label="From Date" required>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To Date" required>
            <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="practical-filter-actions">
            <button type="button" className="btn gold" disabled={loading} onClick={search}>
              Search
            </button>
          </div>
        </div>
      </div>
      <div className="card no-print" style={{ marginTop: 14 }}>
        <div className="practical-toolbar">
          <h3 className="practical-total">
            Total Allotment <span className="practical-count">{rows.length}</span>
          </h3>
          <button type="button" className="btn secondary" disabled={!rows.length} onClick={() => window.print()}>
            Print seating chart
          </button>
        </div>
        <div className="file-number-toolbar">
          <ExportButtons columns={COLUMNS} rows={exportRows} filename={`seat-allotment-${from}-to-${to}`} title="Seat Allotment Report" />
        </div>
        {loading ? (
          <p className="practical-empty">Loading…</p>
        ) : rows.length ? (
          <div className="table-scroll">
            <table className="table practical-table practical-nopin">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exportRows.map((r) => (
                  <tr key={`${r.examDate}|${r.shiftName}|${r.hallName}|${r.seatNo}`}>
                    {COLUMNS.map((c) => (
                      <td key={c.key}>{String((r as any)[c.key] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="practical-empty">{searched ? 'No locked seat allotment in these dates.' : 'Choose From Date and To Date, then Search.'}</p>
        )}
      </div>
      <div className="letter-print-area seat-chart" aria-hidden>
        {sheets.map((s) => (
          <section className="seat-chart-page" key={s.title}>
            <p className="seat-chart-inst">{user?.institute?.name || ''}</p>
            <h2>Seating Plan · {s.title}</h2>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Seat No</th>
                  <th>Roll No</th>
                  <th>Candidate Name</th>
                  <th>Speciality</th>
                  <th>Paper</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.seatNo}>
                    <td>{r.row}</td>
                    <td>{r.seatNo}</td>
                    <td>{r.rollNo}</td>
                    <td>{r.name}</td>
                    <td>{r.specialityName}</td>
                    <td>{r.paper}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Shell>
  );
}
