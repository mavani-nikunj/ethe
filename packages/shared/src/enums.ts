export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  INSTITUTE_ADMIN: 'INSTITUTE_ADMIN',
  ACADEMIC: 'ACADEMIC',
  COURSE: 'COURSE',
  DEALING: 'DEALING',
  AUTHORITY: 'AUTHORITY',
  GUIDE: 'GUIDE',
  EXAMINER: 'EXAMINER',
  /** Books air tickets for practical examiners (old TravalManager login). */
  TRAVEL: 'TRAVEL',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Old submission logins were stored as DEPARTMENT. Treat them as COURSE (academic login). */
export function canonicalUserRole(role?: string): string {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'DEPARTMENT') return UserRole.COURSE;
  return r;
}

export function isCourseRole(role?: string): boolean {
  return canonicalUserRole(role) === UserRole.COURSE;
}

export function roleLabel(role?: string): string {
  const r = canonicalUserRole(role);
  if (r === UserRole.COURSE) return 'Academic';
  if (r === UserRole.ACADEMIC) return 'Academic Section';
  if (r === UserRole.TRAVEL) return 'Travel Manager';
  return r.replaceAll('_', ' ');
}

export const UserStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const InstituteStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type InstituteStatus = (typeof InstituteStatus)[keyof typeof InstituteStatus];

export const InstituteType = {
  MEDICAL: 'MEDICAL',
  UNIVERSITY: 'UNIVERSITY',
  COLLEGE: 'COLLEGE',
} as const;
export type InstituteType = (typeof InstituteType)[keyof typeof InstituteType];

export const StageType = {
  INITIATE: 'INITIATE',
  APPROVE: 'APPROVE',
  ASSIGN_NUMBER: 'ASSIGN_NUMBER',
  PANEL_REQUEST: 'PANEL_REQUEST',
  PANEL_BUILD: 'PANEL_BUILD',
  PANEL_SELECT: 'PANEL_SELECT',
  PANEL_VET: 'PANEL_VET',
  CONSENT_ROUTE: 'CONSENT_ROUTE',
  CONSENT: 'CONSENT',
  DISPATCH_THESIS: 'DISPATCH_THESIS',
  EVALUATE: 'EVALUATE',
  REVISION: 'REVISION',
  WAIT: 'WAIT',
  PICK_NTH: 'PICK_NTH',
  ADDITIONAL_PANEL: 'ADDITIONAL_PANEL',
  VIVA: 'VIVA',
  VIVA_DATE: 'VIVA_DATE',
  PRACTICAL: 'PRACTICAL',
  CLOSE: 'CLOSE',
} as const;
export type StageType = (typeof StageType)[keyof typeof StageType];

export const LetterKind = {
  OFFER: 'OFFER',
  THESIS: 'THESIS',
  REMINDER: 'REMINDER',
  REVISION: 'REVISION',
  CG_EVAL: 'CG_EVAL',
  VIVA: 'VIVA',
  BOARD: 'BOARD',
} as const;
export type LetterKind = (typeof LetterKind)[keyof typeof LetterKind];

export const PracticalRole = {
  CHAIRPERSON: 'CHAIRPERSON',
  INTERNAL: 'INTERNAL',
  EXTERNAL: 'EXTERNAL',
} as const;
export type PracticalRole = (typeof PracticalRole)[keyof typeof PracticalRole];

export const PRACTICAL_ROUND = 90;

/** Session-scoped practical examiner appointment (Appointment of Practical Examiner menu). */
export const PracticalStatus = {
  PENDING: 'PENDING',
  WITH_DEAN: 'WITH_DEAN',
  DEAN_HELD: 'DEAN_HELD',
  DEAN_REJECTED: 'DEAN_REJECTED',
  DEAN_APPROVED: 'DEAN_APPROVED',
  OFFER_SENT: 'OFFER_SENT',
  REGRETTED: 'REGRETTED',
  ACCEPTED: 'ACCEPTED',
  APPOINTED: 'APPOINTED',
} as const;
export type PracticalStatus = (typeof PracticalStatus)[keyof typeof PracticalStatus];

export const PRACTICAL_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  WITH_DEAN: 'Sent to Assoc. Dean',
  DEAN_HELD: 'Held by Assoc. Dean',
  DEAN_REJECTED: 'Rejected by Assoc. Dean',
  DEAN_APPROVED: 'Approved by Assoc. Dean',
  OFFER_SENT: 'Pending Offer',
  REGRETTED: 'Regret Offer',
  ACCEPTED: 'Accept Offer',
  APPOINTED: 'Sent Appointment to Examiner',
};

