import { PLACEHOLDERS, PRODUCT_NAME } from '@ethesis/shared';
import { PRACTICAL_DEFAULTS, PracticalMail } from '../../practical/practical-templates';
import { SUPERVISOR_DEFAULTS, SupervisorMail } from '../../supervisor/supervisor-templates';
import {
  DEFAULT_BOARD_LETTER,
  DEFAULT_CG_EVAL_LETTER,
  DEFAULT_CONSENT_BODY,
  DEFAULT_EVALUATE_BODY,
  DEFAULT_OFFER_LETTER,
  DEFAULT_PANEL_BODY,
  DEFAULT_PANEL_SUBMITTED_BODY,
  DEFAULT_REMINDER_LETTER,
  DEFAULT_REVISION_BODY,
  DEFAULT_REVISION_EXAMINER_LETTER,
  DEFAULT_REVISION_LETTER,
  DEFAULT_THESIS_LETTER,
  DEFAULT_VIVA_BODY,
  DEFAULT_VIVA_LETTER,
  letterMail,
} from './thesis-defaults';
import { SYSTEM_DEFAULTS } from './system-defaults';

export type TemplateChannel = 'EMAIL' | 'LETTER';

/**
 * One mail or letter the platform sends. The text here is only the starting copy: it is inserted into the
 * institute's Email / Letter master the first time it is needed, and from then on the master's copy is what goes out.
 */
export type CatalogEntry = {
  channel: TemplateChannel;
  purpose: string;
  group: string;
  name: string;
  stageCode?: string;
  subject: string;
  body: string;
  placeholders: string[];
};

const strip = (list: readonly string[]) => list.map((p) => p.replace(/[{}]/g, ''));
const THESIS_VARS = [...strip(PLACEHOLDERS), 'vivaDate'];

const PRACTICAL_VARS = [
  'instituteName', 'logoUrl', 'adName', 'adEmail', 'fileNo', 'date',
  'examinerName', 'examinerType', 'examinerCode', 'designation', 'department', 'examinerInstitute', 'examinerAddress',
  'mobile', 'email', 'course', 'speciality', 'sessionMonth', 'sessionYear', 'examName', 'subjectCode',
  'tentativeSchedule', 'tentativeSentence', 'practicalDate', 'marks', 'deanName', 'deanEmail', 'deanSignature',
  'dealingEmail', 'boardTable', 'taskLink', 'portalLink', 'requestDate',
];

const PRACTICAL_EXTRA_VARS: Record<string, string[]> = {
  [PracticalMail.OTP]: ['otp'],
  [PracticalMail.PORTAL_PASSCODE]: ['otp'],
  [PracticalMail.REPLACEMENT_INFO]: ['regrettedExaminer', 'newExaminer', 'newExaminerType'],
  [PracticalMail.TRAVEL_BOOKING]: ['agentName', 'senderName', 'bookingTable'],
  [PracticalMail.TRAVEL_TICKET]: ['ticketLink', 'bookingTable'],
  [PracticalMail.TRAVEL_CANCEL]: ['agentName', 'senderName', 'cancelReason', 'bookingTable'],
};

const PRACTICAL_NAMES: Record<string, string> = {
  [PracticalMail.OFFER]: 'Offer of examinership (offer letter)',
  [PracticalMail.OFFER_COORDINATOR]: 'Offer as exam coordinator',
  [PracticalMail.REPLACEMENT_INFO]: 'Change in Board of Examiners (replacement)',
  [PracticalMail.ACCEPTED]: 'Offer accepted — thank you',
  [PracticalMail.REGRETTED]: 'Offer regretted — thank you',
  [PracticalMail.OTP]: 'Offer link passcode',
  [PracticalMail.APPOINTMENT]: 'Appointment letter',
  [PracticalMail.PORTAL_PASSCODE]: 'Examiner portal passcode',
  [PracticalMail.DATE_REQUEST_CHAIR]: 'Request to Chairperson for practical date',
  [PracticalMail.DATE_REQUEST_ALL]: 'Practical date — information to examiner',
  [PracticalMail.DATE_REMINDER]: 'Reminder to Chairperson for practical date',
  [PracticalMail.DATE_FIXED]: 'Practical date fixed',
  [PracticalMail.TRAVEL_BOOKING]: 'Air ticket booking request — to agent',
  [PracticalMail.TRAVEL_TICKET]: 'Air ticket — to examiner',
  [PracticalMail.TRAVEL_CANCEL]: 'Air ticket cancellation — to agent',
};

const SUPERVISOR_VARS = [
  'instituteName', 'logoUrl', 'adName', 'adEmail', 'fileNo', 'date',
  'supervisorName', 'designation', 'department', 'supervisorInstitute', 'address', 'mobile', 'email',
  'sessionMonth', 'sessionYear', 'dutyTable', 'aceName', 'aceSignature', 'dealingEmail', 'taskLink',
];

const SUPERVISOR_NAMES: Record<string, string> = {
  [SupervisorMail.OFFER]: 'Appointment as Supervisor (offer letter)',
  [SupervisorMail.ACCEPTED]: 'Supervisory duty — acceptance letter',
  [SupervisorMail.REGRETTED]: 'Supervisory duty — regret letter',
  [SupervisorMail.OTP]: 'Supervisor link passcode',
};

