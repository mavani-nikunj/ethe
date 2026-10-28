import { LETTERHEAD_HTML } from '@ethesis/shared';

/** Mail purposes. An active CommTemplate with the same purpose overrides the built-in text. */
export const PracticalMail = {
  OFFER: 'PRACTICAL_OFFER',
  OFFER_COORDINATOR: 'PRACTICAL_OFFER_COORDINATOR',
  REPLACEMENT_INFO: 'PRACTICAL_REPLACEMENT_INFO',
  ACCEPTED: 'PRACTICAL_ACCEPTED',
  REGRETTED: 'PRACTICAL_REGRETTED',
  OTP: 'PRACTICAL_OTP',
  APPOINTMENT: 'PRACTICAL_APPOINTMENT',
  PORTAL_PASSCODE: 'PRACTICAL_PORTAL_PASSCODE',
  DATE_REQUEST_CHAIR: 'PRACTICAL_DATE_REQUEST_CHAIR',
  DATE_REQUEST_ALL: 'PRACTICAL_DATE_REQUEST_ALL',
  DATE_REMINDER: 'PRACTICAL_DATE_REMINDER',
  DATE_FIXED: 'PRACTICAL_DATE_FIXED',
  TRAVEL_BOOKING: 'PRACTICAL_TRAVEL_BOOKING',
  TRAVEL_TICKET: 'PRACTICAL_TRAVEL_TICKET',
  TRAVEL_CANCEL: 'PRACTICAL_TRAVEL_CANCEL',
} as const;

/** Mails the Dealing user can pick in "Send Email" on the portal page. */
export const SENDABLE_PRACTICAL_MAILS = [
  { purpose: PracticalMail.APPOINTMENT, name: 'Appointment letter' },
  { purpose: PracticalMail.DATE_REQUEST_ALL, name: 'Practical date — information to examiner' },
  { purpose: PracticalMail.DATE_FIXED, name: 'Practical date fixed' },
];

export const PRACTICAL_SIGN_OFF = `<p>With best regards</p>
<p>Yours sincerely,<br>{{deanSignature}}{{deanName}}<br>Associate Dean (Exams)</p>
<p style="font-size:12px;color:#555">In case your phone number has changed or for any further assistance, kindly mail to: {{dealingEmail}}</p>`;

/** Old eSTEMM letterhead (title, logo, address, File No · CONFIDENTIAL · date) followed by the recipient block. */
export const PRACTICAL_LETTER_HEAD = `${LETTERHEAD_HTML}
<p>{{examinerName}}<br>{{designation}}<br>Department of {{department}}<br>{{examinerInstitute}}<br>{{examinerAddress}}</p>`;

