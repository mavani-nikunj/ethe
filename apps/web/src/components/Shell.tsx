import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { PRODUCT_NAME, isCourseRole } from '@ethesis/shared';
import { useAuth, type SessionUser } from '../auth';
import { get } from '../api';
import { BrandBar } from './BrandBar';
import { SESSION_CHANGED } from '../session';
import { practicalMenuFor } from '../pages/app/practical/menu';
import { eligibleMenuFor } from '../pages/app/eligible/menu';
import { SUPERVISOR_SESSION_CHANGED, supervisorMenuFor } from '../pages/app/supervisor/menu';
import { staffDutyMenuFor } from '../pages/app/staff-duty/menu';

const platformNav = [
  { to: '/platform', label: 'Overview', end: true },
  { to: '/platform/institutes', label: 'Institutes' },
  { to: '/platform/audit', label: 'Audit log' },
  { to: '/platform/logs', label: 'Error logs' },
];

function appNav(role?: string, slot?: string) {
  if (role === 'INSTITUTE_ADMIN') {
    return [
      { group: 'Configure' },
      { to: '/app', label: 'Dashboard', end: true },
      { to: '/app/masters', label: 'Masters' },
      { to: '/app/blueprints', label: 'Blueprints' },
      { group: 'Oversight' },
      { to: '/app/files', label: 'All files' },
      { to: '/app/examiner-consents', label: 'Examiner consent' },
      { to: '/app/letters/approved', label: 'Download approved letter' },
      { to: '/app/evaluations/accepted', label: 'Accepted evaluation report' },
      { to: '/app/reports', label: 'Reports' },
      ...practicalNav(role, slot),
      ...eligibleNav(role, slot),
      ...supervisorNav(role, slot),
      ...staffDutyNav(role, slot),
    ];
  }
  if (role === 'TRAVEL') {
    return [
      { group: 'Travel Manager' },
      { to: '/app/travel/requests', label: 'Ticket Requests' },
      { to: '/app/travel/uploaded', label: 'Uploaded Tickets' },
      { to: '/app/travel/cancelled', label: 'Canceled Tickets' },
      { to: '/app/travel/agents', label: 'Travel Agents' },
    ];
  }
  if (isCourseRole(role)) {
    return [
      { group: 'Main' },
      { to: '/app', label: 'Dashboard', end: true },
      { group: 'Quick links' },
      { to: '/app/files/new', label: 'Add New Thesis' },
      { to: '/app/dept/edit', label: 'Edit Thesis' },
      { to: '/app/dept/guides', label: 'Edit Chief Guide' },
      { to: '/app/dept/added', label: 'Added thesis' },
      { to: '/app/dept/submitted', label: 'Submitted Thesis' },
      { group: 'Reports' },
      { to: '/app/dept/reports/not-submitted-excel', label: 'Not Submitted (Excel)', child: true },
      { to: '/app/dept/reports/not-submitted-a4', label: 'Not Submitted (A4)', child: true },
      { to: '/app/dept/reports/submitted-excel', label: 'Submitted (Excel)', child: true },
      { to: '/app/dept/reports/submitted-a4', label: 'Submitted (A4)', child: true },
    ];
  }
  const work = [
    { group: 'Work' },
    { to: '/app', label: 'Dashboard', end: true },
    { to: '/app/inbox', label: 'Inbox' },
    { to: '/app/files', label: 'Files' },
  ] as { group?: string; to?: string; label: string; end?: boolean }[];
  if (role === 'DEALING') {
    work.push({ to: '/app/file-numbers', label: 'Generate File No.' });
    work.push({ to: '/app/exam-types', label: 'Add Exam Type' });
    work.push({ to: '/app/dept/guides', label: 'Edit Chief Guide' });
    work.push({ to: '/app/comms/email', label: 'Email' });
    work.push({ to: '/app/comms/letter', label: 'Letter' });
    work.push({ to: '/app/letters/approved', label: 'Download approved letter' });
    work.push({ to: '/app/examiner-consents', label: 'Examiner consent' });
    work.push({ to: '/app/evaluations/accepted', label: 'Accepted evaluation report' });
  } else if (role === 'ACADEMIC') {
    work.push({ to: '/app/dept/guides', label: 'Edit Chief Guide' });
    work.push({ to: '/app/comms/email', label: 'Email' });
    work.push({ to: '/app/comms/letter', label: 'Letter' });
  }
  work.push({ to: '/app/reports', label: 'Reports' });
  return [...work, ...practicalNav(role, slot), ...eligibleNav(role, slot), ...supervisorNav(role, slot), ...staffDutyNav(role, slot)];
}

