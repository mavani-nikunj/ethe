import { LetterKind, StageType, UserRole } from '@ethesis/shared';
import { BlueprintStage } from '../database/blueprint.schema';

function s(
  code: string,
  name: string,
  type: string,
  actorRole: string,
  extra: Partial<BlueprintStage> = {},
): BlueprintStage {
  return { code, name, type, actorRole, ...extra };
}

export function pgMedicalStages(): BlueprintStage[] {
  return [
    s('initiate', 'Course initiation', StageType.INITIATE, UserRole.COURSE, { next: 'ace_review' }),
    s('ace_review', 'ACE review', StageType.APPROVE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'assign_number',
    }),
    s('assign_number', 'Assign thesis number', StageType.ASSIGN_NUMBER, UserRole.DEALING, {
      next: 'cg_approval',
    }),
    s('cg_approval', 'Associate Dean — Chief Guide approval', StageType.APPROVE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'panel_request',
      nextOnReject: 'assign_number',
    }),
    s('panel_request', 'Request panel from Chief Guide', StageType.PANEL_REQUEST, UserRole.DEALING, {
      next: 'panel_build',
    }),
    s('panel_build', 'Chief Guide builds panel', StageType.PANEL_BUILD, UserRole.GUIDE, { next: 'panel_select' }),
    s('panel_select', 'Dealing assigns examiners', StageType.PANEL_SELECT, UserRole.DEALING, { next: 'panel_vet' }),
    s('panel_vet', 'Associate Dean vets examiners', StageType.PANEL_VET, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'consent',
      nextOnReject: 'panel_select',
    }),
    s('additional_panel', 'Additional panel — pool exhausted', StageType.ADDITIONAL_PANEL, UserRole.DEALING, {
      next: 'panel_build',
    }),
    s('consent', 'Examiner offer letter', StageType.CONSENT, UserRole.DEALING, {
      next: 'dispatch',
      letterKind: LetterKind.OFFER,
    }),
    s('dispatch', 'Dispatch thesis letter', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'evaluate',
      letterKind: LetterKind.THESIS,
    }),
    s('evaluate', 'Examiner evaluation', StageType.EVALUATE, UserRole.DEALING, {
      next: 'practical_appoint',
      evaluationRound: 1,
    }),
    s('revision_dean', 'Assoc Dean — revision / modification', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'revision_letter',
      nextOnReject: 'revision_letter',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_letter', 'Dealing — revision letter (pending / resend)', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_upload', 'Upload revised thesis', StageType.REVISION, UserRole.DEALING, { next: 'revision_dean2' }),
    s('revision_dean2', 'Assoc Dean — approve revised thesis', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'revision_dispatch',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_dispatch', 'Send revised thesis to same examiner', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'evaluate',
      letterKind: LetterKind.THESIS,
    }),
    s('practical_appoint', 'Assign Chairperson / Internal / External', StageType.PRACTICAL, UserRole.DEALING, {
      next: 'practical_vet',
    }),
    s('practical_vet', 'Assoc Dean vets practical board', StageType.PANEL_VET, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'practical_offer',
      nextOnReject: 'practical_appoint',
    }),
    s('practical_offer', 'Practical examiner offer', StageType.CONSENT, UserRole.DEALING, {
      next: 'practical_date',
      letterKind: LetterKind.OFFER,
    }),
    s('practical_date', 'Chairperson fixes practical date', StageType.VIVA_DATE, UserRole.DEALING, {
      next: 'close',
      letterKind: LetterKind.BOARD,
    }),
    s('close', 'Close file', StageType.CLOSE, UserRole.DEALING),
  ];
}

