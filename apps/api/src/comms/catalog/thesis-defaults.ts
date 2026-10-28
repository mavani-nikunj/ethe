import { PRODUCT_NAME, textToHtml, withLetterhead } from '@ethesis/shared';

/** Default task-link mails go out on the institute letterhead (old eSTEMM style); the mail master can edit it per template. */
export const letterMail = (text: string) => withLetterhead(textToHtml(text));

export const DEFAULT_CONSENT_BODY = letterMail(`Dear {{examinerName}},

You are invited to examine the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}

Please open the link below. On the page, click Get passcode to receive a one-time passcode in a separate email, then Accept or Regret the offer.

Link: {{taskLink}}

Regards,
Examination Section
{{instituteName}}`);

export const DEFAULT_PANEL_BODY = letterMail(`Dear {{chiefGuideName}},

You are requested to furnish a panel of examiners for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}

Open the portal link below. On the page, click Get passcode to receive a one-time passcode in a separate email, then add examiners to each bucket and send the panel to the Examination Section.

Link: {{taskLink}}

Regards,
Examination Section
{{instituteName}}`);

export const DEFAULT_EVALUATE_BODY = letterMail(`Dear {{examinerName}},

Thank you for accepting the examinership for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}

Please evaluate the thesis within two weeks. Open the link below. On the page, click Get passcode to receive a one-time passcode in a separate email, then view the thesis and submit the evaluation report.

Link: {{taskLink}}

Regards,
Examination Section
{{instituteName}}`);

export const DEFAULT_VIVA_BODY = letterMail(`Dear {{chiefGuideName}},

You are requested to fix the viva / practical date, time and venue for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}
Proposed time: {{vivaTime}}
Proposed venue: {{vivaVenue}}

Open the link below. On the page, click Get passcode to receive a one-time passcode in a separate email, then submit the date, time and venue.

Link: {{taskLink}}

Regards,
Examination Section
{{instituteName}}`);

export const DEFAULT_REVISION_BODY = letterMail(`Dear {{chiefGuideName}},

A revised thesis is required for {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}

Open the link below. On the page, click Get passcode to receive a one-time passcode in a separate email, then upload the revised thesis.

Link: {{taskLink}}

Regards,
Examination Section
{{instituteName}}`);

export const DEFAULT_PANEL_SUBMITTED_BODY = letterMail(`Dear {{chiefGuideName}},

This confirms that the Examination Section has received the panel of examiners you submitted for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}

Examiners submitted:

{{panelList}}

Regards,
Examination Section
{{instituteName}}`);

export const DEFAULT_OFFER_LETTER = `To
{{examinerName}}

You are invited to examine the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}
Course: {{courseType}} · {{course}}
Department: {{department}}
Chief Guide: {{chiefGuideName}}

This is a formal offer letter from the Examination Section, {{instituteName}}.

Examination Section
{{instituteName}}`;

export const DEFAULT_THESIS_LETTER = `To
{{examinerName}}

Please find the thesis of {{candidateName}} ({{enrollmentNo}}) for evaluation.

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}
Course: {{courseType}} · {{course}}
Department: {{department}}

Kindly submit the evaluation report at the earliest.

Examination Section
{{instituteName}}`;

export const DEFAULT_REMINDER_LETTER = `To
{{examinerName}}

Reminder {{reminderLevel}}

You are reminded to submit the evaluation report for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}
Course: {{courseType}} · {{course}}
Department: {{department}}

Please complete the evaluation at the earliest.

Examination Section
{{instituteName}}`;

export const DEFAULT_REVISION_LETTER = `To
{{chiefGuideName}}
Chief Guide

CONFIDENTIAL

The thesis submitted by {{candidateName}} ({{enrollmentNo}}), {{course}} in {{speciality}}, Department of {{department}}, for the examination {{sessionMonth}} {{sessionYear}} was referred to external examiners.

One examiner ({{examinerName}}) has recommended REVISION / MODIFICATION. The examiner’s comments are enclosed.

Please arrange a point-wise reply and the corrected thesis (hard copy and PDF) so that it may be sent back to the evaluator.

Examination Section
{{instituteName}}`;

export const DEFAULT_REVISION_EXAMINER_LETTER = `To
{{examinerName}}
{{examinerDesignation}}

CONFIDENTIAL

Thank you for the evaluation report of the thesis submitted by {{candidateName}} ({{enrollmentNo}}), {{course}} in {{speciality}}, Department of {{department}}.

The student has submitted a clarification / revised thesis (PDF enclosed). There is no additional remuneration for evaluation of the revised thesis.

Kindly evaluate the revised thesis and submit the report.

Examination Section
{{instituteName}}`;

export const DEFAULT_CG_EVAL_LETTER = `To
{{chiefGuideName}}

You are requested to submit the Chief Guide evaluation for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}

Examination Section
{{instituteName}}`;

export const DEFAULT_VIVA_LETTER = `To
{{chiefGuideName}}

Viva-voce / practical letter for the thesis of {{candidateName}} ({{enrollmentNo}}).

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}
Date: {{vivaDate}}
Time: {{vivaTime}}
Venue: {{vivaVenue}}

Examination Section
{{instituteName}}`;

export const DEFAULT_BOARD_LETTER = `To the Board of Examiners

{{examinerName}}

The practical examination for {{candidateName}} ({{enrollmentNo}}) is scheduled as below.

Thesis: {{thesisTitle}}
Thesis no.: {{thesisNumber}}
File no.: {{fileNo}}
Date: {{vivaDate}}
Time: {{vivaTime}}
Venue: {{vivaVenue}}

Examination Section
{{instituteName}}`;
