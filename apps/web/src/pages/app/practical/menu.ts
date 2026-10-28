/**
 * "Appointment of Practical Examiner" menu, in the same order and wording as the old eSTEMM
 * Dealing menu. `dealingOnly` items were not in the old Assoc. Dean / ACE menu.
 */
export type PracticalMenuItem = { path: string; label: string; dealingOnly?: boolean };

export const PRACTICAL_MENU: PracticalMenuItem[] = [
  { path: 'examiners', label: 'Download Examiner Details' },
  { path: 'appoint', label: 'Appointment of Examiner' },
  { path: 'assigned', label: 'Assign Examiner' },
  { path: 'edit', label: 'Edit Chairperson/Internal/External Examiner' },
  { path: 'to-dean', label: 'Assigned Examiner Send to Assoc. Dean' },
  { path: 'with-dean', label: 'Assigned Examiner Approval from Assoc. Dean' },
  { path: 'held', label: 'Hold practical examiner from Assoc. Dean' },
  { path: 'rejected-dean', label: 'Rejected practical examiner from Assoc. Dean' },
  { path: 'approved', label: 'Approved practical examiner from Assoc. Dean' },
  { path: 'offer', label: 'Approved Sent to Dealing and send Offer to Examiner' },
  { path: 'offer-pending', label: 'Pending Offer Letter & Re-Send Offer Letter' },
  { path: 'regret', label: 'Rejected from Practical Examiner' },
  { path: 'accepted', label: 'Accepted from Practical Examiner' },
  { path: 'portal', label: 'Pending/Resend Practical Portal' },
  { path: 'passcodes', label: 'Passcode Generated Examiner' },
  { path: 'chairperson', label: 'Chairperson Examiner Practical Date by Chairperson and Letter send Board of Examiners' },
  { path: 'air', label: 'Air Booking Examiner' },
  { path: 'question-papers', label: 'Upload Previous Question Paper' },
  { path: 'documents', label: 'Upload all Documents', dealingOnly: true },
  { path: 'letters', label: 'Download Assigned/ Approved/Accepted Letter', dealingOnly: true },
];

/** Authority slots that had this menu in old eSTEMM (AO did not). Spellings as in authority-slot.ts. */
const PRACTICAL_SLOTS = new Set(['ASSOC_DEAN', 'ASSOCIATE_DEAN', 'ASSOCDEAN', 'AD', 'ACE', 'ACADEMIC', 'ACADEMIC_SECTION']);

export function practicalMenuFor(role?: string, authoritySlot?: string) {
  if (role === 'DEALING') return PRACTICAL_MENU;
  if (role === 'INSTITUTE_ADMIN') return PRACTICAL_MENU.filter((m) => !m.dealingOnly);
  if (role === 'AUTHORITY') {
    const slot = String(authoritySlot || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    return PRACTICAL_SLOTS.has(slot) ? PRACTICAL_MENU.filter((m) => !m.dealingOnly) : [];
  }
  return [];
}