export function phdMedicalStages(): BlueprintStage[] {
  return [
    s('initiate', 'Course initiation', StageType.INITIATE, UserRole.COURSE, { next: 'ace_review' }),
    s('ace_review', 'ACE review', StageType.APPROVE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'assign_number',
    }),
    s('assign_number', 'Assign thesis number', StageType.ASSIGN_NUMBER, UserRole.DEALING, {
      next: 'cg_approval',
    }),
    s('cg_approval', 'Associate Dean — Chief Guide approval', StageType.APPROVE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'panel_request',
      nextOnReject: 'assign_number',
    }),
    s('panel_request', 'Request panel from Chief Guide', StageType.PANEL_REQUEST, UserRole.DEALING, {
      next: 'panel_build',
    }),
    s('panel_build', 'Chief Guide builds panel (Indian / Foreign)', StageType.PANEL_BUILD, UserRole.GUIDE, {
      next: 'panel_select',
    }),
    s('panel_select', 'Associate Dean selects 1 Indian + 1 Foreign', StageType.PANEL_SELECT, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'offer_ao',
    }),
    s('additional_panel', 'Additional panel — pool exhausted', StageType.ADDITIONAL_PANEL, UserRole.DEALING, {
      next: 'panel_build',
    }),
    s('offer_ao', 'AO — offer letter routing', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'offer_ace',
      nextOnReject: 'consent',
      letterKind: LetterKind.OFFER,
    }),
    s('offer_ace', 'ACE — offer letter routing', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'offer_dean',
      nextOnReject: 'consent',
      letterKind: LetterKind.OFFER,
    }),
    s('offer_dean', 'Associate Dean — offer letter routing', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'consent',
      nextOnReject: 'consent',
      letterKind: LetterKind.OFFER,
    }),
    s('consent', 'Examiner consent', StageType.CONSENT, UserRole.DEALING, {
      next: 'post_ao',
      letterKind: LetterKind.OFFER,
    }),
    s('post_ao', 'AO — thesis letter routing', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'post_ace',
      nextOnReject: 'dispatch',
      letterKind: LetterKind.THESIS,
    }),
    s('post_ace', 'ACE — thesis letter routing', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'post_dean',
      nextOnReject: 'dispatch',
      letterKind: LetterKind.THESIS,
    }),
    s('post_dean', 'Associate Dean — thesis letter routing', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'dispatch',
      nextOnReject: 'dispatch',
      letterKind: LetterKind.THESIS,
    }),
    s('dispatch', 'Dispatch thesis', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'evaluate',
      letterKind: LetterKind.THESIS,
    }),
    s('evaluate', 'Examiner evaluation', StageType.EVALUATE, UserRole.DEALING, {
      next: 'wait_two',
      evaluationRound: 1,
      waitAccepted: 2,
    }),
    s('reminder_ao', 'AO — evaluation reminder letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'reminder_ace',
      nextOnReject: 'evaluate',
      letterKind: LetterKind.REMINDER,
    }),
    s('reminder_ace', 'ACE — evaluation reminder letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'reminder_dean',
      nextOnReject: 'evaluate',
      letterKind: LetterKind.REMINDER,
    }),
    s('reminder_dean', 'Assoc Dean — evaluation reminder letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'evaluate',
      nextOnReject: 'evaluate',
      letterKind: LetterKind.REMINDER,
    }),
    s('revision_ao', 'AO — revision letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'revision_ace',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_ace', 'ACE — revision letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'revision_dean',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_dean', 'Assoc Dean — Chief Guide revision letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'revision_upload',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_upload', 'Chief Guide uploads revised thesis', StageType.REVISION, UserRole.GUIDE, {
      next: 'revision_ex_ao',
    }),
    s('revision_ex_ao', 'AO — examiner revision letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'revision_ex_ace',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_ex_ace', 'ACE — examiner revision letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'revision_ex_dean',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_ex_dean', 'Assoc Dean — examiner revision letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'revision_ex_send',
      nextOnReject: 'revision_upload',
      letterKind: LetterKind.REVISION,
    }),
    s('revision_ex_send', 'Send revised thesis to examiner', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'evaluate',
      letterKind: LetterKind.THESIS,
    }),
    s('wait_two', 'Wait for two acceptances', StageType.WAIT, UserRole.DEALING, { next: 'cg_eval_ao' }),
    s('cg_eval_ao', 'AO — Chief Guide evaluation letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'cg_eval_ace',
      nextOnReject: 'wait_two',
      letterKind: LetterKind.CG_EVAL,
    }),
    s('cg_eval_ace', 'ACE — Chief Guide evaluation letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'cg_eval_dean',
      nextOnReject: 'wait_two',
      letterKind: LetterKind.CG_EVAL,
    }),
    s('cg_eval_dean', 'Associate Dean — Chief Guide evaluation letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'cg_eval_send',
      nextOnReject: 'wait_two',
      letterKind: LetterKind.CG_EVAL,
    }),
    s('cg_eval_send', 'Dealing sends Chief Guide evaluation letter', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'cg_evaluate',
      letterKind: LetterKind.CG_EVAL,
    }),
    s('cg_eval_dean2', 'Associate Dean — send to Chief Guide (legacy)', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'cg_evaluate',
      nextOnReject: 'wait_two',
      letterKind: LetterKind.CG_EVAL,
    }),
    s('cg_evaluate', 'Chief Guide evaluation', StageType.EVALUATE, UserRole.GUIDE, {
      next: 'pick_nth',
      evaluationRound: 2,
    }),
    s('pick_nth', 'Associate Dean picks 4th Indian examiner', StageType.PICK_NTH, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      nthBucketCode: 'INDIAN',
      next: 'nth_ao',
    }),
    s('nth_ao', 'AO — 4th examiner offer', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'nth_ace',
      nextOnReject: 'nth_consent',
      letterKind: LetterKind.OFFER,
    }),
    s('nth_ace', 'ACE — 4th examiner offer', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'nth_dean',
      nextOnReject: 'nth_consent',
      letterKind: LetterKind.OFFER,
    }),
    s('nth_dean', 'Associate Dean — 4th examiner offer', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'nth_consent',
      nextOnReject: 'nth_consent',
      letterKind: LetterKind.OFFER,
    }),
    s('nth_consent', '4th examiner consent', StageType.CONSENT, UserRole.DEALING, {
      next: 'nth_thesis_ao',
      letterKind: LetterKind.OFFER,
    }),
    s('nth_thesis_ao', 'AO — 4th examiner thesis letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'nth_thesis_ace',
      nextOnReject: 'nth_dispatch',
      letterKind: LetterKind.THESIS,
    }),
    s('nth_thesis_ace', 'ACE — 4th examiner thesis letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'nth_thesis_dean',
      nextOnReject: 'nth_dispatch',
      letterKind: LetterKind.THESIS,
    }),
    s('nth_thesis_dean', 'Associate Dean — 4th examiner thesis letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'nth_dispatch',
      nextOnReject: 'nth_dispatch',
      letterKind: LetterKind.THESIS,
    }),
    s('nth_dispatch', 'Dispatch to 4th examiner', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'nth_evaluate',
      letterKind: LetterKind.THESIS,
    }),
    s('nth_evaluate', '4th examiner evaluation', StageType.EVALUATE, UserRole.DEALING, {
      next: 'viva_prep',
      evaluationRound: 3,
    }),
    s('viva_prep', 'Chief Guide details for viva-voce letter', StageType.VIVA, UserRole.DEALING, { next: 'viva_ao' }),
    s('viva_ao', 'AO — viva-voce letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'viva_ace',
      nextOnReject: 'viva_prep',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_ace', 'ACE — viva-voce letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'viva_dean',
      nextOnReject: 'viva_prep',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_dean', 'Associate Dean — viva-voce letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'viva_send',
      nextOnReject: 'viva_prep',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_send', 'Dealing sends viva letter to Chief Guide', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'viva_date',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_date', 'Chief Guide fixes viva-voce date, time and venue', StageType.VIVA_DATE, UserRole.GUIDE, {
      next: 'viva_final_ao',
    }),
    s('viva_final_ao', 'AO — final viva letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'AO',
      next: 'viva_final_ace',
      nextOnReject: 'viva_date',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_final_ace', 'ACE — final viva letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ACE',
      next: 'viva_final_dean',
      nextOnReject: 'viva_date',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_final_dean', 'Associate Dean — final viva letter', StageType.CONSENT_ROUTE, UserRole.AUTHORITY, {
      authoritySlot: 'ASSOC_DEAN',
      next: 'viva_final_send',
      nextOnReject: 'viva_date',
      letterKind: LetterKind.VIVA,
    }),
    s('viva_final_send', 'Dealing sends final viva letter to Chief Guide', StageType.DISPATCH_THESIS, UserRole.DEALING, {
      next: 'close',
      letterKind: LetterKind.VIVA,
    }),
    s('close', 'Close file', StageType.CLOSE, UserRole.DEALING),
  ];
}

