import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { normalizeAuthoritySlot } from '../common/authority-slot';
import { text } from '../supervisor/supervisor-access';

/** Role rules of the Staff Duty menu (docs/staff-duty-plan.md §8.5). */

const slotOf = (user: AuthUser) => normalizeAuthoritySlot(user.authoritySlot);

/** Dealing enters staff, exam duties and preferences, allots and changes duties. */
export function canEdit(user: AuthUser) {
  return user.role === UserRole.DEALING;
}

export function isAce(user: AuthUser) {
  return user.role === UserRole.AUTHORITY && slotOf(user) === 'ACE';
}

/** Dealing or the Asstt. Controller locks the allotment; only the Asstt. Controller unlocks (Decision 7). */
export function canLock(user: AuthUser) {
  return canEdit(user) || isAce(user);
}

export function canUnlock(user: AuthUser) {
  return isAce(user);
}

/** Old menu: Dealing, ACE and Assoc. Dean; Institute Admin oversees. */
export function canView(user: AuthUser) {
  if (user.role === UserRole.DEALING || user.role === UserRole.INSTITUTE_ADMIN) return true;
  return user.role === UserRole.AUTHORITY && ['ACE', 'ASSOC_DEAN'].includes(slotOf(user));
}

/** Bank columns: not for the Assoc. Dean. */
export function canSeeBank(user: AuthUser) {
  return user.role === UserRole.DEALING || user.role === UserRole.INSTITUTE_ADMIN || isAce(user);
}

export function requireView(user: AuthUser) {
  if (!canView(user)) throw new ForbiddenException('You do not have the Staff Duty menu');
}

export function requireDealing(user: AuthUser) {
  if (!canEdit(user)) throw new ForbiddenException('Only the Dealing Assistant can do this');
}

/** Staff register fields of Add Examination Staff, old wording (StaffAdd.js). */
export function staffFields(body: Record<string, unknown>) {
  const f = {
    code: text(body.code, 50),
    name: text(body.name, 250),
    designation: text(body.designation, 200),
    department: text(body.department, 200),
    salaryCode: text(body.salaryCode, 250),
    bankName: text(body.bankName, 500),
    ifsc: text(body.ifsc, 15).toUpperCase(),
    account: text(body.account, 50).replace(/\s/g, ''),
    accountType: text(body.accountType, 20),
  };
  if (!f.code) throw new BadRequestException('Enter Code No.');
  if (!f.name) throw new BadRequestException('Enter Name');
  if (!f.designation) throw new BadRequestException('Please Select Designation');
  if (!f.department) throw new BadRequestException('Please Select Department');
  if (!f.salaryCode) throw new BadRequestException('Enter Salary Code');
  if (!f.bankName) throw new BadRequestException('Enter Bank Name');
  if (!f.ifsc) throw new BadRequestException('Enter IFSC Code');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc)) throw new BadRequestException('IFSC code is not valid (e.g. SBIN0001234)');
  if (!f.account) throw new BadRequestException('Enter Account Number');
  if (!/^\d{6,20}$/.test(f.account)) throw new BadRequestException('Account number must be 6 to 20 digits');
  if (!['Saving', 'Current'].includes(f.accountType)) throw new BadRequestException('Enter Account Type');
  return f;
}

export const DEFAULT_SETTINGS = {
  reportingTime: { Morning: '08:30 AM', Evening: '01:05 PM' },
  notes: [
    'Candidates entry has been started at 08:40 AM for the morning session and 01:10 PM for the afternoon session.  Accordingly, all the Invigilators are advised to report for Examination Duty before entry of the candidates.',
    'Without prior approval no staff will take any type of leave on the day of invigilation duty.',
    'Invigilation duty is not transferable. No staff will exchange Invigilation duty to any other staff without approval of the Controlling Officer.',
  ],
  titlePeriod: '',
};