/** Supervisor appointment (theory exam supervisory duty). See docs/supervisor-plan.md §8.2. */
export const SupervisorStatus = {
  DRAFT: 'DRAFT',
  WITH_ACE: 'WITH_ACE',
  APPROVED: 'APPROVED',
  OFFER_SENT: 'OFFER_SENT',
  ACCEPTED: 'ACCEPTED',
  REGRETTED: 'REGRETTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type SupervisorStatus = (typeof SupervisorStatus)[keyof typeof SupervisorStatus];

export const SUPERVISOR_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Not sent',
  WITH_ACE: 'With Asstt. Controller',
  APPROVED: 'Approved by Asstt. Controller',
  OFFER_SENT: 'Offer sent',
  ACCEPTED: 'Accepted',
  REGRETTED: 'Regretted',
  WITHDRAWN: 'Withdrawn',
};

/** Shifts of Add Schedule with the fixed exam time and default reporting time (old AddSchedule.js / SupervisorAdd.js). */
export const SUPERVISOR_SHIFTS = [
  { name: 'Morning', time: '09:30 AM to 12:30 PM', reportingTime: '09:10 AM' },
  { name: 'Evening', time: '02:00 PM to 05:00 PM', reportingTime: '01:40 PM' },
] as const;

/** Staff Duty roles (examination staff invigilation duty). See docs/staff-duty-plan.md. */
export const DutyRole = {
  ALL_DUTY: 'ALL_DUTY',
  SUPERVISOR: 'SUPERVISOR',
  INVIGILATOR: 'INVIGILATOR',
  SUPPORTING: 'SUPPORTING',
} as const;
export type DutyRole = (typeof DutyRole)[keyof typeof DutyRole];

/** Labels as on the old screens, in the old column order. */
export const DUTY_ROLES: { key: DutyRole; label: string; need: string }[] = [
  { key: 'ALL_DUTY', label: 'All Duty', need: 'All Duty' },
  { key: 'SUPERVISOR', label: 'Supervisor', need: 'Supervisor' },
  { key: 'INVIGILATOR', label: 'Invigilator', need: 'Invigilation' },
  { key: 'SUPPORTING', label: 'Supporting', need: 'Supporting' },
];

export const DUTY_ROLE_LABELS: Record<string, string> = Object.fromEntries(DUTY_ROLES.map((r) => [r.key, r.label]));

/** Shift preference of a staff member: any shift, or only one. */
export const DUTY_SHIFT_PREFERENCES = ['ANY', 'Morning', 'Evening'] as const;

export const PracticalExaminerType = {
  CHAIRPERSON: 'CHAIRPERSON',
  INTERNAL: 'INTERNAL',
  OBSERVER: 'OBSERVER',
  EXTERNAL: 'EXTERNAL',
  COORDINATOR: 'COORDINATOR',
} as const;
export type PracticalExaminerType = (typeof PracticalExaminerType)[keyof typeof PracticalExaminerType];

/** Order, labels and examiner-code letters follow the old AppoinmentExaminerType master. */
export const PRACTICAL_EXAMINER_TYPES = [
  { code: 'CHAIRPERSON', label: 'Chairperson', letter: 'A', order: 1 },
  { code: 'INTERNAL', label: 'Internal Examiner', letter: 'B', order: 2 },
  { code: 'OBSERVER', label: 'Observer', letter: 'C', order: 3 },
  { code: 'EXTERNAL', label: 'External Examiner', letter: 'D', order: 4 },
  { code: 'COORDINATOR', label: 'Exam Coordinator', letter: 'A', order: 5 },
] as const;

export function practicalTypeLabel(code?: string): string {
  return PRACTICAL_EXAMINER_TYPES.find((t) => t.code === code)?.label || String(code || '');
}

/** Chairperson and Exam Coordinator fix the practical date and get the chairperson mails. */
export function isPracticalChair(code?: string): boolean {
  return code === PracticalExaminerType.CHAIRPERSON || code === PracticalExaminerType.COORDINATOR;
}

/**
 * Documents shown on the examiner portal (old "Upload all Documents" upload types).
 * Course-scoped types are uploaded per course; global ones once for the institute.
 */
