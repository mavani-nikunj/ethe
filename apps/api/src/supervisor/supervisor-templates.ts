import { LETTERHEAD_HTML } from '@ethesis/shared';

/** Mail purposes. An active CommTemplate with the same purpose overrides the built-in text. */
export const SupervisorMail = {
  OFFER: 'SUPERVISOR_OFFER',
  ACCEPTED: 'SUPERVISOR_ACCEPTED',
  REGRETTED: 'SUPERVISOR_REGRETTED',
  OTP: 'SUPERVISOR_OTP',
  /** Kept for when an SMS provider is added (old SmsTemp9). */
  OFFER_SMS: 'SUPERVISOR_OFFER_SMS',
} as const;

/** Letter kinds printed from "Download Letter/Acceptance" and the list pages. */
export const SUPERVISOR_LETTERS: Record<string, string> = {
  offer: SupervisorMail.OFFER,
  acceptance: SupervisorMail.ACCEPTED,
  regret: SupervisorMail.REGRETTED,
};

/** Old eSTEMM letterhead (title, logo, address, File No · CONFIDENTIAL · date) followed by the recipient block. */
export const SUPERVISOR_LETTER_HEAD = `${LETTERHEAD_HTML}
<p>{{supervisorName}}<br>{{designation}}<br>Department of {{department}}<br>{{supervisorInstitute}}<br>{{address}}</p>`;

export const SUPERVISOR_SIGN_OFF = `<p>With best regards</p>
<p>Yours sincerely,<br>{{aceSignature}}{{aceName}}<br>Asstt. Controller (Exams)</p>`;

/** Wording follows the old eSTEMM templates (SupervisorTemplate.html, SupervisorAccepted.html, RejectSupervisor.html). */
export const SUPERVISOR_DEFAULTS: Record<string, { subject: string; body: string }> = {
  [SupervisorMail.OFFER]: {
    subject: 'Appointment as Supervisor – Professional Theory Examination ({{sessionMonth}} {{sessionYear}})',
    body: `${SUPERVISOR_LETTER_HEAD}
<p>Dear Sir/Madam,</p>
<p>I have been directed to inform that you have been appointed as <b>Supervisor</b> for the Professional Theory Examination for PG / UG students to be held in <b>{{sessionMonth}} {{sessionYear}}</b> at Examination Section, {{instituteName}} by the competent authority in this regard.</p>
<p>Kindly make it convenient to reach at the Examination Section as per following schedule:</p>
{{dutyTable}}
<p>May I request you to kindly confirm your acceptance and provide bank details &amp; others for the same through online portal that is accessible through the link given below:</p>
<p><a href="{{taskLink}}">Click here to Acceptance/Refusal for Supervisory Duty</a><br><span style="font-size:12px">{{taskLink}}</span></p>
<p>As per our records your mobile number is {{mobile}} and email id {{email}}.</p>
${SUPERVISOR_SIGN_OFF}
<p style="font-size:12px;color:#555">In case your phone number has changed or for any further assistance, kindly mail to: {{dealingEmail}}</p>`,
  },
  [SupervisorMail.ACCEPTED]: {
    subject: 'Supervisory duty – Acceptance ({{sessionMonth}} {{sessionYear}})',
    body: `${SUPERVISOR_LETTER_HEAD}
<p>Dear Sir/Madam,</p>
<p>Thank you for accepting Supervisory duty for Professional Theory Examination for PG / UG students to be held in <b>{{sessionMonth}} {{sessionYear}}</b>.</p>
{{dutyTable}}
${SUPERVISOR_SIGN_OFF}`,
  },
  [SupervisorMail.REGRETTED]: {
    subject: 'Supervisory duty – Regret ({{sessionMonth}} {{sessionYear}})',
    body: `${SUPERVISOR_LETTER_HEAD}
<p>Dear Sir/Madam,</p>
<p>Thank you for informing that you are not able to accept offer of Supervisory duty for Professional Theory Examination for PG / UG students to be held in <b>{{sessionMonth}} {{sessionYear}}</b>.</p>
${SUPERVISOR_SIGN_OFF}`,
  },
  [SupervisorMail.OTP]: {
    subject: 'Supervisory duty – passcode',
    body: `Dear {{supervisorName}},\n\nThe Examination Section, {{instituteName}}. Your passcode to answer the supervisory duty offer is: {{otp}}\n\nIt is valid for 15 minutes. Enter it on the page that is already open.`,
  },
  [SupervisorMail.OFFER_SMS]: {
    subject: '',
    body: `The Examination Section, {{instituteName}} has sent an email with link to portal regarding appointment as Supervisor for the Professional Theory Examination for PG / UG students on your email id {{email}}. Please confirm your Acceptance. For any query contact on email id {{dealingEmail}}`,
  },
};

