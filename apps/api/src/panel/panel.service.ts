import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { PanelMember, ThesisFile, ThesisFileDocument } from '../database/thesis-file.schema';
import { TaskToken } from '../database/comms.schema';
import { ExaminerPool } from '../database/masters.schema';
import { ConsentStatus, LetterKind, PRODUCT_NAME, UserRole, VetStatus, StageType, PRACTICAL_ROUND, PracticalRole, isValidEmail, isValidMobile, cleanMobile, normalizeIndianMobile } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { WorkflowService } from '../files/workflow.service';
import { FilesService } from '../files/files.service';
import { MailerService } from '../common/mailer.service';
import { CommsService } from '../comms/comms.service';
import { SystemMail } from '../comms/catalog/system-defaults';
import { taskUrl } from '../common/web-origin';

@Injectable()
export class PanelService {
  constructor(
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(TaskToken.name) private tokens: Model<TaskToken>,
    @InjectModel(ExaminerPool.name) private examiners: Model<ExaminerPool>,
    private workflow: WorkflowService,
    private mailer: MailerService,
    private comms: CommsService,
    private filesService: FilesService,
  ) {}

  private normalizeEmail(value?: string) {
    return String(value || '').trim().toLowerCase();
  }

  private assertGuideBuildsPanel(user: AuthUser, file: ThesisFile, stage: { type: string }) {
    if (![StageType.PANEL_BUILD, StageType.ADDITIONAL_PANEL].includes(stage.type as any)) {
      throw new BadRequestException('Panel can only be built at the Chief Guide panel stage');
    }
    const email = (user.email || '').toLowerCase();
    if (file.chiefGuideEmail && file.chiefGuideEmail.toLowerCase() === email) return;
    throw new ForbiddenException('Only the Chief Guide can add or submit the panel');
  }

