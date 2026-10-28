import { useEffect, useState } from 'react';
import { get, getToken } from '../../api';
import { Shell } from '../../components/Shell';
import { ErrorBox } from '../../components/ui';
import { formatBytes } from '../../imageShrink';

type DayRow = { date: string; sizeBytes: number; errors: number; warnings: number };
type Entry = { time: string; level: string; ref: string; text: string; detail?: string; date?: string };

/** "ref=X | POST /api/... | 413 | ..." → the parts after the reference. */
function columns(text: string) {
  return text.replace(/^ref=[^ |]+ \| /, '').split(' | ');
}

function EntryRow({ e, showDate }: { e: Entry; showDate?: boolean }) {
  const [open, setOpen] = useState(false);
  const parts = columns(e.text);
  return (
    <>
      <tr>
        <td>
          {showDate && e.date ? <div className="muted">{e.date}</div> : null}
          {e.time.slice(11, 19)}
        </td>
        <td>
          <span className={`pill ${e.level === 'ERROR' ? 'bad' : 'warn'}`}>{e.level}</span>
        </td>
        <td style={{ fontFamily: 'monospace' }}>{e.ref}</td>
        <td style={{ whiteSpace: 'normal', wordBreak: 'break-word', minWidth: 320 }}>
          <div>{parts[0]}</div>
          {parts.length > 1 && <div className="muted" style={{ fontSize: 13 }}>{parts.slice(1).join(' · ')}</div>}
          {e.detail && (
            <button type="button" className="btn ghost small" style={{ paddingLeft: 0 }} onClick={() => setOpen(!open)}>
              {open ? 'Hide details' : 'Show details'}
            </button>
          )}
          {open && e.detail && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '4px 0 0' }}>{e.detail}</pre>}
        </td>
        <td>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => navigator.clipboard?.writeText(`${e.time} | ${e.level} | ${e.text}${e.detail ? `\n${e.detail}` : ''}`).catch(() => undefined)}
          >
            Copy
          </button>
        </td>
      </tr>
    </>
  );
}

function EntryTable({ entries, showDate }: { entries: Entry[]; showDate?: boolean }) {
  if (!entries.length) return <p className="muted">No entries match.</p>;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Time (IST)</th>
            <th>Level</th>
            <th>Reference</th>
            <th>What happened</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <EntryRow key={`${e.date || ''}${e.time}${i}`} e={e} showDate={showDate} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LogsPage() {
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [retention, setRetention] = useState(90);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [counts, setCounts] = useState<{ total: number; matched: number } | null>(null);
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [ref, setRef] = useState('');
  const [refHits, setRefHits] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    get<{ retentionDays: number; days: DayRow[] }>('/platform/logs')
      .then((r) => {
        setDays(r.days);
        setRetention(r.retentionDays);
        if (r.days[0]) setSelected(r.days[0].date);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function loadDay(date: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (level) params.set('level', level);
      if (status) params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const r = await get<{ total: number; matched: number; entries: Entry[] }>(`/platform/logs/${date}?${params}`);
      setEntries(r.entries);
      setCounts({ total: r.total, matched: r.matched });
    } catch (e: any) {
      setError(e.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selected) loadDay(selected);
    // filters apply on "Apply"; the day loads on selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function findRef() {
    setError(null);
    setRefHits(null);
    try {
      const r = await get<{ entries: Entry[] }>(`/platform/logs/search?ref=${encodeURIComponent(ref.trim())}`);
      setRefHits(r.entries);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function download(date: string) {
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`/api/platform/logs/${date}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(res.status === 404 ? 'No log file for this date' : `Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `ethesis-logs-${date}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Shell mode="platform">
      <div className="page-title">
        <div>
          <h1>Error logs</h1>
          <p>Errors and warnings from the whole system, one file per day (India time). Kept for {retention} days.</p>
        </div>
      </div>
      <ErrorBox error={error} />

      <div className="card" style={{ marginBottom: 16 }}>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (ref.trim()) findRef();
          }}
        >
          <input className="input" style={{ maxWidth: 260 }} placeholder="Reference code, e.g. K7Q2M9" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} />
          <button className="btn" type="submit" disabled={!ref.trim()}>
            Find reference
          </button>
          {refHits && (
            <button type="button" className="btn ghost small" onClick={() => setRefHits(null)}>
              Clear
            </button>
          )}
        </form>
        {refHits && (
          <div style={{ marginTop: 12 }}>
            {refHits.length ? <EntryTable entries={refHits} showDate /> : <p className="muted">No entry with this reference in the last {retention} days.</p>}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Days</h3>
          {days === null ? (
            <p className="muted">Loading…</p>
          ) : !days.length ? (
            <p className="muted">No errors recorded.</p>
          ) : (
            <div style={{ display: 'grid', gap: 6, maxHeight: '70vh', overflowY: 'auto' }}>
              {days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  className={`btn small ${selected === d.date ? '' : 'secondary'}`}
                  style={{ justifyContent: 'space-between', display: 'flex', gap: 8 }}
                  onClick={() => setSelected(d.date)}
                >
                  <span>{d.date}</span>
                  <span>
                    {d.errors ? `${d.errors} err` : ''}
                    {d.errors && d.warnings ? ' · ' : ''}
                    {d.warnings ? `${d.warnings} warn` : ''} · {formatBytes(d.sizeBytes)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ minWidth: 0 }}>
          {!selected ? (
            <p className="muted">Choose a day.</p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{selected}</h3>
                <button type="button" className="btn secondary small" onClick={() => download(selected)}>
                  Download this day (.txt)
                </button>
              </div>
              <form
                className="row"
                style={{ marginBottom: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  loadDay(selected);
                }}
              >
                <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ maxWidth: 140 }}>
                  <option value="">All levels</option>
                  <option value="ERROR">Errors</option>
                  <option value="WARN">Warnings</option>
                </select>
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 160 }}>
                  <option value="">Any status</option>
                  {['400', '401', '403', '404', '408', '413', '500', '502', '503', '504'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input className="input" style={{ maxWidth: 280 }} placeholder="Search URL or message" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn small" type="submit">
                  Apply
                </button>
              </form>
              {counts && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Showing {entries?.length || 0} of {counts.matched} matching ({counts.total} entries that day), newest first.
                </p>
              )}
              {loading ? <p className="muted">Loading…</p> : entries ? <EntryTable entries={entries} /> : null}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
