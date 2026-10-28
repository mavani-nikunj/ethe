import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Verdict, StageType, UserRole, AcceptGrade, EVALUATION_REPORT_ITEMS, ReportAnswer } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { WorkflowService } from '../files/workflow.service';

const GRADE_LABEL: Record<string, string> = {
  HIGHLY_COMMENDABLE: 'A. Highly Commendable',
  COMMENDABLE: 'B. Commendable',
  SATISFACTORY: 'C. Satisfactory',
};

const ANSWER_LABEL: Record<string, string> = {
  YES: 'Yes',
  NO: 'No',
  CANT_SAY: "Can't Say",
};

const VERDICT_LABEL: Record<string, string> = {
  ACCEPT: '1. ACCEPTED',
  REVISION: '2. REVISION / MODIFICATION REQUIRED',
  REJECT: '3. REJECTED',
};

const GRADES = Object.values(AcceptGrade);
const ANSWERS = new Set(Object.values(ReportAnswer));

@Injectable()
export class EvaluationService {
  constructor(private workflow: WorkflowService) {}

  checklist() {
    return { items: EVALUATION_REPORT_ITEMS, grades: GRADES, answers: Object.values(ReportAnswer) };
  }

  parseReport(body: any): Record<string, string> {
    const raw = body.report && typeof body.report === 'object' ? body.report : body;
    const report: Record<string, string> = {};
    for (const item of EVALUATION_REPORT_ITEMS) {
      const value = String(raw[item.key] || '').trim().toUpperCase();
      if (!ANSWERS.has(value as any)) {
        throw new BadRequestException(`General Report: answer "${item.label}" (Yes / No / Can't Say)`);
      }
      report[item.key] = value;
    }
    return report;
  }

  validateVerdict(body: any) {
    const verdict = String(body.verdict || '');
    if (![Verdict.ACCEPT, Verdict.REVISION, Verdict.REJECT].includes(verdict as any)) {
      throw new BadRequestException('Select a recommendation: Accepted, Revision / modification, or Rejected');
    }
    if (verdict === Verdict.ACCEPT) {
      if (!GRADES.includes(body.grade)) {
        throw new BadRequestException('Accepted reports need a grade: Highly Commendable, Commendable or Satisfactory');
      }
    }
    if (verdict === Verdict.REJECT && !String(body.comments || '').trim()) {
      throw new BadRequestException('Give reasons for rejection in comments');
    }
    return verdict;
  }

  latestThesisVersion(file: { documents?: { kind?: string; version?: number }[] }) {
    const theses = (file.documents || []).filter((d) => !d.kind || d.kind === 'THESIS');
    if (!theses.length) return 1;
    return theses.reduce((max, d) => Math.max(max, Number(d.version || 0)), 0) || 1;
  }

  formatSubmittedForm(body: any, meta: {
    candidateName?: string;
    title?: string;
    thesisNumber?: string;
    fileNo?: string;
    examinerName?: string;
    examinerEmail?: string;
  }) {
    const report = body.report && typeof body.report === 'object' ? body.report : body;
    const lines: string[] = [
      'CONFIDENTIAL — Evaluation Report',
      '',
      `Name of the student: ${meta.candidateName || '—'}`,
      `Title of thesis: ${meta.title || '—'}`,
      `Thesis no.: ${meta.thesisNumber || '—'}`,
      `File no.: ${meta.fileNo || '—'}`,
      `Examiner: ${meta.examinerName || '—'} (${meta.examinerEmail || '—'})`,
      '',
      'Recommendation',
      VERDICT_LABEL[String(body.verdict || '')] || String(body.verdict || '—'),
    ];
    if (body.verdict === Verdict.ACCEPT) {
      lines.push(`Grade: ${GRADE_LABEL[String(body.grade || '')] || body.grade || '—'}`);
    }
    lines.push('', 'General Report');
    for (const item of EVALUATION_REPORT_ITEMS) {
      const answer = ANSWER_LABEL[String(report[item.key] || '').toUpperCase()] || String(report[item.key] || '—');
      const prefix = item.no ? `${item.no} ` : '    ';
      if ('group' in item && item.group) {
        lines.push(`2. ${item.group}`);
      }
      lines.push(`${prefix}${item.label}  ${answer}`);
    }
    lines.push('', 'Comments', String(body.comments || '').trim() || '(none)');
    return lines.join('\n');
  }

  buildEvaluation(body: any, documentVersion?: number) {
    const verdict = this.validateVerdict(body);
    return {
      verdict,
      grade: verdict === Verdict.ACCEPT ? body.grade : undefined,
      comments: String(body.comments || '').trim(),
      report: this.parseReport(body),
      submittedAt: new Date(),
      documentVersion: documentVersion || undefined,
    };
  }