export const PRACTICAL_DOC_TYPES = [
  { code: 1, label: 'Examination Guideline', perCourse: true },
  { code: 2, label: 'Format of New Question Paper', perCourse: true },
  { code: 3, label: 'Remuneration', perCourse: true },
  { code: 4, label: 'Air', perCourse: false },
  { code: 5, label: 'Rail', perCourse: false },
  { code: 6, label: 'Road', perCourse: false },
  { code: 7, label: 'Boarding and Lodging (DA)', perCourse: false },
] as const;
export const PRACTICAL_QUESTION_PAPER = 'QUESTION_PAPER';

/** Air booking requested on the examiner portal and handled by the Travel Manager. */
export const PracticalAirStatus = {
  REQUESTED: 'REQUESTED',
  SENT_TO_TM: 'SENT_TO_TM',
  SENT_TO_AGENT: 'SENT_TO_AGENT',
  TICKET_UPLOADED: 'TICKET_UPLOADED',
  TICKET_SENT: 'TICKET_SENT',
  CANCELLED: 'CANCELLED',
} as const;
export type PracticalAirStatus = (typeof PracticalAirStatus)[keyof typeof PracticalAirStatus];

export const PRACTICAL_AIR_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Requested by examiner',
  SENT_TO_TM: 'With Travel Manager',
  SENT_TO_AGENT: 'Sent to travel agent',
  TICKET_UPLOADED: 'Ticket uploaded',
  TICKET_SENT: 'Ticket sent to examiner',
  CANCELLED: 'Cancelled',
};

export const PracticalDateMail = {
  PENDING: 'PENDING',
  REQUESTED: 'REQUESTED',
  FIXED: 'FIXED',
} as const;

export const PracticalLookupKind = {
  DESIGNATION: 'DESIGNATION',
  DEPARTMENT: 'DEPARTMENT',
  SCHEDULE: 'SCHEDULE',
} as const;
export type PracticalLookupKind = (typeof PracticalLookupKind)[keyof typeof PracticalLookupKind];

export const AcceptGrade = {
  HIGHLY_COMMENDABLE: 'HIGHLY_COMMENDABLE',
  COMMENDABLE: 'COMMENDABLE',
  SATISFACTORY: 'SATISFACTORY',
} as const;
export type AcceptGrade = (typeof AcceptGrade)[keyof typeof AcceptGrade];

export const VetStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  HELD: 'HELD',
  REJECTED: 'REJECTED',
} as const;
export type VetStatus = (typeof VetStatus)[keyof typeof VetStatus];

export const InboxLane = {
  ACE_REVIEW: 'ACE_REVIEW',
  NEED_NUMBER: 'NEED_NUMBER',
  DEAN_CG: 'DEAN_CG',
  PANEL_REQUEST: 'PANEL_REQUEST',
  PANEL_PENDING_CG: 'PANEL_PENDING_CG',
  PANEL_SELECT: 'PANEL_SELECT',
  PANEL_VET: 'PANEL_VET',
  OFFER_HOP: 'OFFER_HOP',
  CONSENT: 'CONSENT',
  THESIS_HOP: 'THESIS_HOP',
  DISPATCH: 'DISPATCH',
  EVALUATE: 'EVALUATE',
  REMINDER: 'REMINDER',
  REVISION: 'REVISION',
  WAIT_TWO: 'WAIT_TWO',
  CG_EVAL: 'CG_EVAL',
  NTH: 'NTH',
  ADDITIONAL_PANEL: 'ADDITIONAL_PANEL',
  VIVA: 'VIVA',
  PRACTICAL: 'PRACTICAL',
  ON_HOLD: 'ON_HOLD',
  RESULT_HELD: 'RESULT_HELD',
  CLOSE: 'CLOSE',
  OTHER: 'OTHER',
} as const;
export type InboxLane = (typeof InboxLane)[keyof typeof InboxLane];

