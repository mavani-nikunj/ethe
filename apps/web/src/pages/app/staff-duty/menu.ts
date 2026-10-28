/**
 * "Staff Duty" menu, same labels and order as the old eSTEMM Dealing menu.
 * `dealingOnly` items were not in the old ACE / Assoc. Dean menu. See docs/staff-duty-plan.md §2, §8.4.
 */
export type StaffDutyMenuItem = { path: string; label: string; dealingOnly?: boolean };

export const STAFF_DUTY_MENU: StaffDutyMenuItem[] = [
  { path: 'staff', label: 'Add Staff', dealingOnly: true },
  { path: 'assigned', label: 'Duty Assigned' },
  { path: 'allotment', label: 'Duty Allotment' },
];

/** Authority slots that had this menu in old eSTEMM (ACE and Assoc. Dean). Spellings as in authority-slot.ts. */
const STAFF_DUTY_SLOTS = new Set(['ASSOC_DEAN', 'ASSOCIATE_DEAN', 'ASSOCDEAN', 'AD', 'ACE', 'ACADEMIC', 'ACADEMIC_SECTION']);

export function staffDutyMenuFor(role?: string, authoritySlot?: string) {
  if (role === 'DEALING') return STAFF_DUTY_MENU;
  if (role === 'INSTITUTE_ADMIN') return STAFF_DUTY_MENU.filter((m) => !m.dealingOnly);
  if (role === 'AUTHORITY') {
    const slot = String(authoritySlot || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return STAFF_DUTY_SLOTS.has(slot) ? STAFF_DUTY_MENU.filter((m) => !m.dealingOnly) : [];
  }
  return [];
}
