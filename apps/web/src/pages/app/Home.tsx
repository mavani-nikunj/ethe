import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { Shell } from '../../components/Shell';
import { useAuth } from '../../auth';
import { isCourseRole } from '@ethesis/shared';
import { DashboardMetro, MetroCourseGroup } from '../../components/DashboardMetro';
import { ConfirmDialog, ErrorBox, Field } from '../../components/ui';
import { MONTHS, monthsFromSessions, sessionYearChoices, yearsFromSessions } from '../../dept';
import { notifySessionChanged } from '../../session';
import { supervisorMenuFor } from './supervisor/menu';

export function AppHome() {
  const { user } = useAuth();
  const isCourse = isCourseRole(user?.role);
  const canActivate = user?.role === 'DEALING' || user?.role === 'INSTITUTE_ADMIN';
  const [stats, setStats] = useState<any>(null);
  const [masters, setMasters] = useState<any>(null);
  const [metro, setMetro] = useState<MetroCourseGroup[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingActive, setPendingActive] = useState(false);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [supervisor, setSupervisor] = useState<{ session: { month: string; year: number } | null; counts: Record<string, number> } | null>(null);

  function loadOverview() {
    get('/files/stats').then(setStats).catch(() => setStats({}));
    get('/masters/overview').then(setMasters).catch(() => setMasters({}));
    get('/files/workflow-board')
      .then((data) => setMetro(data?.groups || []))
      .catch(() => setMetro([]));
    if (user?.role === 'DEALING') {
      get<{ awaitingPaper?: number }>('/eligible/counts')
        .then((c) => setEligibleCount(c?.awaitingPaper ?? 0))
        .catch(() => setEligibleCount(null));
    }
    if (supervisorMenuFor(user?.role, user?.authoritySlot).length) {
      get('/supervisor/counts')
        .then((c) => setSupervisor(c?.session ? c : null))
        .catch(() => setSupervisor(null));
    }
  }

  useEffect(() => {
    if (isCourse) {
      get('/masters/sessions')
        .then((rows) => setSessions(Array.isArray(rows) ? rows : []))
        .catch(() => setSessions([]));
      get('/files/department-dashboard')
        .then((d) => {
          setDash(d);
          setMonth(d.month || '');
          setYear(String(d.year || new Date().getFullYear()));
        })
        .catch(() => setDash({}));
      return;
    }
    loadOverview();
    get('/masters/sessions/current')
      .then((current) => {
        if (current?.month && current?.year) {
          setMonth(current.month);
          setYear(String(current.year));
        }
      })
      .catch(() => {});
    if (canActivate) {
      Promise.all([
        get('/masters/sessions').catch(() => []),
        get('/masters/sessions/current').catch(() => null),
      ]).then(([rows, current]) => {
        setSessions(Array.isArray(rows) ? rows : []);
        if (current?.month && current?.year) {
          setMonth(current.month);
          setYear(String(current.year));
        }
      });
    }
  }, [isCourse, canActivate]);

  async function loadDash(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (!month || !year) {
      setError('Session month and year are required');
      return;
    }
    try {
      setDash(await get(`/files/department-dashboard?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function activateSession() {
    setError(null);
    if (!month || !year) {
      setError('Session month and year are required');
      setPendingActive(false);
      return;
    }
    try {
      await post('/masters/sessions/activate', { month, year: Number(year) });
      notifySessionChanged();
      setPendingActive(false);
      const rows = await get('/masters/sessions').catch(() => []);
      setSessions(Array.isArray(rows) ? rows : []);
      loadOverview();
    } catch (err: any) {
      setError(err.message);
      setPendingActive(false);
    }
  }

  if (isCourse) {
    const last = dash?.lastSubmittedOn ? new Date(dash.lastSubmittedOn).toLocaleDateString('en-IN') : '—';
    const monthOpts = monthsFromSessions(sessions, month);
    const yearOpts = yearsFromSessions(sessions, year);
    return (
      <Shell mode="app">
        <div className="dept-hero">
          <h1>Thesis Submission</h1>
          <p>Welcome to Thesis Submission Dashboard and view details</p>
        </div>
        <form className="card dept-session-bar" onSubmit={loadDash}>
          <ErrorBox error={error} />
          <Field label="Session Month" required error={!month && error ? 'Required' : undefined}>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} required>
              <option value="">Select month</option>
              {monthOpts.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Session Year" required>
            <select className="input" value={year} onChange={(e) => setYear(e.target.value)} required>
              <option value="">Select year</option>
              {yearOpts.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn gold" type="submit">
            Submit
          </button>
        </form>
        <div className="grid cols-2" style={{ marginTop: 16 }}>
          <Link className="card stat stat-link" to="/app/dept/added">
            <b>{dash?.addedCount ?? 0}</b>
            <span>Added thesis</span>
          </Link>
          <Link className="card stat stat-link" to="/app/dept/submitted">
            <b>{dash?.submittedCount ?? 0}</b>
            <span>
              Submitted thesis
              {dash?.month ? ` · ${dash.month} ${dash.year || ''}` : ''}
              {last !== '—' ? `, Last submitted on ${last}` : ''}
            </span>
          </Link>
        </div>
      </Shell>
    );
  }

  const yearOpts = sessionYearChoices(sessions, year);

  return (
    <Shell mode="app">
      <div className="page-title">
        <div>
          <h1>{user?.institute?.name || 'Institute'}</h1>
          <p>
            {user?.role === 'INSTITUTE_ADMIN'
              ? 'Create courses in Masters, then issue academic logins.'
              : 'Inbox: ACE reviews new files, Dealing assigns numbers, Assoc Dean approves the Chief Guide. Open File 360 to act.'}
          </p>
        </div>
      </div>
      {canActivate && (
        <form
          className="card dept-session-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setPendingActive(true);
          }}
        >
          <ErrorBox error={error} />
          <Field label="Session Month" required>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} required>
              <option value="">Select month</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Session Year" required>
            <select className="input" value={year} onChange={(e) => setYear(e.target.value)} required>
              <option value="">Select year</option>
              {yearOpts.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn gold" type="submit">
            Active
          </button>
        </form>
      )}
      <div className="grid cols-4" style={canActivate ? { marginTop: 16 } : undefined}>
        {[
          ['In progress', stats?.inProgress],
          ['On hold', stats?.onHold],
          ['Completed', stats?.completed],
          ['All files', stats?.total],
        ].map(([l, v]) => (
          <div className="card stat" key={String(l)}>
            <b>{v ?? 0}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      {eligibleCount !== null && (
        <div className="grid cols-4" style={{ marginTop: 16 }}>
          {/* Old Dealing dashboard tile: eligible candidates whose speciality has no paper yet + View Report. */}
          <Link className="card stat stat-link" to="/app/eligible/eligible">
            <b>{eligibleCount}</b>
            <span>Eligible Candidate without paper · View Report</span>
          </Link>
        </div>
      )}
      {supervisor && (
        <>
          {/* Old Dealing dashboard supervisor tiles (USPHelp 'SupervisorCount'), for the active supervisor session. */}
          <h3 style={{ margin: '16px 0 8px' }}>
            Supervisor · {supervisor.session?.month} {supervisor.session?.year}
          </h3>
          <div className="grid cols-4">
            {(
              [
                ['DRAFT', 'Not sent to Asstt. Controller', 'to-ace'],
                ['WITH_ACE', 'With Asstt. Controller', 'with-ace'],
                ['APPROVED', 'Approved, offer not sent', 'approved'],
                ['OFFER_SENT', 'Offer pending', 'offer-pending'],
                ['ACCEPTED', 'Accepted', 'accepted'],
                ['REGRETTED', 'Rejected', 'regretted'],
              ] as const
            ).map(([k, label, path]) => (
              <Link className="card stat stat-link" key={k} to={`/app/supervisor/${path}`}>
                <b>{supervisor.counts[k] ?? 0}</b>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ color: 'var(--muted)', margin: '0 0 10px' }}>
          Click a course type for all files there, or a step for that course type only.
        </p>
        {metro.length ? <DashboardMetro groups={metro} month={month} year={year} /> : <p style={{ color: 'var(--muted)' }}>No course types mapped yet.</p>}
      </div>
      {user?.role === 'INSTITUTE_ADMIN' && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Setup</h3>
          <p style={{ color: 'var(--muted)' }}>
            Add courses in Masters, then create a login mapped to those courses. That login adds the candidate, thesis PDF
            and Chief Guide. Departments {masters?.departments ?? 0} · Course types {masters?.courseTypes ?? 0} · Courses{' '}
            {masters?.courses ?? 0} · Staff {masters?.staff ?? 0} · Faculty {masters?.faculty ?? 0}
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <Link className="btn" to="/app/masters">
              Add department
            </Link>
            <Link className="btn secondary" to="/app/blueprints">
              Blueprints
            </Link>
          </div>
        </div>
      )}
      {pendingActive && (
        <ConfirmDialog
          title="Set academic session"
          message="Set this as the academic session for all logins?"
          detail={`${month} ${year}`}
          yesLabel="Active"
          onYes={activateSession}
          onNo={() => setPendingActive(false)}
        />
      )}
    </Shell>
  );
}
