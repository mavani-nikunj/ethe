import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ThesisFile, ThesisFileDocument } from '../database/thesis-file.schema';
import { Blueprint, BlueprintStage } from '../database/blueprint.schema';
import { FileStatus, MetroStatus, StageType, UserRole, Verdict, ConsentStatus, InboxLane, LetterKind, PRACTICAL_ROUND, canonicalUserRole } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { authoritySlotsMatch } from '../common/authority-slot';

@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(ThesisFile.name) private files: Model<ThesisFileDocument>,
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
  ) {}

  async load(fileId: string, instituteId: string): Promise<{ file: ThesisFileDocument; blueprint: Blueprint }> {
    const file = await this.files.findOne({
      _id: new Types.ObjectId(String(fileId)),
      instituteId: new Types.ObjectId(String(instituteId)),
    });
    if (!file) throw new NotFoundException('File not found');
    const blueprint = await this.blueprints.findById(file.blueprintId);
    if (!blueprint) throw new NotFoundException('Blueprint missing');
    return { file, blueprint };
  }

  stage(blueprint: Blueprint, code: string): BlueprintStage {
    const s = blueprint.stages.find((x) => x.code === code);
    if (!s) throw new BadRequestException(`Unknown stage ${code}`);
    return s;
  }

  actorOk(user: AuthUser, stage: BlueprintStage, file: ThesisFileDocument) {
    if (user.role === UserRole.INSTITUTE_ADMIN) return true;
    if (
      user.role === UserRole.DEALING &&
      [
        'CONSENT',
        'EVALUATE',
        'DISPATCH_THESIS',
        'CLOSE',
        'WAIT',
        'REVISION',
        'ADDITIONAL_PANEL',
        'VIVA',
        'PRACTICAL',
        'VIVA_DATE',
      ].includes(stage.type)
    ) {
      return true;
    }
    if (stage.actorRole === UserRole.GUIDE) {
      const email = (user.email || '').toLowerCase();
      if (file.chiefGuideEmail && file.chiefGuideEmail.toLowerCase() === email) return true;
      if (user.role === UserRole.DEALING && stage.type === 'PANEL_REQUEST') return true;
    }
    if (stage.actorRole === UserRole.EXAMINER && user.role === UserRole.DEALING) return true;
    if (
      stage.type === StageType.VIVA_DATE &&
      [UserRole.GUIDE, UserRole.EXAMINER].includes(user.role as any)
    ) {
      return true;
    }
    if (stage.actorRole !== user.role && canonicalUserRole(stage.actorRole) !== canonicalUserRole(user.role)) {
      throw new ForbiddenException(`This stage requires ${canonicalUserRole(stage.actorRole)}`);
    }
    if (!authoritySlotsMatch(stage.authoritySlot, user.authoritySlot)) {
      throw new ForbiddenException(`This stage requires ${stage.authoritySlot}`);
    }
  }

  rebuildMetro(file: ThesisFileDocument, blueprint: Blueprint) {
    const current = file.currentStageCode;
    const seen = new Set(file.metro.filter((m) => m.status === MetroStatus.COMPLETED).map((m) => m.stageCode));
    file.metro = blueprint.stages.map((s) => {
      const prev = file.metro.find((m) => m.stageCode === s.code);
      if (file.status === FileStatus.ON_HOLD && s.code === current) {
        return { ...prev, stageCode: s.code, stageName: s.name, status: MetroStatus.HOLD };
      }
      if (s.code === current) {
        return { ...prev, stageCode: s.code, stageName: s.name, status: MetroStatus.CURRENT };
      }
      if (seen.has(s.code) || prev?.status === MetroStatus.COMPLETED) {
        return { ...prev, stageCode: s.code, stageName: s.name, status: MetroStatus.COMPLETED };
      }
      return { stageCode: s.code, stageName: s.name, status: MetroStatus.UPCOMING };
    });
  }

  markCurrentComplete(file: ThesisFileDocument, user: AuthUser, remark?: string) {
    const cur = file.metro.find((m) => m.stageCode === file.currentStageCode);
    if (cur) {
      cur.status = MetroStatus.COMPLETED;
      cur.at = new Date();
      cur.by = user.name;
      cur.remark = remark;
    }
  }

  applyIncomingStage(file: ThesisFileDocument, blueprint: Blueprint, code: string) {
    const next = this.stage(blueprint, code);
    if (next.evaluationRound) file.evaluationRound = next.evaluationRound;
  }

  async advance(file: ThesisFileDocument, blueprint: Blueprint, user: AuthUser, remark?: string) {
    const stage = this.stage(blueprint, file.currentStageCode);
    this.markCurrentComplete(file, user, remark);
    const nextCode = stage.next;
    if (!nextCode) {
      file.status = FileStatus.COMPLETED;
      file.currentStageCode = stage.code;
    } else {
      file.currentStageCode = nextCode;
      file.status = FileStatus.IN_PROGRESS;
      this.applyIncomingStage(file, blueprint, nextCode);
    }
    file.lastActionRemark = remark;
    this.rebuildMetro(file, blueprint);
    await file.save();
    return file;
  }

  async hold(file: ThesisFileDocument, blueprint: Blueprint, user: AuthUser, remark: string) {
    if (!remark) throw new BadRequestException('Hold reason is required');
    file.status = FileStatus.ON_HOLD;
    file.lastActionRemark = remark;
    const cur = file.metro.find((m) => m.stageCode === file.currentStageCode);
    if (cur) {
      cur.status = MetroStatus.HOLD;
      cur.remark = remark;
      cur.by = user.name;
      cur.at = new Date();
    }
    this.rebuildMetro(file, blueprint);
    await file.save();
    return file;
  }

  async resume(file: ThesisFileDocument, blueprint: Blueprint) {
    file.status = FileStatus.IN_PROGRESS;
    this.rebuildMetro(file, blueprint);
    await file.save();
    return file;
  }

  async reject(file: ThesisFileDocument, blueprint: Blueprint, user: AuthUser, remark: string) {
    const stage = this.stage(blueprint, file.currentStageCode);
    this.markCurrentComplete(file, user, remark);
    if (stage.nextOnReject) {
      file.currentStageCode = stage.nextOnReject;
      file.status = FileStatus.IN_PROGRESS;
      this.applyIncomingStage(file, blueprint, stage.nextOnReject);
    } else {
      file.status = FileStatus.REJECTED;
    }
    file.lastActionRemark = remark;
    this.rebuildMetro(file, blueprint);
    await file.save();
    return file;
  }

  inboxFilter(user: AuthUser) {
    const iid = new Types.ObjectId(user.instituteId as string);
    if (user.role === UserRole.INSTITUTE_ADMIN) {
      return { instituteId: iid, status: { $in: [FileStatus.IN_PROGRESS, FileStatus.ON_HOLD] } };
    }
    if (user.role === UserRole.GUIDE) {
      return {
        instituteId: iid,
        status: { $ne: FileStatus.COMPLETED },
        chiefGuideEmail: user.email,
      };
    }
    return { instituteId: iid, status: { $in: [FileStatus.IN_PROGRESS, FileStatus.ON_HOLD] } };
  }

  matchesActor(file: ThesisFile, blueprint: Blueprint, user: AuthUser) {
    if (user.role === UserRole.INSTITUTE_ADMIN) return true;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    if (!stage) return false;
    if (
      user.role === UserRole.DEALING &&
      [
        'CONSENT',
        'EVALUATE',
        'DISPATCH_THESIS',
        'CLOSE',
        'WAIT',
        'PANEL_REQUEST',
        'REVISION',
        'ADDITIONAL_PANEL',
        'VIVA',
        'PRACTICAL',
        'VIVA_DATE',
      ].includes(stage.type)
    ) {
      return true;
    }
    if (stage.actorRole === UserRole.GUIDE) {
      return file.chiefGuideEmail?.toLowerCase() === user.email.toLowerCase();
    }
    if (canonicalUserRole(stage.actorRole) !== canonicalUserRole(user.role)) return false;
    if (!authoritySlotsMatch(stage.authoritySlot, user.authoritySlot)) return false;
    return true;
  }

  isPracticalStage(code?: string) {
    return String(code || '').startsWith('practical');
  }

  assigned(file: ThesisFile, round?: number) {
    const r = round ?? file.evaluationRound ?? 1;
    if (this.isPracticalStage(file.currentStageCode) || r === PRACTICAL_ROUND) {
      return file.panel.filter((p) => p.isPractical && p.assigned);
    }
    return file.panel.filter((p) => p.assigned && Number(p.round || 1) === r && !p.isPractical);
  }

  needsRevision(file: ThesisFile) {
    return this.assigned(file).some(
      (p) => p.evaluation?.verdict === Verdict.REVISION || p.evaluation?.verdict === Verdict.REJECT,
    );
  }

  acceptedCount(file: ThesisFile, round?: number) {
    return this.assigned(file, round).filter((p) => p.evaluation?.verdict === Verdict.ACCEPT).length;
  }

  allConsented(file: ThesisFile) {
    const a = this.isPracticalStage(file.currentStageCode)
      ? file.panel.filter((p) => p.isPractical && p.assigned)
      : this.assigned(file);
    if (!a.length) return false;
    const accepted = a.filter((p) => p.consentStatus === ConsentStatus.ACCEPTED);
    if (this.isPracticalStage(file.currentStageCode)) {
      return a.every((p) => p.consentStatus === ConsentStatus.ACCEPTED);
    }
    const round = Number(file.evaluationRound || 1);
    const target = Number((file as any).consentTargetCount || 0);
    if (round > 1 || !target) {
      return a.every((p) => p.consentStatus === ConsentStatus.ACCEPTED);
    }
    return accepted.length >= target && a.every((p) => p.consentStatus === ConsentStatus.ACCEPTED);
  }

  leftovers(file: ThesisFile) {
    return file.panel.filter(
      (p) =>
        !p.assigned &&
        !p.isPractical &&
        p.consentStatus !== ConsentStatus.REGRETTED &&
        p.vetStatus !== 'REJECTED' &&
        p.vetStatus !== 'HELD' &&
        !p.isChiefGuide,
    );
  }

  unusedInBucket(file: ThesisFile, bucketCode: string) {
    return this.leftovers(file).filter((p) => p.bucketCode === bucketCode);
  }

  async jumpTo(file: ThesisFileDocument, blueprint: Blueprint, user: AuthUser, code: string, remark?: string) {
    this.markCurrentComplete(file, user, remark);
    file.currentStageCode = code;
    file.status = FileStatus.IN_PROGRESS;
    file.lastActionRemark = remark;
    this.applyIncomingStage(file, blueprint, code);
    this.rebuildMetro(file, blueprint);
    await file.save();
    return file;
  }

  async restartFrom(
    file: ThesisFileDocument,
    blueprint: Blueprint,
    user: AuthUser,
    fromCode: string,
    throughCode: string,
    remark?: string,
  ) {
    this.markCurrentComplete(file, user, remark);
    file.currentStageCode = fromCode;
    file.status = FileStatus.IN_PROGRESS;
    this.applyIncomingStage(file, blueprint, fromCode);
    file.lastActionRemark = remark;
    this.rebuildMetro(file, blueprint);
    const reset = new Set<string>();
    let code = this.stage(blueprint, fromCode).next;
    const seen = new Set<string>();
    while (code && !seen.has(code)) {
      seen.add(code);
      reset.add(code);
      if (code === throughCode) break;
      code = this.stage(blueprint, code).next;
    }
    file.metro = file.metro.map((m) =>
      reset.has(m.stageCode)
        ? { stageCode: m.stageCode, stageName: m.stageName, status: MetroStatus.UPCOMING }
        : m,
    );
    await file.save();
    return file;
  }

  inboxLane(file: ThesisFile, blueprint: Blueprint): string {
    if (file.status === FileStatus.ON_HOLD) return InboxLane.ON_HOLD;
    if (file.resultStatus === 'HOLD') return InboxLane.RESULT_HELD;
    if (file.needsAdditionalPanel) return InboxLane.ADDITIONAL_PANEL;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    if (!stage) return InboxLane.OTHER;
    switch (stage.type) {
      case StageType.APPROVE:
        return stage.authoritySlot === 'ACE' ? InboxLane.ACE_REVIEW : InboxLane.DEAN_CG;
      case StageType.ASSIGN_NUMBER:
        return InboxLane.NEED_NUMBER;
      case StageType.PANEL_REQUEST:
        return InboxLane.PANEL_REQUEST;
      case StageType.PANEL_BUILD:
        return InboxLane.PANEL_PENDING_CG;
      case StageType.PANEL_SELECT:
        return InboxLane.PANEL_SELECT;
      case StageType.PANEL_VET:
        return InboxLane.PANEL_VET;
      case StageType.CONSENT_ROUTE:
        if (stage.letterKind === LetterKind.THESIS) return InboxLane.THESIS_HOP;
        if (stage.letterKind === LetterKind.REVISION) return InboxLane.REVISION;
        if (stage.letterKind === LetterKind.CG_EVAL) return InboxLane.CG_EVAL;
        if (stage.letterKind === LetterKind.VIVA) return InboxLane.VIVA;
        if (stage.letterKind === LetterKind.REMINDER) return InboxLane.REMINDER;
        return InboxLane.OFFER_HOP;
      case StageType.CONSENT:
        return InboxLane.CONSENT;
      case StageType.DISPATCH_THESIS:
        if (stage.letterKind === LetterKind.REVISION) return InboxLane.REVISION;
        if (stage.letterKind === LetterKind.VIVA) return InboxLane.VIVA;
        if (stage.letterKind === LetterKind.CG_EVAL) return InboxLane.CG_EVAL;
        if (stage.letterKind === LetterKind.BOARD) return InboxLane.PRACTICAL;
        return InboxLane.DISPATCH;
      case StageType.EVALUATE:
        return stage.actorRole === UserRole.GUIDE ? InboxLane.CG_EVAL : InboxLane.EVALUATE;
      case StageType.REVISION:
        return InboxLane.REVISION;
      case StageType.WAIT:
        return InboxLane.WAIT_TWO;
      case StageType.PICK_NTH:
        return InboxLane.NTH;
      case StageType.ADDITIONAL_PANEL:
        return InboxLane.ADDITIONAL_PANEL;
      case StageType.VIVA:
      case StageType.VIVA_DATE:
        return InboxLane.VIVA;
      case StageType.PRACTICAL:
        return InboxLane.PRACTICAL;
      case StageType.CLOSE:
        return InboxLane.CLOSE;
      default:
        return InboxLane.OTHER;
    }
  }
}