  async submit(user: AuthUser, fileId: string, body: any, panelIndex?: number) {
    const staff = [UserRole.DEALING, UserRole.INSTITUTE_ADMIN, UserRole.AUTHORITY, UserRole.ACADEMIC, UserRole.COURSE].includes(
      user.role as any,
    );
    if (staff) {
      throw new ForbiddenException('The examiner submits the evaluation report from the task link emailed to them');
    }
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const round = file.evaluationRound || 1;
    const evaluation = this.buildEvaluation(body, this.latestThesisVersion(file));
    if (round === 2 || body.asChiefGuide) {
      file.evaluationRound = 2;
      file.panel = file.panel.filter((p) => !p.isChiefGuide);
      file.panel.push({
        name: file.chiefGuideName || user.name,
        email: file.chiefGuideEmail || user.email,
        bucketCode: 'CG',
        assigned: true,
        round: 2,
        isChiefGuide: true,
        consentStatus: 'ACCEPTED',
        evaluation,
      });
    } else {
      const rawIndex = panelIndex ?? body.panelIndex;
      const hasIndex = rawIndex !== undefined && rawIndex !== null && rawIndex !== '';
      const idx = hasIndex
        ? Number(rawIndex)
        : file.panel.findIndex(
            (p) =>
              p.assigned &&
              Number(p.round || 1) === round &&
              String(p.email || '').toLowerCase() === String(user.email || '').toLowerCase(),
          );
      if (!Number.isInteger(idx) || idx < 0 || !file.panel[idx]) {
        throw new BadRequestException('You are not an assigned examiner on this round');
      }
      const member = file.panel[idx];
      if (!member.assigned || Number(member.round || 1) !== round) {
        throw new BadRequestException(`${member.name || 'This examiner'} is not assigned on this round`);
      }
      if (member.consentStatus !== 'ACCEPTED') {
        throw new BadRequestException(`${member.name || 'This examiner'} has not accepted the offer`);
      }
      if (String(member.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) {
        throw new BadRequestException('You are not an assigned examiner on this round');
      }
      if (member.evaluation?.verdict) {
        throw new BadRequestException(`Evaluation already recorded for ${member.name}`);
      }
      file.panel[idx].evaluation = evaluation;
    }

    if (body.verdict === Verdict.REVISION || body.verdict === Verdict.REJECT) {
      // Round 3 (4th Indian): regret-like — pick another 4th instead of the thesis revision loop.
      if (Number(file.evaluationRound || round || 1) >= 3) {
        const pick = blueprint.stages.find((s) => s.type === StageType.PICK_NTH);
        if (pick) {
          file.currentStageCode = pick.code;
          this.workflow.rebuildMetro(file, blueprint);
        }
        file.lastActionRemark = `${body.verdict} by 4th examiner ${user.name}`;
        file.markModified('panel');
        await file.save();
        return file;
      }
      // PG: REJECT and REVISION share the Assoc Dean revision hop (old B3 queue), not a hard-stop REJECTED file.
      // PhD UI hides REJECT; if posted, it still follows the same revision Dean hops then CG upload.
      const revStage =
        blueprint.stages.find((s) => s.code.startsWith('revision') && s.type === StageType.CONSENT_ROUTE && !s.code.startsWith('revision_ex') && !s.code.startsWith('revision_dean2')) ||
        blueprint.stages.find((s) => s.code === 'revision_ao' || s.code === 'revision_dean') ||
        blueprint.stages.find((s) => s.type === StageType.REVISION);
      if (revStage) {
        file.currentStageCode = revStage.code;
        this.workflow.rebuildMetro(file, blueprint);
      } else {
        (file as any).pendingRevision = true;
      }
      file.lastActionRemark = `${body.verdict} by ${user.name}`;
      file.markModified('panel');
      await file.save();
      return file;
    }

    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    const checkRound = Number(file.evaluationRound || round || 1);
    const need = stage.waitAccepted || this.workflow.assigned(file, checkRound).length;
    const accepted = this.workflow.acceptedCount(file, checkRound);
    const pending = this.workflow.assigned(file, checkRound).filter((p) => !p.evaluation?.verdict);
    file.markModified('panel');
    await file.save();
    if (!pending.length && accepted >= need && stage.next) {
      return this.workflow.advance(file, blueprint, user, 'Evaluation complete');
    }
    return file;
  }

  async applyRevision(user: AuthUser, fileId: string, path: string, originalName: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const owner = blueprint.revisionOwnerRole || UserRole.DEALING;
    if (user.role !== owner && user.role !== UserRole.INSTITUTE_ADMIN) {
      throw new BadRequestException(`Revision upload is owned by ${owner}`);
    }
    const currentVersion = this.latestThesisVersion(file);
    file.panel.forEach((p) => {
      if (p.evaluation?.verdict === Verdict.REVISION || p.evaluation?.verdict === Verdict.REJECT) {
        const prior = p.evaluation;
        p.evaluationHistory = p.evaluationHistory || [];
        p.evaluationHistory.push({
          verdict: prior.verdict,
          grade: prior.grade,
          comments: prior.comments,
          report: prior.report,
          checklist: prior.checklist,
          submittedAt: prior.submittedAt,
          documentVersion: prior.documentVersion || currentVersion,
        });
        p.evaluation = undefined;
        p.thesisSentAt = undefined;
      }
    });
    const version = (file.documents?.length || 0) + 1;
    file.documents.push({
      kind: 'THESIS',
      version,
      path,
      originalName,
      uploadedAt: new Date(),
      uploadedBy: user.name,
    });
    const current = this.workflow.stage(blueprint, file.currentStageCode);
    if (current.type === StageType.REVISION && current.next) {
      file.currentStageCode = current.next;
    } else {
      const evalStage = [...blueprint.stages]
        .reverse()
        .find((s) => s.type === StageType.EVALUATE && s.evaluationRound === (file.evaluationRound || 1));
      if (evalStage) file.currentStageCode = evalStage.code;
    }
    this.workflow.rebuildMetro(file, blueprint);
    file.markModified('panel');
    file.markModified('documents');
    await file.save();
    return file;
  }
}