export const INBOX_LANE_LABELS: Record<string, string> = {
  ACE_REVIEW: 'With ACE — new file',
  NEED_NUMBER: 'Dealing — exam file no. + thesis no.',
  DEAN_CG: 'Assoc Dean — Chief Guide approval',
  PANEL_REQUEST: 'Request panel from CG',
  PANEL_PENDING_CG: 'Panel pending from CG',
  PANEL_SELECT: 'Assign / select examiners',
  PANEL_VET: 'Authority vet (approve / hold / reject)',
  OFFER_HOP: 'Offer letter in approval hop',
  CONSENT: 'Offer — pending accept / regret',
  THESIS_HOP: 'Thesis letter in approval hop',
  DISPATCH: 'Dispatch thesis letter',
  EVALUATE: 'Pending evaluation',
  REMINDER: 'Evaluation reminder letter hop',
  REVISION: 'Revision / modification',
  WAIT_TWO: 'Wait for two accepts',
  CG_EVAL: 'Chief Guide evaluation',
  NTH: '4th examiner',
  ADDITIONAL_PANEL: 'Additional panel (pool empty)',
  VIVA: 'Viva-voce / practical',
  PRACTICAL: 'Practical examiner',
  ON_HOLD: 'File on hold',
  RESULT_HELD: 'Result held',
  CLOSE: 'Ready to close',
  OTHER: 'Other',
};

export const FileStatus = {
  DRAFT: 'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
} as const;
export type FileStatus = (typeof FileStatus)[keyof typeof FileStatus];

export const MetroStatus = {
  COMPLETED: 'COMPLETED',
  CURRENT: 'CURRENT',
  UPCOMING: 'UPCOMING',
  HOLD: 'HOLD',
  REJECTED: 'REJECTED',
  SKIPPED: 'SKIPPED',
} as const;
export type MetroStatus = (typeof MetroStatus)[keyof typeof MetroStatus];

export const ConsentStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REGRETTED: 'REGRETTED',
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const Verdict = {
  ACCEPT: 'ACCEPT',
  REVISION: 'REVISION',
  REJECT: 'REJECT',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export const ReportAnswer = {
  YES: 'YES',
  NO: 'NO',
  CANT_SAY: 'CANT_SAY',
} as const;
export type ReportAnswer = (typeof ReportAnswer)[keyof typeof ReportAnswer];

export const EVALUATION_REPORT_ITEMS = [
  { key: 'workOriginal', no: '1.', label: 'Is the thesis work original?' },
  { key: 'design', no: '', label: 'i. Design', group: 'Is the thesis scientifically reliable?' },
  { key: 'techniques', no: '', label: 'ii. Techniques' },
  { key: 'results', no: '', label: 'iii. Results' },
  { key: 'interpretation', no: '', label: 'iv. Interpretation' },
  { key: 'worthPublication', no: '3.', label: 'Is the research work worth publication?' },
  { key: 'statisticalTreatment', no: '4.', label: 'Is the statistical treatment of the data appropriate and adequate?' },
  { key: 'majorConclusions', no: '5.', label: 'Are the major conclusions of the thesis justified and clearly presented?' },
  { key: 'references', no: '6.', label: 'Are the references up-to-date and relevant?' },
  { key: 'figures', no: '7.', label: 'Are the figures correctly drawn with proper legends?' },
  { key: 'repetition', no: '8.', label: 'Is there any unnecessary repetition of information in the text?' },
] as const;

export const ResultHoldStatus = {
  RELEASE: 'RELEASE',
  HOLD: 'HOLD',
} as const;
export type ResultHoldStatus = (typeof ResultHoldStatus)[keyof typeof ResultHoldStatus];

export const TemplateChannel = {
  EMAIL: 'EMAIL',
  LETTER: 'LETTER',
  SMS: 'SMS',
} as const;
export type TemplateChannel = (typeof TemplateChannel)[keyof typeof TemplateChannel];

export const DEFAULT_AUTHORITY_SLOTS = [
  { code: 'ACE', label: 'ACE' },
  { code: 'AO', label: 'AO' },
  { code: 'ASSOC_DEAN', label: 'Associate Dean' },
] as const;

export const PLACEHOLDERS = [
  '{{candidateName}}',
  '{{enrollmentNo}}',
  '{{thesisTitle}}',
  '{{thesisNumber}}',
  '{{department}}',
  '{{course}}',
  '{{courseType}}',
  '{{speciality}}',
  '{{instituteName}}',
  '{{chiefGuideName}}',
  '{{chiefGuideEmail}}',
  '{{examinerName}}',
  '{{examinerDesignation}}',
  '{{stageName}}',
  '{{feeAmount}}',
  '{{taskLink}}',
  '{{otp}}',
  '{{fileNo}}',
  '{{reminderLevel}}',
  '{{panelList}}',
  '{{vivaTime}}',
  '{{vivaVenue}}',
  '{{sessionMonth}}',
  '{{sessionYear}}',
  '{{date}}',
  '{{logoUrl}}',
  '{{adName}}',
  '{{adEmail}}',
] as const;