const thesis = (
  channel: TemplateChannel,
  purpose: string,
  name: string,
  stageCode: string,
  subject: string,
  body: string,
): CatalogEntry => ({ channel, purpose, group: 'Thesis', name, stageCode, subject, body, placeholders: THESIS_VARS });

export const TEMPLATE_CATALOG: CatalogEntry[] = [
  thesis('EMAIL', 'PANEL_BUILD', 'Request panel from Chief Guide', 'panel_request', `${PRODUCT_NAME}: Panel of examiners — {{candidateName}}`, DEFAULT_PANEL_BODY),
  thesis('EMAIL', 'PANEL_SUBMITTED', 'Panel submitted confirmation to Chief Guide', 'panel_submitted', `${PRODUCT_NAME}: Panel submitted — {{candidateName}}`, DEFAULT_PANEL_SUBMITTED_BODY),
  thesis('EMAIL', 'CONSENT', 'Examiner offer', 'consent', `${PRODUCT_NAME}: Examiner offer — {{candidateName}}`, DEFAULT_CONSENT_BODY),
  thesis('EMAIL', 'EVALUATE', 'Thesis / evaluation mail', 'dispatch', `${PRODUCT_NAME}: Thesis and evaluation report — {{candidateName}}`, DEFAULT_EVALUATE_BODY),
  thesis('EMAIL', 'VIVA_DATE', 'Fix viva / practical date — Chief Guide', 'viva_date', `${PRODUCT_NAME}: Fix viva date — {{candidateName}}`, DEFAULT_VIVA_BODY),
  thesis('EMAIL', 'REVISION', 'Upload revised thesis — Chief Guide', 'revision_upload', `${PRODUCT_NAME}: Revised thesis — {{candidateName}}`, DEFAULT_REVISION_BODY),
  thesis('EMAIL', 'VIVA', 'Final viva letter — Chief Guide', 'viva_final_send', `${PRODUCT_NAME}: Viva-voce letter — {{candidateName}}`, letterMail(DEFAULT_VIVA_LETTER)),

  thesis('LETTER', 'OFFER', 'Examiner offer letter', 'consent', 'Examiner offer — {{candidateName}}', DEFAULT_OFFER_LETTER),
  thesis('LETTER', 'THESIS', 'Thesis letter', 'dispatch', 'Thesis for evaluation — {{candidateName}}', DEFAULT_THESIS_LETTER),
  thesis('LETTER', 'REMINDER', 'Evaluation reminder letter', 'evaluate', 'Reminder {{reminderLevel}} — {{candidateName}}', DEFAULT_REMINDER_LETTER),
  thesis('LETTER', 'REVISION', 'Chief Guide revision letter (approved AD)', 'revision_letter', 'Revision / modification — {{candidateName}}', DEFAULT_REVISION_LETTER),
  thesis('LETTER', 'REVISION_EXAMINER', 'Examiner revised thesis letter (approved AD)', 'revision_dispatch', 'Re-evaluation of revised thesis — {{candidateName}}', DEFAULT_REVISION_EXAMINER_LETTER),
  thesis('LETTER', 'CG_EVAL', 'Chief Guide evaluation letter', 'cg_eval_send', 'Chief Guide evaluation — {{candidateName}}', DEFAULT_CG_EVAL_LETTER),
  thesis('LETTER', 'VIVA', 'Viva-voce / practical letter', 'viva_send', 'Viva-voce / practical — {{candidateName}}', DEFAULT_VIVA_LETTER),
  thesis('LETTER', 'BOARD', 'Letter to Board of Examiners', 'practical_date', 'Board of Examiners — {{candidateName}}', DEFAULT_BOARD_LETTER),

  ...Object.entries(PRACTICAL_DEFAULTS).map(([purpose, d]) => ({
    channel: 'EMAIL' as const,
    purpose,
    group: 'Practical examiner',
    name: PRACTICAL_NAMES[purpose] || purpose,
    subject: d.subject,
    body: d.body,
    placeholders: [...PRACTICAL_VARS, ...(PRACTICAL_EXTRA_VARS[purpose] || [])],
  })),

  ...Object.entries(SUPERVISOR_DEFAULTS)
    .filter(([purpose]) => purpose !== SupervisorMail.OFFER_SMS)
    .map(([purpose, d]) => ({
      channel: 'EMAIL' as const,
      purpose,
      group: 'Supervisor',
      name: SUPERVISOR_NAMES[purpose] || purpose,
      subject: d.subject,
      body: d.body,
      placeholders: purpose === SupervisorMail.OTP ? [...SUPERVISOR_VARS, 'otp'] : SUPERVISOR_VARS,
    })),

  ...Object.entries(SYSTEM_DEFAULTS).map(([purpose, d]) => ({
    channel: 'EMAIL' as const,
    purpose,
    group: 'System',
    name: d.name,
    subject: d.subject,
    body: d.body,
    placeholders: d.placeholders,
  })),
];

export function catalogEntry(purpose: string, channel: string = 'EMAIL') {
  const ch = String(channel || 'EMAIL').toUpperCase();
  return TEMPLATE_CATALOG.find((e) => e.purpose === purpose && e.channel === ch);
}

export function catalogFor(channel?: string) {
  const ch = String(channel || '').toUpperCase();
  return ch ? TEMPLATE_CATALOG.filter((e) => e.channel === ch) : TEMPLATE_CATALOG;
}
