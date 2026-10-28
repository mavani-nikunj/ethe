import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConsentStatus, FileStatus, LetterKind, StageType, UserRole, isCourseRole } from '@ethesis/shared';
import { asObjectIds } from '../common/course-scope';
import { PanelMember, ThesisFile } from '../database/thesis-file.schema';
import { Blueprint } from '../database/blueprint.schema';
import { AuthUser } from '../common/current-user';
import { FilesService } from '../files/files.service';
import { CommsService } from '../comms/comms.service';
import { PanelService } from './panel.service';

type SendItem = { fileId: string; panelIndex: number };

/**
 * Examiner consent tracker: every examiner who was mailed an offer letter, with their reply, and a way to send
 * the thesis / evaluation link straight to anyone who accepted. Assigned examiners not yet mailed the offer are
 * listed too (offerPending), so Dealing can send the offer once AO / ACE / Assoc. Dean routing is done. It sits beside the stage-driven Dispatch step and
 * never moves the file's stage, so the existing workflow behaves exactly as before.
 */
@Injectable()
export class ExaminerConsentsService {
  constructor(
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
    private filesService: FilesService,
    private comms: CommsService,
    private panel: PanelService,
  ) {}

  private assertCanSend(user: AuthUser) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can send thesis / evaluation letters');
    }
  }

  private sendBlockedReason(p: PanelMember, round: number) {
    if (p.isPractical) return 'Practical examiner';
    if (p.isChiefGuide) return 'Chief Guide';
    if (!String(p.email || '').trim()) return 'Examiner email is missing';
    if (p.consentStatus === ConsentStatus.REGRETTED) return 'Examiner regretted the offer';
    if (p.consentStatus !== ConsentStatus.ACCEPTED) return 'Waiting for the examiner to accept';
    if (!p.assigned) return 'Examiner is not assigned';
    if (Number(p.round || 1) !== round) return 'Examiner is not in the current round';
    if (p.evaluation?.verdict) return 'Evaluation already submitted';
    return null;
  }

  async list(user: AuthUser, month?: string, year?: string, session?: string, q?: string) {
    const scope = this.scope(user);
    const allBps = await this.blueprints.find({ instituteId: scope.instituteId }).select('stages').lean();
    // Offer-letter stages: AO / ACE / Assoc. Dean routing, then the consent stage where Dealing mails the offer.
    const offerStageCodes = new Set<string>();
    for (const bp of allBps) {
      for (const s of bp.stages || []) {
        if (!s.code || this.isPracticalCode(s.code)) continue;
        if (s.type === StageType.CONSENT || (s.type === StageType.CONSENT_ROUTE && s.letterKind === LetterKind.OFFER)) {
          offerStageCodes.add(s.code);
        }
      }
    }
    const and: Record<string, unknown>[] = [
      {
        $or: [
          // $elemMatch: a plain 'panel.offerSentAt' $ne null rejects the file when any member (e.g. a leftover) lacks it.
          { panel: { $elemMatch: { offerSentAt: { $exists: true, $ne: null } } } },
          { currentStageCode: { $in: [...offerStageCodes] } },
        ],
      },
    ];
    const filter: Record<string, unknown> = { ...scope, status: { $ne: FileStatus.DRAFT }, $and: and };
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      and.push({ $or: [
        { thesisNumber: rx },
        { fileNo: rx },
        { title: rx },
        { 'candidate.name': rx },
        { 'candidate.enrollmentNo': rx },
        { 'panel.name': rx },
        { 'panel.email': rx },
      ] });
    }
    const rows = await this.files
      .find(await this.filesService.withSessionFilter(user, filter, month, year, session))
      .sort({ updatedAt: -1 })
      .lean();
    const named = await this.filesService.withReportNames(rows);
    const bpById = new Map(allBps.map((bp) => [String(bp._id), bp]));
    const stageName = new Map<string, string>();
    for (const bp of allBps) {
      for (const s of bp.stages || []) stageName.set(`${bp._id}:${s.code}`, s.name || s.code);
    }
    const items: any[] = [];
    for (const file of named) {
      const round = Number(file.evaluationRound || 1);
      const bp = bpById.get(String(file.blueprintId));
      const stage = (bp?.stages || []).find((s) => s.code === file.currentStageCode);
      const atOfferStage = !!stage?.code && offerStageCodes.has(stage.code);
      (file.panel || []).forEach((p: PanelMember, idx: number) => {
        if (p.isPractical || p.isChiefGuide) return;
        const offerPending =
          !p.offerSentAt &&
          atOfferStage &&
          !!p.assigned &&
          Number(p.round || 1) === round &&
          p.consentStatus !== ConsentStatus.ACCEPTED &&
          p.consentStatus !== ConsentStatus.REGRETTED;
        if (!p.offerSentAt && !offerPending) return;
        const blocked = this.sendBlockedReason(p, round);
        const offerBlocked = !offerPending
          ? ''
          : stage?.type === StageType.CONSENT
            ? this.panel.offerSendBlockedReason(file, bp as any, idx) || ''
            : `Offer letter waiting at ${stage?.name || stage?.code}`;
        // Waiting examiners who missed the mail can be sent the offer again, only while the file is at consent.
        const waiting = !!p.offerSentAt && p.consentStatus !== ConsentStatus.ACCEPTED && p.consentStatus !== ConsentStatus.REGRETTED;
        const resendBlocked = !waiting
          ? ''
          : stage?.type === StageType.CONSENT
            ? this.panel.offerSendBlockedReason(file, bp as any, idx) || ''
            : `File has moved on to ${stage?.name || stage?.code}; resend from File 360`;
        items.push({
          id: `${file._id}:${idx}`,
          fileId: String(file._id),
          panelIndex: idx,
          thesisNumber: file.thesisNumber || '',
          fileNo: file.fileNo || '',
          candidateName: file.candidate?.name || '',
          courseName: file.courseName || '—',
          specialityName: file.specialityName || '—',
          stageName: stageName.get(`${file.blueprintId}:${file.currentStageCode}`) || file.currentStageCode || '—',
          examinerName: p.name || '',
          examinerEmail: p.email || '',
          examinerMobile: p.mobile || '',
          examinerDesignation: p.designation || '',
          examinerAffiliation: p.affiliation || '',
          bucketCode: p.bucketCode || '',
          round: Number(p.round || 1),
          consentStatus: p.consentStatus || ConsentStatus.PENDING,
          consentRemark: p.consentRemark || '',
          offerSentAt: p.offerSentAt,
          thesisSentAt: p.thesisSentAt || null,
          evaluationSubmitted: Boolean(p.evaluation?.verdict),
          canSend: !offerPending && !blocked,
          blockedReason: offerPending ? '' : blocked || '',
          offerPending,
          canSendOffer: offerPending && !offerBlocked,
          offerBlockedReason: offerBlocked,
          canResendOffer: waiting && !resendBlocked,
          resendOfferBlockedReason: resendBlocked,
        });
      });
    }
    return { items };
  }

  /**
   * Files this login may see here. Dealing / Authority logins with courses ticked in Staff mapping see only those
   * courses (none ticked = every course); course logins keep their own scope from fileScope.
   */
  private scope(user: AuthUser) {
    const filter = this.filesService.fileScope(user);
    const mapped = asObjectIds(user.courseIds);
    if (!isCourseRole(user.role) && mapped.length) filter.courseId = { $in: mapped };
    return filter;
  }

  private isPracticalCode(code?: string) {
    return String(code || '').startsWith('practical');
  }

  private cleanItems(rawItems: SendItem[]) {
    const seen = new Set<string>();
    const list = (Array.isArray(rawItems) ? rawItems : []).filter((it) => {
      const key = `${it?.fileId}:${it?.panelIndex}`;
      if (!it?.fileId || !Types.ObjectId.isValid(String(it.fileId)) || !Number.isInteger(Number(it.panelIndex))) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!list.length) throw new BadRequestException('Select at least one examiner');
    if (list.length > 50) throw new BadRequestException('Send at most 50 letters at a time');
    return list;
  }

  /**
   * Mails the offer (acceptance) letter via the same path as File 360. Without resend it only goes to examiners not
   * yet sent it; with resend it goes again to examiners still waiting to accept (e.g. one who missed the mail).
   */
  async sendOffer(user: AuthUser, rawItems: SendItem[], resend = false) {
    this.assertCanSend(user);
    const list = this.cleanItems(rawItems);
    const sent: { id: string; name: string; email: string }[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const it of list) {
      const id = `${it.fileId}:${it.panelIndex}`;
      try {
        const file = await this.files
          .findOne({ ...this.scope(user), _id: new Types.ObjectId(String(it.fileId)) })
          .select('panel')
          .lean();
        if (!file) throw new BadRequestException('File not found');
        const member = file.panel?.[Number(it.panelIndex)];
        if (!member) throw new BadRequestException('Invalid examiner');
        // A first send never mails the same examiner twice; resend is only for examiners already mailed.
        if (!resend && member.offerSentAt) throw new BadRequestException('Offer letter already sent');
        if (resend && !member.offerSentAt) throw new BadRequestException('Offer letter was never sent');
        const r = await this.panel.resendOffer(user, String(it.fileId), Number(it.panelIndex));
        sent.push({ id, name: r.offer.name, email: r.offer.email });
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not send offer letter' });
      }
    }
    return {
      sent,
      failed,
      message: `Offer letter ${resend ? 'resent' : 'sent'} to ${sent.length} examiner(s)${failed.length ? `, ${failed.length} skipped` : ''}.`,
    };
  }

  /** Sends the thesis / evaluation link to each accepted examiner. Bulk calls skip anyone already sent unless resend. */
  async sendThesis(user: AuthUser, rawItems: SendItem[], resend = false) {
    this.assertCanSend(user);
    const list = this.cleanItems(rawItems);
    await this.comms.seedDefaults(user);
    const sent: { id: string; name: string; email: string }[] = [];
    const failed: { id: string; name?: string; message: string }[] = [];
    for (const it of list) {
      const id = `${it.fileId}:${it.panelIndex}`;
      const index = Number(it.panelIndex);
      try {
        const file = await this.files.findOne({ ...this.scope(user), _id: new Types.ObjectId(String(it.fileId)) });
        if (!file) throw new BadRequestException('File not found');
        const member = file.panel?.[index];
        if (!member) throw new BadRequestException('Invalid examiner');
        const blocked = this.sendBlockedReason(member, Number(file.evaluationRound || 1));
        if (blocked) throw new BadRequestException(blocked);
        if (member.thesisSentAt && !resend) throw new BadRequestException('Thesis already sent');
        const email = String(member.email).trim().toLowerCase();
        await this.panel.createTask(user.instituteId as string, String(file._id), 'EVALUATE', email, member.name, index);
        await this.files.updateOne({ _id: file._id }, { $set: { [`panel.${index}.thesisSentAt`]: new Date() } });
        sent.push({ id, name: member.name, email });
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not send thesis' });
      }
    }
    return {
      sent,
      failed,
      message: `Thesis / evaluation letter sent to ${sent.length} examiner(s)${failed.length ? `, ${failed.length} skipped` : ''}.`,
    };
  }
}
