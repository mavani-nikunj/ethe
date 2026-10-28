import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { TaskToken } from '../database/comms.schema';
import { ThesisFile } from '../database/thesis-file.schema';
import { Blueprint } from '../database/blueprint.schema';
import { Institute } from '../database/institute.schema';
import { Course, CourseType, Speciality } from '../database/masters.schema';
import { ConsentStatus, isValidEmail, isValidMobile, normalizeIndianMobile } from '@ethesis/shared';
import { EvaluationService } from '../evaluation/evaluation.service';
import { PanelService } from '../panel/panel.service';
import { WorkflowService } from '../files/workflow.service';
import { CommsService } from '../comms/comms.service';
import { SystemMail } from '../comms/catalog/system-defaults';

/** 400 with the usual body plus the form field it is about, so the page can show it under that field. */
function fieldError(field: string, message: string) {
  return new BadRequestException({ statusCode: 400, message, error: 'Bad Request', field });
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(TaskToken.name) private tokens: Model<TaskToken>,
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(CourseType.name) private courseTypes: Model<CourseType>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    private evaluation: EvaluationService,
    private panel: PanelService,
    private workflow: WorkflowService,
    private comms: CommsService,
  ) {}

  private isChiefGuideEval(row: { purpose?: string; email?: string }, file?: { chiefGuideEmail?: string } | null) {
    if (row.purpose !== 'EVALUATE' || !file) return false;
    const email = String(row.email || '').toLowerCase();
    const cg = String(file.chiefGuideEmail || '').toLowerCase();
    return Boolean(cg && email === cg);
  }

  private isExaminerTask(row: { purpose?: string; email?: string }, file?: { chiefGuideEmail?: string } | null) {
    if (row.purpose === 'CONSENT') return true;
    if (row.purpose === 'EVALUATE' && !this.isChiefGuideEval(row, file)) return true;
    return false;
  }

  private evalMember(row: { purpose?: string; email?: string; panelIndex?: number }, file?: { panel?: any[]; chiefGuideEmail?: string; evaluationRound?: number } | null) {
    if (!file?.panel) return undefined;
    if (this.isChiefGuideEval(row, file)) {
      const email = String(row.email || '').toLowerCase();
      return (
        file.panel.find((p: any) => p.isChiefGuide) ||
        file.panel.find((p: any) => String(p.email || '').toLowerCase() === email)
      );
    }
    if (row.panelIndex == null) return undefined;
    return file.panel[row.panelIndex];
  }

  private async instituteBrand(instituteId?: unknown) {
    if (!instituteId) return null;
    const inst = await this.institutes.findById(instituteId).select('name displayName logoUrl').lean();
    if (!inst) return null;
    return {
      name: inst.displayName || inst.name,
      logoUrl: inst.logoUrl ? `/api/uploads/${inst.logoUrl}` : undefined,
    };
  }

  async peek(token: string) {
    const row = await this.tokens.findOne({ token });
    if (!row) throw new NotFoundException('Invalid or expired link');
    const file = await this.files.findById(row.fileId).lean();
    const member = this.evalMember(row, file as any);
    const institute = await this.instituteBrand(file?.instituteId);
    const isExaminer = this.isExaminerTask(row, file as any);
    return {
      purpose: row.purpose,
      name: row.name,
      email: row.email,
      verified: isExaminer ? true : row.verified,
      isExaminer,
      passcodeRequested: isExaminer ? false : Boolean(row.otpRequestedAt),
      candidate: file?.candidate,
      title: file?.title,
      thesisNumber: file?.thesisNumber,
      fileNo: file?.fileNo,
      institute,
      consentStatus: row.purpose === 'CONSENT' ? member?.consentStatus : undefined,
      evaluationSubmitted: row.purpose === 'EVALUATE' && Boolean(member?.evaluation?.verdict),
      panelSubmitted:
        row.purpose === 'PANEL_BUILD' &&
        !['panel_build', 'additional_panel'].includes(String(file?.currentStageCode || '')),
    };
  }

  async sendOtp(token: string) {
    const row = await this.tokens.findOne({ token });
    if (!row) throw new NotFoundException('Invalid link');
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    row.otpHash = await bcrypt.hash(otp, 8);
    row.otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    row.otpRequestedAt = new Date();
    row.verified = false;
    await row.save();
    await this.comms.sendSystemMail(String(row.instituteId), SystemMail.PASSCODE, row.email, { name: row.name || '', email: row.email, otp }, row.name);
    return { ok: true, hint: `Passcode sent to ${row.email}`, passcodeRequested: true };
  }

  async verify(token: string, otp: string) {
    const row = await this.tokens.findOne({ token });
    if (!row) throw new UnauthorizedException('Invalid link');
    if (!row.otpHash || !row.otpRequestedAt) throw new UnauthorizedException('Request a passcode first');
    if (row.otpExpiresAt && row.otpExpiresAt < new Date()) throw new UnauthorizedException('Passcode expired');
    const ok = await bcrypt.compare(otp, row.otpHash);
    if (!ok) throw new UnauthorizedException('Invalid passcode');
    row.verified = true;
    await row.save();
    return this.detail(token);
  }

  async requireVerified(token: string) {
    const row = await this.tokens.findOne({ token });
    if (!row) throw new NotFoundException('Invalid link');
    const file = await this.files.findById(String(row.fileId));
    if (!file) throw new NotFoundException('File not found');
    const isExaminer = this.isExaminerTask(row, file as any);
    if (!isExaminer && !row.verified) {
      throw new UnauthorizedException('Verify passcode first');
    }
    const blueprint = await this.blueprints.findById(file.blueprintId);
    return { row, file, blueprint };
  }

  async assignedCandidates(instituteId: unknown, email: string, currentFileId?: string) {
    const iid = new Types.ObjectId(String(instituteId));
    const guideEmail = String(email || '').toLowerCase().trim();
    const rows = await this.files
      .find({ instituteId: iid, chiefGuideEmail: guideEmail })
      .select('candidate title thesisNumber fileNo status currentStageCode panel')
      .sort({ updatedAt: -1 })
      .lean();
    const tokens = await this.tokens
      .find({
        instituteId: iid,
        email: guideEmail,
        fileId: { $in: rows.map((f) => f._id) },
        purpose: { $in: ['PANEL_BUILD', 'VIVA_DATE', 'REVISION', 'EVALUATE'] },
      })
      .select('token fileId purpose createdAt')
      .sort({ createdAt: -1 })
      .lean();
    const latestByFile = new Map<string, { token: string; purpose: string }>();
    for (const t of tokens) {
      const id = String(t.fileId);
      if (!latestByFile.has(id)) latestByFile.set(id, { token: t.token, purpose: t.purpose });
    }
    const current = String(currentFileId || '');
    const workStages = ['panel_build', 'additional_panel', 'panel_request', 'viva_date', 'revision', 'cg_evaluate'];
    return rows.map((f: any) => {
      const link = latestByFile.get(String(f._id));
      const stage = String(f.currentStageCode || '');
      return {
        id: String(f._id),
        name: f.candidate?.name,
        enrollmentNo: f.candidate?.enrollmentNo,
        title: f.title,
        thesisNumber: f.thesisNumber,
        fileNo: f.fileNo,
        status: f.status,
        stage,
        panelCount: (f.panel || []).length,
        taskToken: link?.token || null,
        taskPurpose: link?.purpose || null,
        canWork: workStages.includes(stage),
        current: String(f._id) === current,
      };
    });
  }

  async listAssigned(token: string) {
    const { row, file } = await this.requireVerified(token);
    return this.assignedCandidates(row.instituteId, row.email, String(file._id));
  }

  async detail(token: string) {
    const { row, file, blueprint } = await this.requireVerified(token);
    const course = file.courseId ? await this.courses.findById(file.courseId).select('name courseTypeId').lean() : null;
    const typeId = file.courseTypeId || course?.courseTypeId;
    const [courseType, speciality, knownExaminers] = await Promise.all([
      typeId ? this.courseTypes.findById(typeId).select('name').lean() : null,
      file.specialityId ? this.specialities.findById(file.specialityId).select('name').lean() : null,
      row.purpose === 'PANEL_BUILD'
        ? this.panel.listKnownExaminers(String(row.instituteId), undefined, String(file._id))
        : Promise.resolve([]),
    ]);
    const asChiefGuide = this.isChiefGuideEval(row, file);
    const mine = this.evalMember(row, file);
    const idx = asChiefGuide ? -1 : row.panelIndex ?? 0;
    const stageType = row.purpose === 'PANEL_BUILD' ? this.stageTypeOf(blueprint, file.currentStageCode) : undefined;
    const panel = (file.panel || []).map((p, i) => {
      const copy: Record<string, unknown> = { ...(typeof (p as any).toObject === 'function' ? (p as any).toObject() : p) };
      if (i !== idx) delete copy.evaluationHistory;
      if (row.purpose === 'PANEL_BUILD') copy.lockReason = this.panel.panelLockReason(p, stageType);
      return copy;
    });
    return {
      purpose: row.purpose,
      name: row.name,
      email: row.email,
      panelIndex: asChiefGuide ? undefined : row.panelIndex,
      asChiefGuide,
      evaluationHistory: mine?.evaluationHistory || [],
      file: {
        id: file._id,
        title: file.title,
        thesisNumber: file.thesisNumber,
        fileNo: file.fileNo,
        candidate: file.candidate,
        documents: file.documents,
        panel,
        currentStageCode: file.currentStageCode,
        chiefGuideName: file.chiefGuideName,
        status: file.status,
        courseName: course?.name,
        courseTypeName: courseType?.name,
        specialityName: speciality?.name,
      },
      panelRule: blueprint?.panelRule,
      checklist: this.evaluation.checklist(),
      hideEvaluationReject: blueprint?.code === 'PHD_MEDICAL',
      knownExaminers,
      institute: await this.instituteBrand(file.instituteId),
    };
  }

  private stageTypeOf(blueprint: any, code?: string) {
    try {
      return blueprint ? this.workflow.stage(blueprint, String(code || '')).type : undefined;
    } catch {
      return undefined;
    }
  }

  /** The Chief Guide acting through their panel link. */
  private guideUser(row: { email?: string; name?: string; instituteId?: unknown }) {
    return {
      userId: 'task',
      email: row.email as string,
      name: row.name || 'Chief Guide',
      role: 'GUIDE',
      instituteId: String(row.instituteId),
    };
  }

  async addPanelMember(token: string, body: any) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'PANEL_BUILD') throw new BadRequestException('Wrong task');
    return this.panel.addMember(this.guideUser(row), String(file._id), body).then(() => this.detail(token));
  }

  async updatePanelMember(token: string, email: string, body: any) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'PANEL_BUILD') throw new BadRequestException('Wrong task');
    await this.panel.guideUpdateMember(this.guideUser(row), String(file._id), email, body || {});
    return this.detail(token);
  }

  async removePanelMember(token: string, email: string) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'PANEL_BUILD') throw new BadRequestException('Wrong task');
    await this.panel.guideRemoveMember(this.guideUser(row), String(file._id), email);
    return this.detail(token);
  }

  async listExaminers(token: string, q?: string) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'PANEL_BUILD') throw new BadRequestException('Wrong task');
    return this.panel.listKnownExaminers(String(row.instituteId), q, String(file._id));
  }

  async submitPanel(token: string) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'PANEL_BUILD') throw new BadRequestException('Wrong task');
    await this.panel.submitPanel(this.guideUser(row), String(file._id));
    return this.detail(token);
  }

  async consent(token: string, body: any, chequePath?: string) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'CONSENT') throw new BadRequestException('Wrong task');
    const idx = row.panelIndex ?? 0;
    const member = file.panel[idx];
    if (!member) throw new BadRequestException('Examiner not found');
    if (member.consentStatus === ConsentStatus.ACCEPTED || member.consentStatus === ConsentStatus.REGRETTED) {
      return { ok: true, consentStatus: member.consentStatus, alreadySubmitted: true };
    }
    const accept = body.accept === true || body.accept === 'true';
    if (accept) {
      const required: [string, string][] = [
        ['name', 'Name'],
        ['designation', 'Designation'],
        ['department', 'Department'],
        ['institute', 'Institute'],
        ['address', 'Address'],
        ['mobile', 'Mobile'],
        ['email', 'Email'],
        ['holderName', 'Name of examiner (as in bank)'],
        ['bankName', 'Bank name'],
        ['branchAddress', 'Branch name with bank address'],
        ['ifsc', 'IFSC code'],
        ['accountType', 'Account type'],
        ['account', 'Account number'],
        ['pan', 'PAN number'],
      ];
      for (const [key, label] of required) {
        if (!String(body[key] || '').trim()) throw fieldError(key, `${label} is required`);
      }
      const email = String(body.email).trim().toLowerCase();
      if (!isValidEmail(email)) {
        throw fieldError('email', 'Email is not a valid email address');
      }
      let altEmail = '';
      if (body.alternateEmail && String(body.alternateEmail).trim() !== '') {
        altEmail = String(body.alternateEmail).trim().toLowerCase();
        if (!isValidEmail(altEmail)) {
          throw fieldError('alternateEmail', 'Alternate email is not a valid email address');
        }
      }
      const mob = normalizeIndianMobile(body.mobile);
      if (!isValidMobile(mob)) {
        throw fieldError('mobile', 'Mobile must be a valid 10-digit Indian number starting with 6-9');
      }
      let altMob = '';
      if (body.alternateMobile && String(body.alternateMobile).trim() !== '') {
        altMob = normalizeIndianMobile(body.alternateMobile);
        if (!isValidMobile(altMob)) {
          throw fieldError('alternateMobile', 'Alternate mobile must be a valid 10-digit Indian number starting with 6-9');
        }
      }
      const pan = String(body.pan).replace(/\s+/g, '').toUpperCase();
      if (pan.length !== 10) throw fieldError('pan', 'PAN must be 10 characters');
      if (!chequePath && !member.bank?.cancelledChequePath) {
        throw fieldError('cheque', 'Upload cancelled cheque (JPG, PNG or PDF)');
      }
      member.name = String(body.name).trim();
      member.designation = String(body.designation).trim();
      member.department = String(body.department).trim();
      member.affiliation = String(body.institute).trim();
      member.address = String(body.address).trim();
      member.mobile = mob;
      member.alternateMobile = altMob;
      member.email = email;
      member.alternateEmail = altEmail;
      member.consentStatus = ConsentStatus.ACCEPTED;
      member.consentRemark = undefined;
      member.bank = {
        holderName: String(body.holderName).trim(),
        bankName: String(body.bankName).trim(),
        branchAddress: String(body.branchAddress).trim(),
        ifsc: String(body.ifsc).replace(/\s+/g, '').toUpperCase(),
        accountType: String(body.accountType).trim(),
        account: String(body.account).trim(),
        pan,
        cancelledChequePath: chequePath || member.bank?.cancelledChequePath,
      };
      file.markModified('panel');
      await file.save();
      return { ok: true, consentStatus: member.consentStatus };
    }
    const refusalReason = String(body.refusalReason || '').trim();
    if (refusalReason !== 'PRIOR_COMMITMENTS' && refusalReason !== 'OTHER') {
      throw new BadRequestException('Select a reason for refusal');
    }
    if (refusalReason === 'OTHER' && !String(body.refusalText || '').trim()) {
      throw new BadRequestException('Enter the reason for refusal');
    }
    member.consentStatus = ConsentStatus.REGRETTED;
    member.assigned = false;
    member.consentRemark =
      refusalReason === 'OTHER'
        ? String(body.refusalText).trim()
        : 'Prior commitments during the same period';
    file.markModified('panel');
    await file.save();
    const replacement = await this.panel.replaceFromBucket(
      String(file._id),
      String(row.instituteId),
      member.bucketCode,
      Number(member.round || file.evaluationRound || 1),
    );
    return { ok: true, consentStatus: member.consentStatus, ...replacement };
  }

  async evaluate(token: string, body: any) {
    const { row, file } = await this.requireVerified(token);
    if (row.purpose !== 'EVALUATE') throw new BadRequestException('Wrong task');
    const asChiefGuide = this.isChiefGuideEval(row, file);
    const fakeUser = {
      userId: 'task',
      email: row.email,
      name: row.name || (asChiefGuide ? 'Chief Guide' : 'Examiner'),
      role: asChiefGuide ? 'GUIDE' : 'EXAMINER',
      instituteId: String(row.instituteId),
    };
    const saved = await this.evaluation.submit(
      fakeUser,
      String(file._id),
      { ...body, asChiefGuide: asChiefGuide || body.asChiefGuide },
      asChiefGuide ? undefined : row.panelIndex,
    );
    const candidate = file.candidate?.name || 'the candidate';
    const form = this.evaluation.formatSubmittedForm(body, {
      candidateName: file.candidate?.name,
      title: file.title,
      thesisNumber: file.thesisNumber,
      fileNo: file.fileNo,
      examinerName: row.name,
      examinerEmail: row.email,
    });
    const iid = String(file.instituteId);
    const vars = {
      candidateName: candidate,
      thesisTitle: file.title || '',
      thesisNumber: file.thesisNumber || '',
      fileNo: file.fileNo || '',
      examinerName: row.name || 'Examiner',
      examinerEmail: row.email,
      form,
    };
    try {
      await this.comms.sendSystemMail(iid, SystemMail.EVALUATION_RECEIVED, row.email, vars, row.name, file._id as Types.ObjectId);
    } catch {
      /* report is already saved */
    }
    try {
      const inst = await this.institutes.findById(file.instituteId).select('supportEmail displayName').lean();
      const office = String(inst?.supportEmail || '').trim().toLowerCase();
      if (office && office !== String(row.email || '').toLowerCase()) {
        await this.comms.sendSystemMail(iid, SystemMail.EVALUATION_RECEIVED_OFFICE, office, vars, undefined, file._id as Types.ObjectId);
      }
    } catch {
      /* examiner copy may already have been sent */
    }
    return saved;
  }

  async setVivaDate(token: string, body: { vivaDate?: string; vivaTime?: string; vivaVenue?: string }) {
    const { row, file, blueprint } = await this.requireVerified(token);
    if (row.purpose !== 'VIVA_DATE') throw new BadRequestException('Wrong task');
    const vivaDate = String(body?.vivaDate || '').trim();
    if (!vivaDate) throw new BadRequestException('Viva / practical date is required');
    const fakeUser = {
      userId: 'task',
      email: row.email,
      name: row.name || 'Chief Guide',
      role: 'GUIDE',
      instituteId: String(row.instituteId),
    };
    file.vivaDate = vivaDate;
    if (body.vivaTime) file.vivaTime = String(body.vivaTime);
    if (body.vivaVenue) file.vivaVenue = String(body.vivaVenue);
    await this.workflow.advance(
      file,
      blueprint as any,
      fakeUser,
      `Date ${vivaDate}${body.vivaTime ? ` ${body.vivaTime}` : ''}${body.vivaVenue ? ` at ${body.vivaVenue}` : ''}`,
    );
    row.verified = false;
    await row.save();
    return { ok: true, vivaDate, vivaTime: file.vivaTime, vivaVenue: file.vivaVenue };
  }

  async uploadRevision(token: string, path: string, originalName: string) {
    const { row } = await this.requireVerified(token);
    if (row.purpose !== 'REVISION') throw new BadRequestException('Wrong task');
    const fakeUser = {
      userId: 'task',
      email: row.email,
      name: row.name || 'Chief Guide',
      role: 'GUIDE',
      instituteId: String(row.instituteId),
    };
    const file = await this.evaluation.applyRevision(fakeUser, String(row.fileId), path, originalName);
    row.verified = false;
    await row.save();
    return file;
  }
}
