import { useEffect, useState } from 'react';
import { get } from '../../api';
import { Shell } from '../../components/Shell';

export function AuditPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    get('/platform/audit-logs').then(setRows);
  }, []);
  return (
    <Shell mode="platform">
      <div className="page-title">
        <div>
          <h1>Audit log</h1>
          <p>Platform actions: create, suspend, admin invite.</p>
        </div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Institute</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td>{r.action}</td>
                <td>{r.instituteId || '—'}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
