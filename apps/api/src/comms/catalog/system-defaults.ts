import { PRODUCT_NAME } from '@ethesis/shared';

/** Mails that are not tied to one workflow: passcodes, login invites, receipts. */
export const SystemMail = {
  PASSCODE: 'SYSTEM_PASSCODE',
  COURSE_LOGIN: 'SYSTEM_COURSE_LOGIN',
  TASK_LINK: 'SYSTEM_TASK_LINK',
  EVALUATION_RECEIVED: 'SYSTEM_EVALUATION_RECEIVED',
  EVALUATION_RECEIVED_OFFICE: 'SYSTEM_EVALUATION_RECEIVED_OFFICE',
  REMUNERATE: 'REMUNERATE',
} as const;

export const SYSTEM_DEFAULTS: Record<string, { name: string; subject: string; body: string; placeholders: string[] }> = {
  [SystemMail.PASSCODE]: {
    name: 'Thesis task passcode',
    subject: `${PRODUCT_NAME} passcode`,
    body: `Hello {{name}},\n\nYour ${PRODUCT_NAME} passcode is: {{otp}}\n\nThis passcode is valid for 15 minutes. Enter it on the page that is already open. If it expires, click Send passcode on that page.`,
    placeholders: ['name', 'email', 'otp', 'instituteName'],
  },
  [SystemMail.COURSE_LOGIN]: {
    name: 'Course login created',
    subject: `${PRODUCT_NAME}: course login`,
    body: `Hello {{name}},\n\nInstitute Admin has created a login for you to add candidate thesis for the mapped courses and assign the Chief Guide.\n\nOpen: {{loginUrl}}\nEmail: {{email}}\nTemporary password: {{password}}\n\nYou will be asked to set a new password on first sign-in.`,
    placeholders: ['name', 'email', 'password', 'loginUrl', 'instituteName'],
  },
  [SystemMail.TASK_LINK]: {
    name: 'Task link (no specific template)',
    subject: `${PRODUCT_NAME}: {{purpose}}`,
    body: `Hello {{name}},\nPlease open this link and click Get passcode:\n{{taskLink}}`,
    placeholders: ['name', 'purpose', 'taskLink', 'candidateName', 'instituteName'],
  },
  [SystemMail.EVALUATION_RECEIVED]: {
    name: 'Evaluation report received — to examiner',
    subject: 'Thesis Evaluation Report of {{candidateName}} has been received',
    body: `Dear {{examinerName}},\n\nYour evaluation report for the thesis of {{candidateName}} has been received by the Examination Section. A copy of the submitted form is below.\n\n{{form}}\n\nRegards,\nExamination Section`,
    placeholders: ['examinerName', 'examinerEmail', 'candidateName', 'thesisTitle', 'thesisNumber', 'fileNo', 'form', 'instituteName'],
  },
  [SystemMail.EVALUATION_RECEIVED_OFFICE]: {
    name: 'Evaluation report received — to office',
    subject: 'Evaluation report received — {{candidateName}}',
    body: `Examiner {{examinerName}} ({{examinerEmail}}) submitted the evaluation report for {{candidateName}}.\n\n{{form}}\n\nRegards,\nExamination Section`,
    placeholders: ['examinerName', 'examinerEmail', 'candidateName', 'thesisTitle', 'thesisNumber', 'fileNo', 'form', 'instituteName'],
  },
  [SystemMail.REMUNERATE]: {
    name: 'Remuneration processed',
    subject: `${PRODUCT_NAME} remuneration`,
    body: `Remuneration of Rs {{feeAmount}}/- has been processed for {{examinerRole}} — thesis {{thesisNumber}}.{{tadaNote}}`,
    placeholders: ['examinerName', 'examinerRole', 'feeAmount', 'tadaAmount', 'tadaNote', 'candidateName', 'thesisNumber', 'thesisTitle', 'fileNo', 'instituteName'],
  },
};