  async listKnownExaminers(instituteId: string, q?: string, currentFileId?: string) {
    const iid = new Types.ObjectId(instituteId);
    const needle = String(q || '').trim().toLowerCase();
    const [pool, files] = await Promise.all([
      this.examiners.find({ instituteId: iid }).sort({ name: 1 }).lean(),
      this.files.find({ instituteId: iid }).select('panel').lean(),
    ]);
    const byEmail = new Map<string, Record<string, string>>();
    const absorb = (p: any) => {
      const email = this.normalizeEmail(p?.email);
      const name = String(p?.name || '').trim();
      if (!email || !name) return;
      const prev = byEmail.get(email) || {};
      byEmail.set(email, {
        name: name || prev.name || '',
        email,
        mobile: String(p.mobile || prev.mobile || ''),
        designation: String(p.designation || prev.designation || ''),
        department: String(p.department || prev.department || ''),
        affiliation: String(p.affiliation || prev.affiliation || ''),
        address: String(p.address || prev.address || ''),
        city: String(p.city || prev.city || ''),
        country: String(p.country || prev.country || ''),
      });
    };
    for (const f of files) for (const p of f.panel || []) absorb(p);
    for (const p of pool) absorb(p);
    const onThis = new Set<string>();
    if (currentFileId) {
      const current = files.find((f) => String(f._id) === String(currentFileId));
      for (const p of current?.panel || []) {
        const email = this.normalizeEmail(p?.email);
        if (email) onThis.add(email);
      }
    }
    return [...byEmail.values()]
      .filter((p) => {
        if (!needle) return true;
        return (
          p.name.toLowerCase().includes(needle) ||
          p.email.includes(needle) ||
          (p.affiliation || '').toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 120)
      .map((p) => ({ ...p, onThisPanel: onThis.has(p.email) }));
  }

  private async upsertKnownExaminer(instituteId: string, body: any) {
    const email = this.normalizeEmail(body.email);
    const name = String(body.name || '').trim();
    if (!email || !name) return;
    const iid = new Types.ObjectId(instituteId);
    await this.examiners.findOneAndUpdate(
      { instituteId: iid, email },
      {
        $set: {
          name,
          ...(body.mobile ? { mobile: body.mobile } : {}),
          ...(body.designation ? { designation: body.designation } : {}),
          ...(body.department ? { department: body.department } : {}),
          ...(body.affiliation ? { affiliation: body.affiliation } : {}),
          ...(body.address ? { address: body.address } : {}),
          ...(body.city ? { city: body.city } : {}),
          ...(body.country ? { country: body.country } : {}),
        },
        $setOnInsert: { instituteId: iid, email },
      },
      { upsert: true },
    );
  }

  async addMember(user: AuthUser, fileId: string, body: any) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    this.assertGuideBuildsPanel(user, file, stage);
    const name = String(body.name || '').trim();
    const email = this.normalizeEmail(body.email);
    if (!name || !email) throw new BadRequestException('Name and email are required');
    if (!isValidEmail(email)) throw new BadRequestException('Invalid email address format');
    let mobile: string | undefined = undefined;
    if (body.mobile && String(body.mobile).trim() !== '') {
      const mob = cleanMobile(body.mobile);
      if (!isValidMobile(mob)) {
        throw new BadRequestException('Mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      mobile = mob;
    }
    if (file.chiefGuideEmail && this.normalizeEmail(file.chiefGuideEmail) === email) {
      throw new BadRequestException('The Chief Guide cannot be added as an examiner');
    }
    if ((file.panel || []).some((p) => this.normalizeEmail(p.email) === email)) {
      throw new BadRequestException('This examiner is already on this panel');
    }
    const buckets = blueprint.panelRule?.buckets || [];
    const bucket = buckets.find((b) => b.code === body.bucketCode);
    if (!bucket) throw new BadRequestException('Invalid bucket');
    const inBucket = file.panel.filter((p) => p.bucketCode === body.bucketCode && p.round === 1 && !p.extra).length;
    const extraAllowed = file.needsAdditionalPanel || body.extra === true;
    if (!extraAllowed && inBucket >= bucket.count) {
      throw new BadRequestException(`${bucket.label} quota (${bucket.count}) is full`);
    }
    file.panel.push({
      name,
      email,
      mobile,
      designation: body.designation,
      department: body.department,
      affiliation: body.affiliation,
      address: body.address,
      city: body.city,
      country: body.country,
      bucketCode: body.bucketCode,
      assigned: false,
      extra: extraAllowed && inBucket >= bucket.count,
      vetStatus: VetStatus.PENDING,
      round: 1,
      consentStatus: ConsentStatus.PENDING,
    });
    file.markModified('panel');
    await file.save();
    await this.upsertKnownExaminer(user.instituteId as string, {
      name,
      email,
      mobile: body.mobile,
      designation: body.designation,
      department: body.department,
      affiliation: body.affiliation,
      address: body.address,
      city: body.city,
      country: body.country,
    });
    return file;
  }

  async removeMember(user: AuthUser, fileId: string, index: number) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    this.assertGuideBuildsPanel(user, file, stage);
    file.panel.splice(index, 1);
    file.markModified('panel');
    await file.save();
    return file;
  }

  /**
   * Why the Chief Guide can no longer change this examiner from the panel link, or null if they can.
   * Before the panel is submitted nothing has happened to the examiners yet; at the additional-panel
   * stage the earlier examiners are already in process, so only the new extra ones stay editable.
   */
  panelLockReason(member: Partial<PanelMember> | undefined, stageType?: string): string | null {
    if (!member) return 'This examiner is no longer on the panel';
    if (member.isChiefGuide) return 'This is the Chief Guide entry';
    if (member.offerSentAt) return 'The offer letter has already been sent';
    if (member.assigned) return 'The examiner has already been assigned';
    if (member.consentStatus && member.consentStatus !== ConsentStatus.PENDING) return 'The examiner has already responded to the offer';
    if ((member as any).evaluation?.verdict) return 'The examiner has already evaluated the thesis';
    if (member.vetStatus && member.vetStatus !== VetStatus.PENDING) return 'The Examination Section has already checked this examiner';
    if (stageType === StageType.ADDITIONAL_PANEL && !member.extra) return 'Examiners from the earlier panel cannot be changed';
    return null;
  }

  /** Chief Guide (panel link): the examiner they are changing, checked for stage, ownership and lock. */
  private async guideEditable(user: AuthUser, fileId: string, email: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (![StageType.PANEL_BUILD, StageType.ADDITIONAL_PANEL].includes(stage.type as any)) {
      throw new BadRequestException('The panel has already been submitted and can no longer be changed.');
    }
    this.assertGuideBuildsPanel(user, file, stage);
    const key = this.normalizeEmail(email);
    const member = (file.panel || []).find((p) => this.normalizeEmail(p.email) === key);
    if (!member) throw new NotFoundException('This examiner is no longer on the panel. Please refresh the page.');
    const reason = this.panelLockReason(member, stage.type);
    if (reason) throw new ConflictException(`Locked: ${reason}. Contact the Examination Section to make changes.`);
    return { file, blueprint, member };
  }

  /** Chief Guide edits an examiner they added, before the panel is submitted. Same rules as addMember. */
  async guideUpdateMember(user: AuthUser, fileId: string, email: string, body: any) {
    const { file, blueprint, member } = await this.guideEditable(user, fileId, email);
    const fieldError = (field: string, message: string) =>
      new BadRequestException({ statusCode: 400, message, error: 'Bad Request', field });

    const name = String(body?.name || '').trim();
    if (!name) throw fieldError('name', 'Examiner name is required');
    const newEmail = this.normalizeEmail(body?.email);
    if (!newEmail) throw fieldError('email', 'Examiner email is required');
    if (!isValidEmail(newEmail)) throw fieldError('email', 'Examiner email is invalid (e.g. examiner@domain.edu)');
    if (newEmail !== this.normalizeEmail(member.email)) {
      if (file.chiefGuideEmail && this.normalizeEmail(file.chiefGuideEmail) === newEmail) {
        throw fieldError('email', 'The Chief Guide cannot be added as an examiner');
      }
      if ((file.panel || []).some((p) => p !== member && this.normalizeEmail(p.email) === newEmail)) {
        throw fieldError('email', 'Another examiner on this panel already uses this email');
      }
    }
    let mobile = '';
    if (body?.mobile && String(body.mobile).trim() !== '') {
      mobile = normalizeIndianMobile(body.mobile);
      if (!isValidMobile(mobile)) throw fieldError('mobile', 'Examiner mobile must be a valid 10-digit Indian mobile number');
    }
    const buckets = blueprint.panelRule?.buckets || [];
    const bucket = buckets.find((b) => b.code === body?.bucketCode);
    if (!bucket) throw fieldError('bucketCode', 'Please select a bucket for this examiner');
    if (bucket.code !== member.bucketCode && !member.extra) {
      const inBucket = file.panel.filter((p) => p !== member && p.bucketCode === bucket.code && p.round === 1 && !p.extra).length;
      if (inBucket >= bucket.count) {
        throw fieldError('bucketCode', `${bucket.label} quota (${bucket.count}) is full. Remove an examiner from it first.`);
      }
    }

    const text = (v: unknown) => (v === undefined || v === null ? undefined : String(v).trim());
    member.name = name;
    member.email = newEmail;
    member.mobile = mobile || undefined;
    member.bucketCode = bucket.code;
    member.designation = text(body?.designation) as any;
    member.department = text(body?.department) as any;
    member.affiliation = text(body?.affiliation) as any;
    member.address = text(body?.address) as any;
    member.city = text(body?.city) as any;
    member.country = text(body?.country) as any;
    file.markModified('panel');
    await file.save();
    await this.upsertKnownExaminer(user.instituteId as string, {
      name,
      email: newEmail,
      mobile,
      designation: member.designation,
      department: member.department,
      affiliation: member.affiliation,
      address: member.address,
      city: member.city,
      country: member.country,
    });
    return file;
  }

  /** Chief Guide removes an examiner they added, before the panel is submitted. Matched by email, never by position. */
  async guideRemoveMember(user: AuthUser, fileId: string, email: string) {
    const { file, member } = await this.guideEditable(user, fileId, email);
    file.panel = file.panel.filter((p) => p !== member) as any;
    file.markModified('panel');
    await file.save();
    return file;
  }

  async updateMember(user: AuthUser, fileId: string, index: number, body: any, chequePath?: string) {
    const { file } = await this.workflow.load(fileId, user.instituteId as string);
    const allowed = [
      UserRole.DEALING,
      UserRole.ACADEMIC,
      UserRole.INSTITUTE_ADMIN,
      UserRole.SUPER_ADMIN,
      UserRole.AUTHORITY,
    ];
    if (!allowed.includes(user.role as any)) {
      throw new ForbiddenException('Not authorized to edit examiner details');
    }
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner index');

    if (body.name !== undefined) member.name = String(body.name).trim();
    if (body.designation !== undefined) member.designation = String(body.designation).trim();
    if (body.department !== undefined) member.department = String(body.department).trim();
    if (body.affiliation !== undefined) member.affiliation = String(body.affiliation).trim();
    if (body.institute !== undefined) member.affiliation = String(body.institute).trim();
    if (body.address !== undefined) member.address = String(body.address).trim();
    if (body.city !== undefined) member.city = String(body.city).trim();
    if (body.mobile !== undefined && String(body.mobile).trim() !== '') {
      const mob = cleanMobile(body.mobile);
      if (!isValidMobile(mob)) {
        throw new BadRequestException('Mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      member.mobile = mob;
    } else if (body.mobile !== undefined) {
      member.mobile = '';
    }
    if (body.alternateMobile !== undefined && String(body.alternateMobile).trim() !== '') {
      const altMob = cleanMobile(body.alternateMobile);
      if (!isValidMobile(altMob)) {
        throw new BadRequestException('Alternate mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      member.alternateMobile = altMob;
    } else if (body.alternateMobile !== undefined) {
      member.alternateMobile = '';
    }
    if (body.bucketCode !== undefined) member.bucketCode = String(body.bucketCode).trim().toUpperCase();

    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!email || !isValidEmail(email)) {
        throw new BadRequestException('Invalid email address format');
      }
      const oldEmail = member.email;
      member.email = email;
      if (oldEmail && oldEmail !== member.email) {
        await this.tokens.updateMany(
          { fileId: file._id, email: oldEmail },
          { $set: { email: member.email, name: member.name } },
        );
      }
    }
    if (body.alternateEmail !== undefined && String(body.alternateEmail).trim() !== '') {
      const altEmail = String(body.alternateEmail).trim().toLowerCase();
      if (!isValidEmail(altEmail)) {
        throw new BadRequestException('Invalid alternate email address format');
      }
      member.alternateEmail = altEmail;
    } else if (body.alternateEmail !== undefined) {
      member.alternateEmail = '';
    }

    if (body.consentStatus !== undefined) member.consentStatus = body.consentStatus;
    if (body.consentRemark !== undefined) member.consentRemark = String(body.consentRemark).trim();

    const bank =
      typeof body.bank === 'string'
        ? (() => {
            try {
              return JSON.parse(body.bank);
            } catch {
              return {};
            }
          })()
        : body.bank || {};
    const holderName = bank.holderName ?? body.holderName;
    const bankName = bank.bankName ?? body.bankName;
    const branchAddress = bank.branchAddress ?? body.branchAddress;
    const ifsc = bank.ifsc ?? body.ifsc;
    const accountType = bank.accountType ?? body.accountType;
    const account = bank.account ?? body.account;
    const pan = bank.pan ?? body.pan;

    if (
      holderName !== undefined ||
      bankName !== undefined ||
      branchAddress !== undefined ||
      ifsc !== undefined ||
      accountType !== undefined ||
      account !== undefined ||
      pan !== undefined
    ) {
      member.bank = member.bank || {};
      if (holderName !== undefined) member.bank.holderName = String(holderName).trim();
      if (bankName !== undefined) member.bank.bankName = String(bankName).trim();
      if (branchAddress !== undefined) member.bank.branchAddress = String(branchAddress).trim();
      if (ifsc !== undefined) member.bank.ifsc = String(ifsc).trim().toUpperCase();
      if (accountType !== undefined) member.bank.accountType = String(accountType).trim();
      if (account !== undefined) member.bank.account = String(account).trim();
      if (pan !== undefined) member.bank.pan = String(pan).trim().toUpperCase();
    }

    if (chequePath) {
      member.bank = member.bank || {};
      member.bank.cancelledChequePath = chequePath;
    }

    file.markModified('panel');
    await file.save();
    return file;
  }

  private formatPanelList(
    panel: PanelMember[],
    buckets: { code: string; label: string }[],
    additional: boolean,
  ) {
    const members = additional
      ? panel.filter((p) => p.extra && p.consentStatus !== ConsentStatus.REGRETTED)
      : panel.filter((p) => Number(p.round || 1) === 1);
    return members
      .map((p, i) => {
        const bucket = buckets.find((b) => b.code === p.bucketCode);
        const location = [p.city, p.country].filter(Boolean).join(', ');
        const lines = [
          `${i + 1}. ${p.name || 'Examiner'}`,
          p.email ? `   Email: ${p.email}` : '',
          `   Bucket: ${bucket?.label || p.bucketCode || '—'}`,
          p.affiliation ? `   Affiliation: ${p.affiliation}` : '',
          p.designation ? `   Designation: ${p.designation}` : '',
          p.mobile ? `   Mobile: ${p.mobile}` : '',
          location ? `   Location: ${location}` : '',
        ].filter(Boolean);
        return lines.join('\n');
      })
      .join('\n\n');
  }

  async submitPanel(user: AuthUser, fileId: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    this.assertGuideBuildsPanel(user, file, stage);
    const buckets = blueprint.panelRule?.buckets || [];
    if (!file.needsAdditionalPanel) {
      for (const b of buckets) {
        const n = file.panel.filter((p) => p.bucketCode === b.code && p.round === 1).length;
        if (n < b.count) throw new BadRequestException(`Need ${b.count} ${b.label} examiners (have ${n})`);
      }
    } else {
      const extras = file.panel.filter((p) => p.extra && p.consentStatus !== ConsentStatus.REGRETTED);
      if (!extras.length) throw new BadRequestException('Add at least one extra examiner for the additional panel');
    }
    if (!file.chiefGuideEmail) throw new BadRequestException('Chief Guide email missing');
    const panelList = this.formatPanelList(file.panel, buckets, Boolean(file.needsAdditionalPanel));
    await this.comms.sendForPurpose({
      instituteId: user.instituteId as string,
      purpose: 'PANEL_SUBMITTED',
      file,
      to: file.chiefGuideEmail,
      toName: file.chiefGuideName,
      extraVars: {
        panelList,
        chiefGuideName: file.chiefGuideName || '',
        chiefGuideEmail: file.chiefGuideEmail,
      },
    });
    file.needsAdditionalPanel = false;
    return this.workflow.advance(file, blueprint, user, 'Panel submitted');
  }

  async vetMember(user: AuthUser, fileId: string, index: number, status: string, remark?: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN, UserRole.AUTHORITY].includes(user.role as any)) {
      this.workflow.actorOk(user, stage, file);
    }
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner');
    if (![VetStatus.APPROVED, VetStatus.HELD, VetStatus.REJECTED].includes(status as any)) {
      throw new BadRequestException('Invalid vet status');
    }
    member.vetStatus = status;
    if (status === VetStatus.HELD || status === VetStatus.REJECTED) {
      member.assigned = false;
    } else {
      member.assigned = true;
    }
    file.lastActionRemark = remark || `${member.name} ${status}`;
    file.markModified('panel');
    await file.save();
    return file;
  }

  async replaceFromBucket(fileId: string, instituteId: string, bucketCode: string, roundHint?: number) {
    const { file, blueprint } = await this.workflow.load(fileId, instituteId);
    const round = Number(roundHint || file.evaluationRound || 1);
    const unused = this.workflow.leftovers(file);
    if (unused.length) {
      return { replaced: false, leftover: true, leftoverCount: unused.length };
    }
    const pickNth = blueprint.stages.find((s) => s.type === StageType.PICK_NTH);
    if (round === 3 && pickNth) {
      file.needsAdditionalPanel = false;
      file.currentStageCode = pickNth.code;
      this.workflow.rebuildMetro(file, blueprint);
      file.markModified('panel');
      await file.save();
      return { replaced: false, pickNth: true };
    }
    file.needsAdditionalPanel = true;
    const extra = blueprint.stages.find((s) => s.type === StageType.ADDITIONAL_PANEL);
    if (extra) {
      file.currentStageCode = extra.code;
      this.workflow.rebuildMetro(file, blueprint);
    }
    file.markModified('panel');
    await file.save();
    if (file.chiefGuideEmail) {
      await this.createTask(instituteId, fileId, 'PANEL_BUILD', file.chiefGuideEmail, file.chiefGuideName);
    }
    return { replaced: false, additionalPanel: true };
  }

  async assign(user: AuthUser, fileId: string, indexes: number[], assigned: boolean) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN, UserRole.AUTHORITY].includes(user.role as any)) {
      throw new BadRequestException('Not allowed');
    }
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (stage.type === StageType.PANEL_BUILD || stage.type === StageType.ADDITIONAL_PANEL) {
      throw new ForbiddenException('Wait for the Chief Guide to submit the panel before assigning examiners');
    }
    indexes.forEach((i) => {
      if (file.panel[i]) file.panel[i].assigned = assigned;
    });
    file.markModified('panel');
    await file.save();
    return file;
  }

  async assignPractical(user: AuthUser, fileId: string, body: any) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can assign the practical board');
    }
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (!this.workflow.isPracticalStage(stage.code) || stage.type !== StageType.PRACTICAL) {
      throw new BadRequestException('Practical board can only be assigned at appointment');
    }
    const role = String(body.practicalRole || '').toUpperCase();
    if (!Object.values(PracticalRole).includes(role as any)) {
      throw new BadRequestException('Role must be Chairperson, Internal or External');
    }
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    if (!name || !email) throw new BadRequestException('Name and email are required');
    if (!isValidEmail(email)) throw new BadRequestException('Invalid email address format');
    let practicalMobile: string | undefined = undefined;
    if (body.mobile && String(body.mobile).trim() !== '') {
      const mob = cleanMobile(body.mobile);
      if (!isValidMobile(mob)) {
        throw new BadRequestException('Mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      practicalMobile = mob;
    }
    const existing = file.panel.findIndex((p) => p.isPractical && p.practicalRole === role);
    const member: PanelMember = {
      name,
      email,
      mobile: practicalMobile,
      designation: body.designation,
      department: body.department,
      affiliation: body.affiliation,
      address: body.address,
      city: body.city,
      country: body.country,
      bucketCode: 'PRACTICAL',
      assigned: true,
      round: PRACTICAL_ROUND,
      isPractical: true,
      practicalRole: role,
      vetStatus: VetStatus.PENDING,
      consentStatus: ConsentStatus.PENDING,
    };
    if (existing >= 0) file.panel[existing] = { ...file.panel[existing], ...member };
    else file.panel.push(member);
    file.consentTargetCount = file.panel.filter((p) => p.isPractical && p.assigned).length;
    file.markModified('panel');
    await file.save();
    return file;
  }

  async practicalDetails(user: AuthUser, fileId: string) {
    const { file } = await this.workflow.load(fileId, user.instituteId as string);
    const rows = (file.panel || []).filter((p) => p.isPractical);
    const header = ['Role', 'Name', 'Email', 'Mobile', 'Affiliation', 'City', 'Consent', 'Vet'];
    const lines = [
      header.join(','),
      ...rows.map((p) =>
        [p.practicalRole, p.name, p.email, p.mobile, p.affiliation, p.city, p.consentStatus, p.vetStatus]
          .map((v) => `"${String(v || '').replaceAll('"', '""')}"`)
          .join(','),
      ),
    ];
    return {
      filename: `practical-board-${file.thesisNumber || 'file'}.csv`,
      csv: lines.join('\n'),
    };
  }

  async pickNth(user: AuthUser, fileId: string, index: number) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    this.workflow.actorOk(user, stage, file);
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner');
    if (stage.nthBucketCode && member.bucketCode !== stage.nthBucketCode) {
      throw new BadRequestException(`4th examiner must be from ${stage.nthBucketCode}`);
    }
    if (member.evaluation?.verdict) {
      throw new BadRequestException('This examiner already submitted a report. Pick a leftover Indian name.');
    }
    file.panel.forEach((p) => {
      if (p.round === 3) p.assigned = false;
    });
    member.round = 3;
    member.assigned = true;
    member.consentStatus = ConsentStatus.PENDING;
    member.evaluation = undefined;
    file.evaluationRound = 3;
    file.consentTargetCount = 1;
    file.markModified('panel');
    await file.save();
    return this.workflow.advance(file, blueprint, user, `4th examiner ${member.name}`);
  }

  async createTask(instituteId: string, fileId: string, purpose: string, email: string, name?: string, panelIndex?: number) {
    const token = randomBytes(24).toString('hex');
    const isExaminer = purpose === 'CONSENT' || purpose === 'EVALUATE';
    const row = await this.tokens.create({
      token,
      instituteId: new Types.ObjectId(instituteId),
      fileId: new Types.ObjectId(fileId),
      purpose,
      email: email.toLowerCase(),
      name,
      panelIndex,
      verified: isExaminer ? true : false,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    const link = taskUrl(token);
    const file = await this.files.findById(fileId);
    if (file && this.comms) {
      await this.comms.sendForPurpose({
        instituteId,
        purpose,
        file,
        to: email,
        toName: name,
        extraVars: {
          taskLink: link,
          examinerName: name || '',
          chiefGuideName: file.chiefGuideName || name || '',
          chiefGuideEmail: file.chiefGuideEmail || '',
        },
      });
    } else {
      await this.comms.sendSystemMail(instituteId, SystemMail.TASK_LINK, email, { name: name || '', purpose, taskLink: link }, name);
    }
    return { token, link, id: row._id, email, name };
  }

  async updateTravel(user: AuthUser, fileId: string, index: number, travel: Record<string, string>) {
    const { file } = await this.workflow.load(fileId, user.instituteId as string);
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN, UserRole.AUTHORITY].includes(user.role as any)) {
      throw new BadRequestException('Not allowed');
    }
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner');
    member.travel = {
      fromCity: travel.fromCity || member.travel?.fromCity,
      toCity: travel.toCity || member.travel?.toCity,
      departDate: travel.departDate || member.travel?.departDate,
      returnDate: travel.returnDate || member.travel?.returnDate,
      pnr: travel.pnr || member.travel?.pnr,
      hotel: travel.hotel || member.travel?.hotel,
      mode: travel.mode || member.travel?.mode,
      tadaAmount: travel.tadaAmount || member.travel?.tadaAmount,
    };
    file.markModified('panel');
    await file.save();
    return file;
  }

  async requestPanelLink(user: AuthUser, fileId: string, resend = false) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    if (!file.chiefGuideEmail) throw new BadRequestException('Chief Guide email missing');
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    const waiting =
      stage.type === StageType.PANEL_BUILD || stage.type === StageType.ADDITIONAL_PANEL;
    if (!resend && waiting) {
      throw new BadRequestException('Panel already requested. Use resend to mail the Chief Guide again.');
    }
    if (resend && !waiting && stage.type !== StageType.PANEL_REQUEST) {
      throw new BadRequestException('This file is not waiting for a Chief Guide panel');
    }
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can request the panel from the Chief Guide');
    }
    await this.comms.seedDefaults(user);
    const task = await this.createTask(
      user.instituteId as string,
      fileId,
      'PANEL_BUILD',
      file.chiefGuideEmail,
      file.chiefGuideName,
    );
    if (!waiting) {
      await this.workflow.advance(file, blueprint, user, 'Panel requested from Chief Guide');
    }
    return {
      ...task,
      fileId,
      resent: waiting,
      message: waiting
        ? `Panel request resent to ${file.chiefGuideEmail}.`
        : `Panel request sent to ${file.chiefGuideEmail}.`,
    };
  }

  /**
   * Request the panel for several files; each Chief Guide gets their own mail and task link, exactly as a
   * single Request panel. Kept small per call so the web client can send in chunks and show progress.
   */
  async bulkRequestPanel(user: AuthUser, ids: string[]) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can request the panel from the Chief Guide');
    }
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!list.length) throw new BadRequestException('Select at least one thesis');
    if (list.length > 25) throw new BadRequestException('Send at most 25 panel requests at a time');
    const sent: { id: string; email: string }[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of list) {
      try {
        const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
        if (!this.filesService.canBulkRequestPanel(user, file as any, blueprint)) {
          const stage = this.workflow.stage(blueprint, file.currentStageCode);
          throw new BadRequestException(
            !String(file.chiefGuideEmail || '').trim() && stage.type === StageType.PANEL_REQUEST
              ? 'Chief Guide email missing'
              : 'This file is not at the Request panel step',
          );
        }
        await this.requestPanelLink(user, id, false);
        sent.push({ id, email: file.chiefGuideEmail as string });
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not request panel' });
      }
    }
    return { sent, failed };
  }

  /**
   * Mail the Chief Guide again for several files sitting at the panel-build step. Each file gets its own mail and
   * task link, exactly like the single row's resend. Kept small per call so the web client can chunk and show progress.
   */
  async bulkResendPanel(user: AuthUser, ids: string[]) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can resend the panel request to the Chief Guide');
    }
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!list.length) throw new BadRequestException('Select at least one thesis');
    if (list.length > 25) throw new BadRequestException('Send at most 25 panel requests at a time');
    const sent: { id: string; email: string }[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of list) {
      try {
        const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
        if (!this.filesService.canBulkResendPanel(user, file as any, blueprint)) {
          throw new BadRequestException(
            !String(file.chiefGuideEmail || '').trim()
              ? 'Chief Guide email missing'
              : 'This file is not waiting for the Chief Guide to build the panel',
          );
        }
        await this.requestPanelLink(user, id, true);
        sent.push({ id, email: file.chiefGuideEmail as string });
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not resend panel request' });
      }
    }
    return { sent, failed };
  }

  private examinerNeedsVet(blueprint: { stages?: { type?: string; code?: string }[] }, stage: { code?: string }) {
    return (blueprint.stages || []).some((s) => {
      if (s.type !== StageType.PANEL_VET) return false;
      return stage.code === 'practical_offer' || stage.code === 'practical_vet'
        ? s.code === 'practical_vet'
        : s.code !== 'practical_vet';
    });
  }

  private leftoverApprovalStart(blueprint: { stages?: { type?: string; code?: string; next?: string; letterKind?: string; name?: string }[] }, consentCode: string) {
    const stages = blueprint.stages || [];
    const chain: typeof stages = [];
    const seen = new Set<string>();
    const queue = [consentCode];
    while (queue.length) {
      const cur = queue.shift() as string;
      for (const pred of stages.filter((s) => s.next === cur)) {
        if (!pred.code || seen.has(pred.code)) continue;
        const isApproval =
          pred.type === StageType.PANEL_VET ||
          pred.type === StageType.PANEL_SELECT ||
          (pred.type === StageType.CONSENT_ROUTE && pred.letterKind === LetterKind.OFFER);
        if (!isApproval) continue;
        seen.add(pred.code);
        chain.push(pred);
        queue.push(pred.code);
      }
    }
    const vet = chain.find((s) => s.type === StageType.PANEL_VET);
    if (vet) return vet;
    const offerHops = chain.filter((s) => s.type === StageType.CONSENT_ROUTE && s.letterKind === LetterKind.OFFER);
    const firstOffer = offerHops.find((s) => !offerHops.some((o) => o.next === s.code));
    if (firstOffer) return firstOffer;
    return chain.find((s) => s.type === StageType.PANEL_SELECT) || null;
  }

  async proposeLeftover(user: AuthUser, fileId: string, index: number) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can send a leftover examiner for approval');
    }
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (stage.type !== StageType.CONSENT) {
      throw new BadRequestException('Leftover examiners can only be sent for approval at the examiner offer-letter stage');
    }
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner');
    if (member.vetStatus === VetStatus.APPROVED) throw new BadRequestException('This examiner is already approved');
    if (member.isChiefGuide) throw new BadRequestException('Chief Guide cannot be offered as an examiner');
    if (!String(member.email || '').trim()) throw new BadRequestException('Examiner email is missing');
    if (member.vetStatus === VetStatus.REJECTED || member.vetStatus === VetStatus.HELD) {
      throw new BadRequestException('Examiner is held or rejected');
    }
    if (member.consentStatus === ConsentStatus.ACCEPTED) throw new BadRequestException('Examiner already accepted');
    if (member.consentStatus === ConsentStatus.REGRETTED) throw new BadRequestException('Examiner already regretted');
    const hop = this.leftoverApprovalStart(blueprint, stage.code);
    if (!hop?.code) {
      throw new BadRequestException('This blueprint has no examiner approval route for leftover names');
    }
    const round = Number(file.evaluationRound || 1);
    member.assigned = true;
    member.consentStatus = ConsentStatus.PENDING;
    member.round = round;
    if (hop.type === StageType.PANEL_VET) member.vetStatus = VetStatus.PENDING;
    file.consentTargetCount = (file.panel || []).filter(
      (p) => p.assigned && p.consentStatus !== ConsentStatus.REGRETTED,
    ).length;
    file.markModified('panel');
    await this.workflow.restartFrom(
      file,
      blueprint,
      user,
      hop.code,
      stage.code,
      `Leftover examiner ${member.name} sent for approval`,
    );
    return {
      name: member.name,
      nextStage: hop.name || hop.code,
      message: `${member.name} sent for approval. File is now at ${hop.name || hop.code}. They will not be emailed until this routing is complete.`,
    };
  }

  private async ensureConsentTarget(file: ThesisFileDocument) {
    if (Number(file.consentTargetCount || 0) > 0) return;
    const n = (file.panel || []).filter(
      (p) => p.assigned && p.consentStatus !== ConsentStatus.REGRETTED,
    ).length;
    if (n > 0) {
      file.consentTargetCount = n;
      await this.files.updateOne({ _id: file._id }, { $set: { consentTargetCount: n } });
    }
  }

  private offerBlockedReason(
    p: { assigned?: boolean; round?: number; email?: string; vetStatus?: string; consentStatus?: string; isPractical?: boolean },
    round: number,
    needsVet = false,
    practical = false,
  ) {
    if (Boolean(p.isPractical) !== practical) return 'Not on this board';
    const email = String(p.email || '').trim().toLowerCase();
    if (!p.assigned) return 'Examiner is not assigned';
    if (!practical && Number(p.round || 1) !== round) return 'Examiner is not in this round';
    if (!email) return 'Examiner email is missing';
    if (p.vetStatus === VetStatus.REJECTED || p.vetStatus === VetStatus.HELD) return 'Examiner is held or rejected';
    if (needsVet && p.vetStatus !== VetStatus.APPROVED) return 'Examiner has not been approved yet';
    if (p.consentStatus === ConsentStatus.ACCEPTED) return 'Examiner already accepted';
    if (p.consentStatus === ConsentStatus.REGRETTED) return 'Examiner already regretted';
    return null;
  }

  /** Why Dealing cannot mail the offer letter to this examiner right now, or null when it can be sent. */
  offerSendBlockedReason(
    file: { currentStageCode?: string; evaluationRound?: number; panel?: any[] },
    blueprint: { stages?: { type?: string; code?: string }[] },
    index: number,
  ) {
    const stage = (blueprint.stages || []).find((s) => s.code === file.currentStageCode);
    if (!stage || stage.type !== StageType.CONSENT) return 'File is not at the examiner offer-letter stage';
    const member = file.panel?.[index];
    if (!member) return 'Invalid examiner';
    const practical = this.workflow.isPracticalStage(stage.code);
    const round = practical ? PRACTICAL_ROUND : Number(file.evaluationRound || 1);
    return this.offerBlockedReason(member, round, this.examinerNeedsVet(blueprint, stage), practical);
  }

  private async sendOfferAtIndex(user: AuthUser, fileId: string, index: number) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can send examiner offer letters');
    }
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (stage.type !== StageType.CONSENT) {
      throw new BadRequestException('Offers can only be sent at the examiner offer-letter stage');
    }
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner');
    const practical = this.workflow.isPracticalStage(stage.code);
    const round = practical ? PRACTICAL_ROUND : Number(file.evaluationRound || 1);
    const blocked = this.offerBlockedReason(member, round, this.examinerNeedsVet(blueprint, stage), practical);
    if (blocked) throw new BadRequestException(blocked);
    await this.ensureConsentTarget(file);
    await this.comms.seedDefaults(user);
    const email = String(member.email).trim().toLowerCase();
    const task = await this.createTask(user.instituteId as string, fileId, 'CONSENT', email, member.name, index);
    await this.files.updateOne({ _id: file._id }, { $set: { [`panel.${index}.offerSentAt`]: new Date() } });
    return { name: member.name, email, link: task.link };
  }

  async sendOffers(user: AuthUser, fileId: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    await this.ensureConsentTarget(file);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    const practical = this.workflow.isPracticalStage(stage.code);
    const round = practical ? PRACTICAL_ROUND : Number(file.evaluationRound || 1);
    const needsVet = this.examinerNeedsVet(blueprint, stage);
    const offers: { name: string; email: string; link: string }[] = [];
    for (let i = 0; i < file.panel.length; i++) {
      if (this.offerBlockedReason(file.panel[i], round, needsVet, practical)) continue;
      offers.push(await this.sendOfferAtIndex(user, fileId, i));
    }
    if (!offers.length) {
      throw new BadRequestException(
        'No assigned approved examiners left to offer. Tick and approve examiners first, and skip anyone who already accepted or regretted. Leftovers are not mailed until they are assigned and approved.',
      );
    }
    return {
      sent: offers.length,
      offers,
      message: `Offer letters sent to ${offers.length} selected examiner(s). Leftover names stay on Dealing's panel and are not mailed.`,
    };
  }

  async resendOffer(user: AuthUser, fileId: string, index: number) {
    const offer = await this.sendOfferAtIndex(user, fileId, index);
    return {
      sent: 1,
      offer,
      message: `Offer letter resent to ${offer.name} (${offer.email}).`,
    };
  }

  async requestAdditionalPanel(user: AuthUser, fileId: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    if (!file.chiefGuideEmail) throw new BadRequestException('Chief Guide email missing');
    file.needsAdditionalPanel = true;
    const build = blueprint.stages.find((s) => s.type === StageType.PANEL_BUILD);
    if (!build) throw new BadRequestException('Blueprint has no panel-build stage');
    const task = await this.createTask(
      user.instituteId as string,
      fileId,
      'PANEL_BUILD',
      file.chiefGuideEmail,
      file.chiefGuideName,
    );
    await this.workflow.jumpTo(file, blueprint, user, build.code, 'Additional panel requested from Chief Guide');
    return { ...task, fileId };
  }

  async sendEvalAtIndex(user: AuthUser, fileId: string, index: number, advance = false) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new ForbiddenException('Only Dealing can send thesis / evaluation letters');
    }
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (stage.type !== StageType.DISPATCH_THESIS && stage.type !== StageType.EVALUATE) {
      throw new BadRequestException('Thesis letters can only be sent at dispatch or evaluation');
    }
    const member = file.panel[index];
    if (!member) throw new BadRequestException('Invalid examiner');
    const round = Number(file.evaluationRound || 1);
    const blocked = this.evalBlockedReason(member, round);
    if (blocked) throw new BadRequestException(blocked);
    await this.comms.seedDefaults(user);
    const email = String(member.email).trim().toLowerCase();
    const task = await this.createTask(user.instituteId as string, fileId, 'EVALUATE', email, member.name, index);
    await this.files.updateOne({ _id: file._id }, { $set: { [`panel.${index}.thesisSentAt`]: new Date() } });
    if (advance && stage.type === StageType.DISPATCH_THESIS) {
      const fresh = await this.files.findById(file._id);
      if (fresh) await this.workflow.advance(fresh, blueprint, user, 'Thesis dispatched to examiners');
    }
    return { name: member.name, email, link: task.link };
  }

  private evalBlockedReason(
    p: {
      assigned?: boolean;
      round?: number;
      email?: string;
      consentStatus?: string;
      evaluation?: { verdict?: string };
      isPractical?: boolean;
    },
    round: number,
  ) {
    if (p.isPractical) return 'Practical examiner';
    const email = String(p.email || '').trim().toLowerCase();
    if (!p.assigned) return 'Examiner is not assigned';
    if (Number(p.round || 1) !== round) return 'Examiner is not in this round';
    if (!email) return 'Examiner email is missing';
    if (p.consentStatus !== ConsentStatus.ACCEPTED) return 'Examiner has not accepted the offer';
    if (p.evaluation?.verdict) return 'Evaluation already submitted';
    return null;
  }

  async sendEvalLinks(user: AuthUser, fileId: string) {
    const { file, blueprint } = await this.workflow.load(fileId, user.instituteId as string);
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    const round = Number(file.evaluationRound || 1);
    if (round === 2 && file.chiefGuideEmail) {
      await this.comms.seedDefaults(user);
      await this.createTask(user.instituteId as string, fileId, 'EVALUATE', file.chiefGuideEmail, file.chiefGuideName);
      if (stage.type === StageType.DISPATCH_THESIS) {
        return this.workflow.advance(file, blueprint, user, 'Thesis dispatched to Chief Guide');
      }
      return { sent: 1, message: 'Evaluation link sent to the Chief Guide.' };
    }
    const sent: { name: string; email: string }[] = [];
    for (let i = 0; i < file.panel.length; i++) {
      if (this.evalBlockedReason(file.panel[i], round)) continue;
      const row = await this.sendEvalAtIndex(user, fileId, i, false);
      sent.push({ name: row.name, email: row.email });
    }
    if (!sent.length) {
      const eligible = file.panel.filter(
        (p) =>
          p.assigned &&
          Number(p.round || 1) === round &&
          p.consentStatus === ConsentStatus.ACCEPTED &&
          !p.evaluation?.verdict &&
          String(p.email || '').trim(),
      );
      if (eligible.length && eligible.every((p) => p.thesisSentAt) && stage.type === StageType.DISPATCH_THESIS) {
        const fresh = await this.files.findById(file._id);
        if (fresh) await this.workflow.advance(fresh, blueprint, user, 'Thesis dispatched to examiners');
        return { sent: 0, message: 'Thesis / evaluation letters already sent. File moved to evaluation.' };
      }
      throw new BadRequestException(
        'No accepted examiners left to send the thesis letter. Skip anyone who already submitted an evaluation.',
      );
    }
    if (stage.type === StageType.DISPATCH_THESIS) {
      const fresh = await this.files.findById(file._id);
      if (fresh) await this.workflow.advance(fresh, blueprint, user, 'Thesis dispatched to examiners');
    }
    return {
      sent: sent.length,
      offers: sent,
      message: `Thesis / evaluation letters sent to ${sent.length} examiner(s).`,
    };
  }

  async resendEval(user: AuthUser, fileId: string, index: number) {
    const row = await this.sendEvalAtIndex(user, fileId, index, false);
    return {
      sent: 1,
      offer: row,
      message: `Thesis / evaluation letter resent to ${row.name} (${row.email}).`,
    };
  }
}
