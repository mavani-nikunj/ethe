import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Shell } from '../../components/Shell';

export function PlatformHome() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    get('/platform/dashboard').then(setStats);
  }, []);
  return (
    <Shell mode="platform">
      <div className="page-title">
        <div>
          <h1>Platform</h1>
          <p>Institutes only. Super Admin never opens thesis files.</p>
        </div>
        <Link className="btn" to="/platform/institutes/new">
          Onboard institute
        </Link>
      </div>
      <div className="grid cols-4">
        {[
          ['Total', stats?.total],
          ['Active', stats?.active],
          ['Suspended', stats?.suspended],
          ['Draft', stats?.draft],
        ].map(([l, v]) => (
          <div className="card stat" key={String(l)}>
            <b>{v ?? '—'}</b>
            <span>{l} institutes</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}
