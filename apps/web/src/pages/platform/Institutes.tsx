import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Shell } from '../../components/Shell';
import { Pill } from '../../components/ui';

export function InstitutesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  async function load() {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    setRows(await get(`/platform/institutes?${qs}`));
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <Shell mode="platform">
      <div className="page-title">
        <div>
          <h1>Institutes</h1>
          <p>Each tenant gets one College Admin. Staff of that institute share this same URL.</p>
        </div>
        <Link className="btn" to="/platform/institutes/new">
          New institute
        </Link>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="input" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All statuses</option>
            <option>ACTIVE</option>
            <option>SUSPENDED</option>
            <option>DRAFT</option>
          </select>
          <button className="btn secondary" onClick={load}>
            Filter
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Institute</th>
              <th>Code</th>
              <th>Type</th>
              <th>Admin</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id || r._id}>
                <td>
                  <Link to={`/platform/institutes/${r.id || r._id}`}>{r.displayName || r.name}</Link>
                </td>
                <td>{r.code}</td>
                <td>{r.type}</td>
                <td>{r.adminEmail || '—'}</td>
                <td>
                  <Pill status={r.status} />
                </td>
                <td>
                  <Link to={`/platform/institutes/${r.id || r._id}`}>click here to view Details</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