/** Wording follows the old eSTEMM templates (PracticalOffer_letter.html etc.). */
export const PRACTICAL_DEFAULTS: Record<string, { subject: string; body: string }> = {
  [PracticalMail.OFFER]: {
    subject: 'Offer of Examinership – {{course}} in {{speciality}} ({{sessionMonth}} {{sessionYear}})',
    body: `${PRACTICAL_LETTER_HEAD}
<p><b>Subject: Offer of Examinership for {{course}} in {{speciality}}.</b></p>
<p>Dear Sir/Madam,</p>
<p>It is my pleasure to inform you that your name has been recommended as <b>{{examinerType}}</b> for conducting the final professional examination of <b>{{course}}</b> in <b>{{speciality}}</b> to be held in <b>{{sessionMonth}} {{sessionYear}}</b>.</p>
<p>{{tentativeSentence}}</p>
<p>May I request you to kindly communicate your acceptance/regret for the same through the online portal accessible through the link given below, your mobile number {{mobile}} and email id {{email}}.</p>
<p><a href="{{taskLink}}">Click here for Acceptance/Refusal for Conduct of Examination</a><br><span style="font-size:12px">{{taskLink}}</span></p>
<p>On receipt of your consent, a formal letter for Examinership will be sent to you. All other information related to the setting of question paper and conduct of the practical examination will be available at the online portal, such as Guideline, sample question paper, Previous Question Paper, Rules, Remuneration, TA-DA and Proforma for Air Travel.</p>
<p>All correspondence in this regard may be addressed to the undersigned via email and be kept confidential.</p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.OFFER_COORDINATOR]: {
    subject: 'Appointment as Exam Coordinator – {{course}} in {{speciality}} ({{sessionMonth}} {{sessionYear}})',
    body: `${PRACTICAL_LETTER_HEAD}
<p>Dear Sir/Madam,</p>
<p>It is my pleasure to inform you that the Competent Authority has appointed you as <b>{{examinerType}}</b> for conducting the final professional examination of <b>{{course}}</b> in <b>{{speciality}}</b> to be held in <b>{{sessionMonth}} {{sessionYear}}</b>.</p>
<p>May I request you to kindly communicate your acceptance/regret for the same through the online portal accessible through the link given below, your mobile number {{mobile}} and email id {{email}}.</p>
<p><a href="{{taskLink}}">Click here for Acceptance/Refusal for Conduct of Examination</a><br><span style="font-size:12px">{{taskLink}}</span></p>
<p>On receipt of your consent, a formal letter will be sent to you. All other information will be available at the online portal.</p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.REPLACEMENT_INFO]: {
    subject: 'Change in Board of Examiners – {{course}} in {{speciality}}',
    body: `<p>Dear Sir/Madam,</p>
<p>This is to inform you that <b>{{regrettedExaminer}}</b> has expressed inability to conduct the examination. Therefore, <b>{{newExaminer}}</b> is being appointed as {{newExaminerType}} for {{course}} in {{speciality}} examination of this Institute to be held in {{sessionMonth}} {{sessionYear}}.</p>
<p>The members of the Board of Examiners are as under:</p>
{{boardTable}}
<p>This is for your information please.</p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.ACCEPTED]: {
    subject: 'Examinership for {{course}} in {{speciality}}: Acceptance',
    body: `<p>Dear {{examinerName}},</p>
<p>Thank you for accepting the offer of examinership as <b>{{examinerType}}</b> for conduct of the final examination in the subject of {{course}} in {{speciality}} to be held in {{sessionMonth}} {{sessionYear}}.</p>
<p>Your examiner code is <b>{{examinerCode}}</b>. A formal appointment letter with the link to the examiner portal will follow.</p>
<p>With best regards<br>Associate Dean (Exams)</p>`,
  },
  [PracticalMail.REGRETTED]: {
    subject: 'Examinership for {{course}} in {{speciality}}: Regret',
    body: `<p>Dear {{examinerName}},</p>
<p>Thank you for informing that you are not able to accept the offer of examinership as {{examinerType}} for conduct of the final examination in the subject of {{course}} in {{speciality}} to be held in {{sessionMonth}} {{sessionYear}}.</p>
<p>With best regards<br>Associate Dean (Exams)</p>`,
  },
  [PracticalMail.APPOINTMENT]: {
    subject: 'Appointment as {{examinerType}} – {{course}} in {{speciality}} ({{sessionMonth}} {{sessionYear}})',
    body: `${PRACTICAL_LETTER_HEAD}
<p>Dear Sir/Madam,</p>
<p>This is to inform you that the Director is pleased to appoint you as <b>{{examinerType}}</b> of the Board of Examiners for <b>{{course}}</b> in <b>{{speciality}}</b> examination of this Institute to be held in <b>{{sessionMonth}} {{sessionYear}}</b>. Your examiner code is <b>{{examinerCode}}</b>.</p>
<p>The members of the Board of Examiners are as under:</p>
{{boardTable}}
<p>The guidelines for conduct of examination, format of question papers, previous question papers, rules and remuneration, TA/DA and booking of Air Tickets are available at the online portal accessible through the link given below. A passcode will be sent to your email id {{email}} when you open the portal.</p>
<p><a href="{{portalLink}}">Click here to access the Portal for Theory/Practical Examination content</a><br><span style="font-size:12px">{{portalLink}}</span></p>
<p><b>All may kindly note:</b></p>
<ol>
<li>The Chairperson shall be the authority for liaison between the Examiners and the Examination Section for all purposes related to this examination, unless one of the Internal Examiners is delegated this responsibility by the Chairperson.</li>
<li>External Examiners are requested to communicate with the Chairperson for all matters related to preparation of the question paper. The question papers should be set by External and Internal Examiners. The final paper ({{marks}} marks) should be duly signed by the Internal Examiners and Chairperson for onward transmission to the Examination Section.</li>
<li>The date for Practical/Clinical/viva voce (preferably between {{tentativeSchedule}}) should be fixed in consultation with the members of the Board of Examiners and the final dates should be communicated by the Chairperson through the online portal.</li>
<li>The practical examination and evaluation of theory papers has to be conducted in person (Physical) only.</li>
<li>External Examiners are required to intimate their itinerary of Air Travel through the online portal. The flight bookings will be done by the Examination Section; the details must be given as early as possible after the final dates are fixed.</li>
<li>Hotel accommodation should be booked by External Examiners residing outside Delhi/NCR; the cost will be reimbursed as per entitlement (see the Boarding and Lodging document on the portal).</li>
<li>For travel by train or road, the arrangements will be made by the External Examiners and expenses reimbursed. Travel by road beyond Delhi-NCR needs prior permission from the Dean (Exams) through the Chairperson.</li>
</ol>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.PORTAL_PASSCODE]: {
    subject: 'Examiner portal passcode',
    body: `Dear {{examinerName}},\n\nThe Examination Section, {{instituteName}}. Your passcode for the examiner portal is: {{otp}}\n\nIt is valid for 30 minutes. Enter it on the portal page that is already open.`,
  },
  [PracticalMail.DATE_REQUEST_CHAIR]: {
    subject: 'Request to Chairperson for practical date – {{course}} in {{speciality}}',
    body: `<p>Dear {{examinerName}},</p>
<p>The Professional Practical Examination for <b>{{course}}</b> in <b>{{speciality}}</b> will be held in {{sessionMonth}} {{sessionYear}}. The Practical / Clinical / Viva-voce are to be scheduled preferably between <b>{{tentativeSchedule}}</b>.</p>
<p>The schedule of Practical / Clinical / Viva-voce examination is to be fixed by the Chairperson after consultation with the other members of the Board of Examiners.</p>
<p>May I request you to kindly communicate the practical date(s) through the online portal accessible through the link given below:</p>
<p><a href="{{portalLink}}">Click here to access the Portal for Practical Examination</a><br><span style="font-size:12px">{{portalLink}}</span></p>
<p>Once updated online, the schedule shall be communicated to all the members of the Board of Examiners. Additional information related to the practical examination is also available at the online portal.</p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.DATE_REQUEST_ALL]: {
    subject: 'Practical examination schedule – {{course}} in {{speciality}}',
    body: `<p>Dear {{examinerName}},</p>
<p>The Professional Practical Examination for <b>{{course}}</b> in <b>{{speciality}}</b> will be held in {{sessionMonth}} {{sessionYear}}. The Practical / Clinical / Viva-voce are to be scheduled preferably between <b>{{tentativeSchedule}}</b>.</p>
<p>The schedule of Practical / Clinical / Viva-voce examination will be fixed by the Chairperson after consultation with the other members of the Board of Examiners.</p>
<p><a href="{{portalLink}}">Click here to access the Portal for Practical Examination</a><br><span style="font-size:12px">{{portalLink}}</span></p>
<p>Once updated online, the schedule shall be communicated to all the members of the Board of Examiners.</p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.DATE_REMINDER]: {
    subject: 'Reminder – Request to Chairperson for practical date – {{course}} in {{speciality}}',
    body: `<p>Dear {{examinerName}},</p>
<p>With reference to our letter dated {{requestDate}}, the Professional Practical Examination for <b>{{course}}</b> in <b>{{speciality}}</b> is to be held in {{sessionMonth}} {{sessionYear}} between <b>{{tentativeSchedule}}</b>.</p>
<p>May I request you to kindly fix the schedule of Practical / Clinical / Viva-voce examination in consultation with the other members of the Board of Examiners and update it through the link given below:</p>
<p><a href="{{portalLink}}">Click here to access the Portal for Practical Examination</a><br><span style="font-size:12px">{{portalLink}}</span></p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.DATE_FIXED]: {
    subject: 'Practical date of {{course}} in {{speciality}} – {{practicalDate}}',
    body: `<p>Dear {{examinerName}},</p>
<p>With reference to our previous letter, you are appointed as <b>{{examinerType}}</b> for conduct of <b>{{course}}</b> in <b>{{speciality}}</b> examination of this Institute to be held in {{sessionMonth}} {{sessionYear}}. As per the communication received from the Chairperson, the date for Practical/Clinical/viva voce examination has been fixed in consultation with the members of the Board of Examiners on <b>{{practicalDate}}</b>.</p>
<p>All concerned are requested to make their administrative and logistic arrangements according to the above schedule.</p>
<ol>
<li>The Air ticket booking will be done by the Examination Section as per Govt of India guidelines and only Economy Class tickets will be provided. External Examiners are required to intimate their itinerary of Air Travel through the online portal.</li>
<li>Hotel accommodation should be booked by External Examiners residing outside Delhi/NCR; the cost will be reimbursed as per entitlement.</li>
<li>Travel by road beyond Delhi-NCR needs prior permission from the Dean (Exams) through the Chairperson.</li>
<li>Reimbursement of Hotel / Train Ticket / Taxi will be made against ticket / bill as per rules through direct transfer to the bank account.</li>
</ol>
{{boardTable}}
<p><a href="{{portalLink}}">Examiner portal</a></p>
${PRACTICAL_SIGN_OFF}`,
  },
  [PracticalMail.TRAVEL_BOOKING]: {
    subject: 'Air ticket booking request – {{examinerName}} ({{course}} in {{speciality}})',
    body: `<p>Dear {{agentName}},</p>
<p>Kindly book the following air ticket(s) for the examiner below and send the ticket to this office.</p>
{{bookingTable}}
<p>Regards,<br>{{senderName}}<br>Travel Manager, Examination Section, {{instituteName}}</p>`,
  },
  [PracticalMail.TRAVEL_TICKET]: {
    subject: 'Your air ticket – {{course}} in {{speciality}} practical examination',
    body: `<p>Dear {{examinerName}},</p>
<p>Your air ticket for the practical examination of {{course}} in {{speciality}} has been booked. Please download it from the link below.</p>
<p><a href="{{ticketLink}}">Download ticket</a></p>
{{bookingTable}}
<p>Regards,<br>Examination Section, {{instituteName}}</p>`,
  },
  [PracticalMail.TRAVEL_CANCEL]: {
    subject: 'Cancellation of air ticket – {{examinerName}}',
    body: `<p>Dear {{agentName}},</p>
<p>Kindly cancel the air ticket booked for the examiner below.</p>
<p>Reason: {{cancelReason}}</p>
{{bookingTable}}
<p>Regards,<br>{{senderName}}<br>Travel Manager, Examination Section, {{instituteName}}</p>`,
  },
  [PracticalMail.OTP]: {
    subject: 'Examination Section passcode',
    body: `Dear {{examinerName}},\n\nYour passcode is: {{otp}}\n\nIt is valid for 15 minutes. Enter it on the page that is already open.\n\n{{instituteName}}, Examination Section`,
  },
};