export function pgTemplatePayload() {
  return {
    name: 'PG Medical',
    code: 'PG_MEDICAL',
    description:
      'AIIMS PG from live eSTEMM: 3 Delhi + 3 Outside, Assoc Dean hold/reject, offer then thesis letter, revision via Dean, then practical examiner. No AO.',
    stages: pgMedicalStages(),
    guidePolicy: { maxCoGuides: 0, minCoGuides: 0 },
    panelRule: {
      buckets: [
        { code: 'DELHI', label: 'Delhi', count: 3 },
        { code: 'OUTSIDE', label: 'Outside Delhi', count: 3 },
      ],
    },
    revisionOwnerRole: UserRole.DEALING,
    flags: { resultHoldRelease: false, remuneration: true, remunerationAmount: 4000 },
    isSystemSeed: true,
  };
}

export function phdTemplatePayload() {
  return {
    name: 'PhD Medical',
    code: 'PHD_MEDICAL',
    description:
      'AIIMS PhD from live eThesis: 5 Indian + 5 Foreign, AO→ACE→Dean on every letter, additional panel, CG eval, 4th Indian, viva-voce date.',
    stages: phdMedicalStages(),
    guidePolicy: { maxCoGuides: 1, minCoGuides: 1 },
    panelRule: {
      buckets: [
        { code: 'INDIAN', label: 'Indian', count: 5 },
        { code: 'FOREIGN', label: 'Foreign', count: 5 },
      ],
    },
    revisionOwnerRole: UserRole.GUIDE,
    flags: { resultHoldRelease: true, remuneration: true, remunerationAmount: 4000 },
    isSystemSeed: true,
  };
}
