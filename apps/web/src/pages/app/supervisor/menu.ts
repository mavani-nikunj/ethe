/**
 * "Supervisor" menu, in the same order and wording as the old eSTEMM Dealing menu.
 * `dealingOnly` items were not in the old ACE / Assoc. Dean menu. See docs/supervisor-plan.md §2.
 */
export type SupervisorMenuItem = { path: string; label: string; dealingOnly?: boolean };

export const SUPERVISOR_MENU: SupervisorMenuItem[] = [
  { path: 'session', label: 'Supervisor Session' },
  { path: 'schedule', label: 'Add Schedule', dealingOnly: true },
  { path: 'people', label: 'Edit All Supervisor', dealingOnly: true },
  { path: 'add', label: 'Add New Supervisor' },
  { path: 'day-wise', label: 'Day Wise Supervisor' },
  { path: 'to-ace', label: 'Send Supervisor to Asstt. Controller' },
  { path: 'with-ace', label: 'Approval from Asstt. Controller' },
  { path: 'approved', label: 'Approved Supervisor Sent to Dealing' },
  { path: 'offer-pending', label: 'Pending / Resend Offer letter' },
  { path: 'accepted', label: 'Accepted from Supervisor' },
  { path: 'regretted', label: 'Rejected from Supervisor' },
  { path: 'letters', label: 'Download Letter/Acceptance', dealingOnly: true },
];

/** Authority slots that had this menu in old eSTEMM (ACE and Assoc. Dean). Spellings as in authority-slot.ts. */
const SUPERVISOR_SLOTS = new Set(['ASSOC_DEAN', 'ASSOCIATE_DEAN', 'ASSOCDEAN', 'AD', 'ACE', 'ACADEMIC', 'ACADEMIC_SECTION']);

export function supervisorMenuFor(role?: string, authoritySlot?: string) {
  if (role === 'DEALING') return SUPERVISOR_MENU;
  if (role === 'INSTITUTE_ADMIN') return SUPERVISOR_MENU.filter((m) => !m.dealingOnly);
  if (role === 'AUTHORITY') {
    const slot = String(authoritySlot || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return SUPERVISOR_SLOTS.has(slot) ? SUPERVISOR_MENU.filter((m) => !m.dealingOnly) : [];
  }
  return [];
}

/** Fired after the active supervisor session changes, so the header chip reloads. */
export const SUPERVISOR_SESSION_CHANGED = 'ethesis:supervisor-session-changed';