/** Collapsible "Appointment of Practical Examiner" group (old eSTEMM sub-menu). */
function practicalNav(role?: string, slot?: string) {
  const items = practicalMenuFor(role, slot);
  if (!items.length) return [];
  return [
    { section: PRACTICAL_SECTION, label: 'Appointment of Practical Examiner' },
    ...items.map((m) => ({ to: `/app/practical/${m.path}`, label: m.label, parent: PRACTICAL_SECTION, countKey: m.path })),
  ];
}

const PRACTICAL_SECTION = 'practical';

/** Collapsible "Eligible Candidate" group (old eSTEMM sub-menu). */
function eligibleNav(role?: string, slot?: string) {
  const items = eligibleMenuFor(role, slot);
  if (!items.length) return [];
  return [
    { section: ELIGIBLE_SECTION, label: 'Eligible Candidate' },
    ...items.map((m) => ({ to: `/app/eligible/${m.path}`, label: m.label, parent: ELIGIBLE_SECTION })),
  ];
}

const ELIGIBLE_SECTION = 'eligible';

/** Collapsible "Supervisor" group (old eSTEMM sub-menu). */
function supervisorNav(role?: string, slot?: string) {
  const items = supervisorMenuFor(role, slot);
  if (!items.length) return [];
  return [
    { section: SUPERVISOR_SECTION, label: 'Supervisor' },
    ...items.map((m) => ({ to: `/app/supervisor/${m.path}`, label: m.label, parent: SUPERVISOR_SECTION })),
  ];
}

const SUPERVISOR_SECTION = 'supervisor';

/** Collapsible "Staff Duty" group (old eSTEMM sub-menu). */
function staffDutyNav(role?: string, slot?: string) {
  const items = staffDutyMenuFor(role, slot);
  if (!items.length) return [];
  return [
    { section: STAFF_DUTY_SECTION, label: 'Staff Duty' },
    ...items.map((m) => ({ to: `/app/staff-duty/${m.path}`, label: m.label, parent: STAFF_DUTY_SECTION })),
  ];
}

const STAFF_DUTY_SECTION = 'staff-duty';
/** Lists that mean "someone must act" — these get a count badge in the menu. */
const BADGE_VIEWS = new Set(['to-dean', 'with-dean', 'held', 'offer', 'offer-pending', 'accepted']);

const PANEL_FALLBACK: Record<string, string> = {
  SUPER_ADMIN: 'Platform',
  INSTITUTE_ADMIN: 'Institute Admin',
  ACADEMIC: 'Academic Section',
  DEALING: 'Dealing Assistant',
  COURSE: 'Academic',
  GUIDE: 'Chief Guide',
  ACE: 'ACE',
  AO: 'AO',
  ASSOC_DEAN: 'Associate Dean',
  TRAVEL: 'Travel Manager',
};

function panelName(user?: SessionUser | null, labels: { systemRole?: string; code?: string; label?: string }[] = []) {
  if (!user) return '';
  if (user.role === 'SUPER_ADMIN') return 'Platform';
  const slot = String(user.authoritySlot || '').trim();
  if (user.role === 'AUTHORITY' && slot) {
    const bySlot = labels.find((l) => String(l.code || '').toUpperCase() === slot.toUpperCase());
    if (bySlot?.label) return bySlot.label;
    return PANEL_FALLBACK[slot] || slot.replaceAll('_', ' ');
  }
  if (PANEL_FALLBACK[user.role]) return PANEL_FALLBACK[user.role];
  const byRole = labels.find((l) => String(l.systemRole || '').toUpperCase() === user.role);
  if (byRole?.label) return byRole.label;
  return user.role.replaceAll('_', ' ');
}

