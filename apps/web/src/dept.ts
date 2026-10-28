export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthsFromSessions(sessions: { month?: string }[] = [], extra?: string) {
  const have = new Set(sessions.map((s) => String(s.month || '').trim()).filter(Boolean));
  if (extra) have.add(extra);
  const ordered = MONTHS.filter((m) => have.has(m));
  return ordered.length ? ordered : MONTHS;
}

export function yearsFromSessions(sessions: { year?: number | string }[] = [], extra?: string | number) {
  const have = new Set(
    sessions
      .map((s) => Number(s.year))
      .filter((y) => Number.isFinite(y) && y > 1900)
      .map(String),
  );
  if (extra) have.add(String(extra));
  const years = [...have].sort((a, b) => Number(b) - Number(a));
  return years.length ? years : [String(new Date().getFullYear())];
}

export function sessionYearChoices(sessions: { year?: number | string }[] = [], extra?: string | number) {
  const now = new Date().getFullYear();
  const have = new Set<string>();
  for (let y = now - 5; y <= now + 5; y++) have.add(String(y));
  for (const s of sessions) {
    const y = Number(s.year);
    if (Number.isFinite(y) && y > 1900) have.add(String(y));
  }
  if (extra) have.add(String(extra));
  return [...have].sort((a, b) => Number(b) - Number(a));
}

export function validateCandidate(
  form: {
    sessionMonth?: string;
    sessionYear?: string;
    sessionId?: string;
    courseId?: string;
    specialityId?: string;
    departmentId?: string;
    enrollmentNo?: string;
    candidateName?: string;
    dob?: string;
    mobile?: string;
    candidateEmail?: string;
    title?: string;
    chiefGuideId?: string;
  },
  opts?: { requirePdf?: boolean; hasPdf?: boolean },
) {
  const errors: Record<string, string> = {};
  if (!form.sessionId && (!form.sessionMonth || !form.sessionYear)) errors.sessionMonth = 'Session month and year are required';
  if (!form.courseId) errors.courseId = 'Name of Course is required';
  if (!form.specialityId) errors.specialityId = 'Name of Speciality is required';
  if (!form.departmentId) errors.departmentId = 'Name of Department is required';
  if (!String(form.title || '').trim()) errors.title = 'Thesis title is required';
  if (!form.chiefGuideId) errors.chiefGuideId = 'Chief Guide is required';
  if (opts?.requirePdf && !opts.hasPdf) errors.pdf = 'Thesis PDF is required';
  const enrollment = String(form.enrollmentNo || '').trim();
  if (!enrollment) errors.enrollmentNo = 'Enrollment No. is required';
  const name = String(form.candidateName || '').trim();
  if (!name || name.length < 3) errors.candidateName = 'Name of Candidate must be at least 3 characters';
  else if (!/^[A-Za-z][A-Za-z .'-]{1,}$/.test(name)) errors.candidateName = 'Use letters, spaces, apostrophes and hyphens only';
  const dob = String(form.dob || '').trim();
  if (!dob) errors.dob = 'DOB of Candidate is required';
  else {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) errors.dob = 'DOB of Candidate is invalid';
    else {
      if (d < new Date('1920-01-01')) errors.dob = 'DOB cannot be before 1920';
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (d > today) errors.dob = 'DOB cannot be in the future';
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (!errors.dob && age < 16) errors.dob = 'Candidate must be at least 16 years old';
    }
  }
  const mobile = String(form.mobile || '').replace(/\D/g, '');
  if (!mobile) errors.mobile = 'Mobile No. of Candidate is required';
  else if (!/^[6-9]\d{9}$/.test(mobile)) errors.mobile = 'Enter a 10-digit Indian mobile number';
  const email = String(form.candidateEmail || '').trim();
  if (!email) errors.candidateEmail = 'Email Id of Candidate is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.candidateEmail = 'Enter a valid email address';
  return errors;
}

export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: any[]) {
  const lines = [
    columns.map((c) => c.label).join(','),
    ...rows.map((r) => columns.map((c) => JSON.stringify(r[c.key] ?? '')).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export function copyRows(columns: { key: string; label: string }[], rows: any[]) {
  const text = [
    columns.map((c) => c.label).join('\t'),
    ...rows.map((r) => columns.map((c) => String(r[c.key] ?? '')).join('\t')),
  ].join('\n');
  return navigator.clipboard.writeText(text);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function printRows(title: string, columns: { key: string; label: string }[], rows: any[]) {
  document.querySelectorAll('.grid-print-area').forEach((el) => el.remove());
  const heading = escapeHtml(title || 'Export');
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr>${columns.map((c) => `<td>${escapeHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`,
        )
        .join('')
    : `<tr><td colspan="${Math.max(columns.length, 1)}">No records</td></tr>`;
  const host = document.createElement('div');
  host.className = 'grid-print-area';
  host.innerHTML = `<h1>${heading}</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  document.body.appendChild(host);
  const cleanup = () => host.remove();
  window.addEventListener('afterprint', cleanup, { once: true });
  window.requestAnimationFrame(() => window.print());
}

export function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN');
}
