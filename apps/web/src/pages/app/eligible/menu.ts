/**
 * "Eligible Candidate" menu, in the same order and wording as the old eSTEMM Dealing menu.
 * `dealingOnly` items were not in the old Assoc. Dean / ACE menu. See docs/eligible-candidate-plan.md.
 */
export type EligibleMenuItem = { path: string; label: string; dealingOnly?: boolean };

export const ELIGIBLE_MENU: EligibleMenuItem[] = [
  // Old menu showed this to ACE / Assoc. Dean too, but they are view-only, so the form is Dealing-only.
  { path: 'add', label: 'Add Old Candidate', dealingOnly: true },
  { path: 'previous', label: 'Previous Candidate', dealingOnly: true },
  { path: 'eligible', label: 'List of Eligible Candidate' },
  { path: 'not-eligible', label: 'List of Not Eligible Candidate' },
  { path: 'with-paper', label: 'Eligible Candidate Seat Allotment' },
  { path: 'halls', label: 'Hall Master', dealingOnly: true },
  { path: 'seat-allotment', label: 'Seat Allotment', dealingOnly: true },
  { path: 'seat-reports', label: 'Seat Allotment Reports', dealingOnly: true },
];

/** Authority slots that had this menu in old eSTEMM (ACE and Assoc. Dean). */
const ELIGIBLE_SLOTS = new Set(['ASSOC_DEAN', 'ASSOCIATE_DEAN', 'ASSOCDEAN', 'AD', 'ACE']);

export function eligibleMenuFor(role?: string, authoritySlot?: string) {
  if (role === 'DEALING') return ELIGIBLE_MENU;
  if (role === 'INSTITUTE_ADMIN') return ELIGIBLE_MENU.filter((m) => !m.dealingOnly);
  if (role === 'AUTHORITY') {
    const slot = String(authoritySlot || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return ELIGIBLE_SLOTS.has(slot) ? ELIGIBLE_MENU.filter((m) => !m.dealingOnly) : [];
  }
  return [];
}