function initialsOf(name?: string) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function ProfileMenu({
  user,
  panel,
}: {
  user?: SessionUser | null;
  panel: string;
}) {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const name = user?.name || user?.email || 'User';
  const initials = initialsOf(name);
  const slot = user?.authoritySlot ? user.authoritySlot.replaceAll('_', ' ') : '';

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="profile-menu" ref={box}>
      <button
        type="button"
        className="profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="profile-trigger-name">{name}</span>
        <span className="profile-avatar" aria-hidden>
          {initials}
        </span>
      </button>
      {open ? (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-head">
            <span className="profile-avatar light" aria-hidden>
              {initials}
            </span>
            <div>
              <strong>{name}</strong>
              {panel ? <small>{panel}</small> : null}
            </div>
          </div>
          <div className="profile-dropdown-meta">
            {user?.email ? (
              <div>
                <span>Email</span>
                {user.email}
              </div>
            ) : null}
            {user?.role ? (
              <div>
                <span>Role</span>
                {user.role.replaceAll('_', ' ')}
                {slot ? ` · ${slot}` : ''}
              </div>
            ) : null}
            {user?.designation ? (
              <div>
                <span>Designation</span>
                {user.designation}
              </div>
            ) : null}
            {user?.mobile ? (
              <div>
                <span>Mobile</span>
                {user.mobile}
              </div>
            ) : null}
            {user?.institute?.name ? (
              <div>
                <span>Institute</span>
                {user.institute.name}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="profile-logout"
            role="menuitem"
            onClick={() => {
              logout();
              nav('/login');
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <path
                fill="currentColor"
                d="M10 17v-3H3v-4h7V7l5 5-5 5zm9-14H11a2 2 0 0 0-2 2v3h2V5h8v14h-8v-3H9v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"
              />
            </svg>
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Shell({ children, mode }: { children: React.ReactNode; mode: 'platform' | 'app' }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sessionLabel, setSessionLabel] = useState('');
  const [supervisorLabel, setSupervisorLabel] = useState<string | null>(null);
  const [roleLabels, setRoleLabels] = useState<{ systemRole?: string; code?: string; label?: string }[]>([]);
  const items = mode === 'platform' ? platformNav : appNav(user?.role, user?.authoritySlot);
  const color = mode === 'app' && user?.institute?.primaryColor ? user.institute.primaryColor : undefined;
  const barTitle = mode === 'platform' ? PRODUCT_NAME : user?.institute?.name || PRODUCT_NAME;
  const loginPanel = panelName(user, roleLabels);

  // Pending-work counts on the practical sub-menu (refreshed on each page change).
  useEffect(() => {
    if (mode !== 'app' || !practicalMenuFor(user?.role, user?.authoritySlot).length) return;
    get<Record<string, number>>('/practical/counts')
      .then((c) => setCounts(c || {}))
      .catch(() => setCounts({}));
  }, [mode, user?.role, location.pathname]);

  /** A section stays open while one of its pages is showing, unless the user closed it. */
  function sectionOpen(key: string) {
    if (key in openSections) return openSections[key];
    return location.pathname.startsWith(`/app/${key}`);
  }

  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    workspaceRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    const origScrollTo = window.scrollTo.bind(window);
    window.scrollTo = ((...args: any[]) => {
      origScrollTo(...(args as [any, any]));
      if (workspaceRef.current) {
        if (typeof args[0] === 'object' && args[0] !== null) {
          workspaceRef.current.scrollTo(args[0]);
        } else if (typeof args[0] === 'number') {
          workspaceRef.current.scrollTo(args[0], args[1]);
        }
      }
    }) as any;
    return () => {
      window.scrollTo = origScrollTo;
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    if (mode !== 'app') {
      setSessionLabel('');
      setRoleLabels([]);
      return;
    }
    function load() {
      get('/masters/sessions/current')
        .then((row: { month?: string; year?: number } | null) => {
          setSessionLabel(row?.month ? `${row.month} ${row.year}` : '');
        })
        .catch(() => setSessionLabel(''));
    }
    load();
    get('/masters/role-labels')
      .then((rows) => setRoleLabels(Array.isArray(rows) ? rows : []))
      .catch(() => setRoleLabels([]));
    window.addEventListener(SESSION_CHANGED, load);
    return () => window.removeEventListener(SESSION_CHANGED, load);
  }, [mode, user?.role, user?.instituteId]);

  // "Supervisor Session : July 2026" chip, for logins that have the Supervisor menu (old header).
  const hasSupervisor = mode === 'app' && supervisorMenuFor(user?.role, user?.authoritySlot).length > 0;
  useEffect(() => {
    if (!hasSupervisor) {
      setSupervisorLabel(null);
      return;
    }
    function load() {
      get('/supervisor/sessions/current')
        .then((row: { month?: string; year?: number } | null) => setSupervisorLabel(row?.month ? `${row.month} ${row.year}` : ''))
        .catch(() => setSupervisorLabel(null));
    }
    load();
    window.addEventListener(SUPERVISOR_SESSION_CHANGED, load);
    return () => window.removeEventListener(SUPERVISOR_SESSION_CHANGED, load);
  }, [hasSupervisor, user?.instituteId]);

  return (
    <div className="shell">
      <BrandBar
        logoUrl={mode === 'app' ? user?.institute?.logoUrl : undefined}
        title={barTitle}
        left={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button
              className="menu-toggle"
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <button
              className="back-btn"
              type="button"
              aria-label="Go back"
              title="Go back"
              onClick={() => navigate(-1)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span className="back-btn-label">Back</span>
            </button>
          </div>
        }
        right={
          <div className="brand-bar-user">
            {mode === 'app' ? (
              <div className="brand-session-chip" title={sessionLabel ? `Academic Session : ${sessionLabel}` : 'No academic session is active'}>
                Academic Session : <b>{sessionLabel || '—'}</b>
              </div>
            ) : null}
            {supervisorLabel !== null ? (
              <div className="brand-session-chip" title={supervisorLabel ? `Supervisor Session : ${supervisorLabel}` : 'No supervisor session is active'}>
                Supervisor Session : <b>{supervisorLabel || '—'}</b>
              </div>
            ) : null}
            <ProfileMenu user={user} panel={loginPanel} />
          </div>
        }
      />
      <button
        className={`side-backdrop${menuOpen ? ' on' : ''}`}
        type="button"
        aria-label="Close menu"
        onClick={() => setMenuOpen(false)}
      />
      <div className="shell-body">
        <aside className={`side${menuOpen ? ' open' : ''}`} style={color ? { background: color } : undefined}>
          <div className="brand">
            <div>
              {PRODUCT_NAME}
              <small>{mode === 'platform' ? 'Platform' : 'Workspace'}</small>
            </div>
            <button className="side-close" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
              ×
            </button>
          </div>
          <nav className="nav">
            {items.map((item: any, i) => {
              if (item.group) {
                return (
                  <div className="group" key={i}>
                    {item.group}
                  </div>
                );
              }
              if (item.section) {
                const open = sectionOpen(item.section);
                return (
                  <button
                    key={`section-${item.section}`}
                    type="button"
                    className={`nav-section${open ? ' open' : ''}`}
                    aria-expanded={open}
                    onClick={() => setOpenSections((s) => ({ ...s, [item.section]: !open }))}
                  >
                    <span>{item.label}</span>
                    <span className="nav-section-caret" aria-hidden>
                      ▾
                    </span>
                  </button>
                );
              }
              if (item.parent && !sectionOpen(item.parent)) return null;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `${isActive ? 'active' : ''}${item.child ? ' nav-child' : ''}${item.parent ? ' nav-sub' : ''}`
                  }
                >
                  {item.label}
                  {item.countKey && counts[item.countKey] && BADGE_VIEWS.has(item.countKey) ? (
                    <span className="nav-badge">{counts[item.countKey]}</span>
                  ) : null}
                </NavLink>
              );
            })}
          </nav>
          <div className="side-who">
            Logged in as
            <strong>{loginPanel || 'User'}</strong>
          </div>
        </aside>
        <div className="workspace" ref={workspaceRef}>
          <div className="main">{children}</div>
        </div>
      </div>
    </div>
  );
}
