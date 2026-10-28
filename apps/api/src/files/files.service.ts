import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ThesisFile, ThesisFileDocument } from '../database/thesis-file.schema';
import { Blueprint } from '../database/blueprint.schema';
import { Course, Department, Faculty, AcademicSession, Speciality, CourseType } from '../database/masters.schema';
import { ConsentStatus, FileStatus, LetterKind, MetroStatus, StageType, UserRole, INBOX_LANE_LABELS, PracticalRole, Verdict, VetStatus } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { inMappedCourse, mappedCourseFilter } from '../common/course-scope';
import { authoritySlotsMatch } from '../common/authority-slot';
import { WorkflowService } from './workflow.service';
import { TaskToken } from '../database/comms.schema';
import { CommsService } from '../comms/comms.service';
import { FileNumbersService, cleanFileNumber } from '../file-numbers/file-numbers.service';
import { AuditLog } from '../database/audit-log.schema';
import { randomBytes } from 'crypto';
import { taskUrl } from '../common/web-origin';
import { REMINDER_FILTERS, isReminderFilter, matchesReminder, stageClause } from './reminder-filters';

@Injectable()
export class FilesService implements OnModuleInit {
  constructor(
    @InjectModel(ThesisFile.name) private files: Model<ThesisFileDocument>,
    @InjectModel(Blueprint.name) private blueprints: Model<Blueprint>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(CourseType.name) private courseTypes: Model<CourseType>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(Faculty.name) private faculty: Model<Faculty>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(TaskToken.name) private tokens: Model<TaskToken>,
    @InjectModel(AuditLog.name) private audit: Model<AuditLog>,
    private workflow: WorkflowService,
    private comms: CommsService,
    private fileNumbers: FileNumbersService,
  ) {}

  async onModuleInit() {
    const coll = this.files.collection;
    try {
      const indexes = await coll.indexes();
      const old = indexes.find((i: any) => i.name === 'instituteId_1_thesisNumber_1');
      if (old && !old.partialFilterExpression) {
        await coll.dropIndex('instituteId_1_thesisNumber_1');
      }
    } catch {
      /* index may already be gone */
    }
    await this.files.syncIndexes();
  }

  iid(user: AuthUser) {
    if (!user.instituteId) throw new BadRequestException('No institute');
    return new Types.ObjectId(user.instituteId);
  }

  private asObjectIds(raw: unknown): Types.ObjectId[] {
    return (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((id) => String(id || '').trim())
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }

  private idsForIn(raw: unknown[]): Types.ObjectId[] {
    return [
      ...new Set(
        raw
          .map((id) => String(id || '').trim())
          .filter((id) => /^[a-f0-9]{24}$/i.test(id)),
      ),
    ].map((id) => new Types.ObjectId(id));
  }

  private reportBucket(kind?: string): 'added' | 'submitted' {
    const k = String(kind || '')
      .toLowerCase()
      .replace(/[_-]/g, '');
    if (k.includes('notsubmitted') || k === 'added') return 'added';
    if (k.includes('submitted')) return 'submitted';
    return 'added';
  }

  fileScope(user: AuthUser): Record<string, unknown> {
    const filter: Record<string, unknown> = { instituteId: this.iid(user) };
    const courseScope = mappedCourseFilter(user);
    if (courseScope) Object.assign(filter, courseScope);
    return filter;
  }

  private assertMappedCourse(user: AuthUser, courseId: unknown, message = 'You can only work with your mapped courses') {
    if (!inMappedCourse(user, courseId)) throw new BadRequestException(message);
  }

  private async sessionIdClause(user: AuthUser, month?: string, year?: string, session?: string) {
    if (String(session || '').toLowerCase() === 'all') return null;
    const iid = this.iid(user);
    const monthName = String(month || '').trim();
    const yearNum = Number(year);
    const hasYear = Number.isFinite(yearNum) && yearNum > 1900;
    if (monthName || hasYear) {
      const sessionFilter: Record<string, unknown> = { instituteId: iid };
      if (monthName) sessionFilter.month = monthName;
      if (hasYear) sessionFilter.year = yearNum;
      const sessionRows = await this.sessions.find(sessionFilter).select('_id').lean();
      const ids: any[] = sessionRows.map((s) => s._id);
      return { sessionId: { $in: [...ids, ...ids.map((id) => String(id))] } };
    }
    const current = await this.sessions.find({ instituteId: iid, current: true }).select('_id').lean();
    const ids: any[] = current.map((s) => s._id);
    return { sessionId: { $in: [...ids, ...ids.map((id) => String(id))] } };
  }

  async withSessionFilter(
    user: AuthUser,
    filter: Record<string, unknown>,
    month?: string,
    year?: string,
    session?: string,
  ) {
    const clause = await this.sessionIdClause(user, month, year, session);
    if (clause) Object.assign(filter, clause);
    return filter;
  }

  private candidateFrom(body: any) {
    const enrollmentNo = String(body.enrollmentNo || '').trim();
    const name = String(body.candidateName || body.name || '').trim();
    const dob = String(body.dob || '').trim();
    const mobile = String(body.mobile || '').replace(/\D/g, '');
    const email = String(body.candidateEmail || body.email || '').trim().toLowerCase();
    const errors: string[] = [];
    if (!enrollmentNo) errors.push('Enrollment No. is required');
    if (!name || name.length < 3) errors.push('Name of Candidate must be at least 3 characters');
    else if (!/^[A-Za-z][A-Za-z .'-]{1,}$/.test(name)) errors.push('Name of Candidate may contain letters, spaces, apostrophes and hyphens only');
    if (!dob) errors.push('DOB of Candidate is required');
    else {
      const d = new Date(dob);
      if (Number.isNaN(d.getTime())) errors.push('DOB of Candidate is invalid');
      else {
        const min = new Date('1920-01-01');
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (d < min) errors.push('DOB of Candidate cannot be before 1920');
        if (d > today) errors.push('DOB of Candidate cannot be in the future');
        const age = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (age < 16) errors.push('Candidate must be at least 16 years old');
      }
    }
    if (!mobile) errors.push('Mobile No. of Candidate is required');
    else if (!/^[6-9]\d{9}$/.test(mobile)) errors.push('Mobile No. must be a 10-digit Indian number');
    if (!email) errors.push('Email Id of Candidate is required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email Id of Candidate is invalid');
    if (errors.length) throw new BadRequestException(errors.join('. '));
    return { enrollmentNo, name, dob: dob.slice(0, 10), mobile, email };
  }

  private async assertUniqueEnrollment(iid: Types.ObjectId, enrollmentNo: string, exceptId?: string) {
    const filter: Record<string, unknown> = { instituteId: iid, 'candidate.enrollmentNo': enrollmentNo };
    if (exceptId) filter._id = { $ne: new Types.ObjectId(exceptId) };
    const exists = await this.files.findOne(filter).select('_id').lean();
    if (exists) throw new BadRequestException('A thesis with this enrollment no. already exists in this institute');
  }

  private async resolveSession(user: AuthUser, body: any) {
    const iid = this.iid(user);
    if (body.sessionId) {
      const row = await this.sessions.findOne({ _id: body.sessionId, instituteId: iid });
      if (!row) throw new BadRequestException('Session is required');
      return row;
    }
    const month = String(body.sessionMonth || body.month || '').trim();
    const year = Number(body.sessionYear || body.year);
    if (!month || !year) throw new BadRequestException('Session month and year are required');
    const row = await this.sessions.findOne({ instituteId: iid, month, year });
    if (!row) throw new BadRequestException('Session not found. Add the session first.');
    return row;
  }

  private sendBlockers(file: { title?: string; documents?: { kind?: string }[]; chiefGuideId?: unknown; chiefGuideName?: string; coGuideIds?: unknown[] }, minCo = 0) {
    const blockers: string[] = [];
    if (!String(file.title || '').trim()) blockers.push('Thesis title is required');
    const hasPdf = (file.documents || []).some((d) => d.kind === 'THESIS');
    if (!hasPdf) blockers.push('Thesis PDF is required');
    if (!file.chiefGuideId && !file.chiefGuideName) blockers.push('Chief Guide is required');
    const coCount = (file.coGuideIds || []).filter(Boolean).length;
    if (minCo > 0 && coCount < minCo) blockers.push('Co-Guide is required for this course type');
    return blockers;
  }

  async create(user: AuthUser, body: any, filePath?: string, originalName?: string) {
    if (user.role !== UserRole.COURSE) {
      throw new BadRequestException('Only the course login can add a thesis');
    }
    const iid = this.iid(user);
    const candidate = this.candidateFrom(body);
    await this.assertUniqueEnrollment(iid, candidate.enrollmentNo);
    const session = await this.resolveSession(user, body);
    const course = await this.courses.findOne({ _id: body.courseId, instituteId: iid });
    if (!course) throw new NotFoundException('Course not found');
    this.assertMappedCourse(user, course._id, 'You can only add thesis for your mapped course');
    if (!course.courseTypeId) throw new BadRequestException('Course has no course type');
    const courseType = await this.courseTypes.findOne({ _id: course.courseTypeId, instituteId: iid });
    if (!courseType) throw new NotFoundException('Course type not found');
    if (!courseType.blueprintId) throw new BadRequestException('Course type has no workflow blueprint');
    const blueprint = await this.blueprints.findById(courseType.blueprintId);
    if (!blueprint) throw new NotFoundException('Blueprint not found');
    if (!body.specialityId) throw new BadRequestException('Name of Speciality is required');
    const speciality = await this.specialities.findOne({ _id: body.specialityId, instituteId: iid });
    if (!speciality) throw new BadRequestException('Speciality not found');
    if (speciality.courseId && String(speciality.courseId) !== String(course._id)) {
      throw new BadRequestException('Speciality does not belong to the selected course');
    }
    const departmentId = body.departmentId || course.departmentId;
    if (!departmentId) throw new BadRequestException('Name of Department is required');
    const dept = await this.departments.findOne({ _id: departmentId, instituteId: iid });
    if (!dept) throw new NotFoundException('Department not found');

    let chiefGuideEmail = body.chiefGuideEmail;
    let chiefGuideName = body.chiefGuideName;
    if (body.chiefGuideId) {
      const g = await this.faculty.findOne({ _id: body.chiefGuideId, instituteId: iid });
      if (!g) throw new BadRequestException('Chief Guide not found in this institute');
      chiefGuideEmail = g.email;
      chiefGuideName = g.name;
    }
    const maxCo = blueprint.guidePolicy?.maxCoGuides ?? 0;
    const coGuideIds = this.normalizeCoGuides(body.coGuideIds, body.chiefGuideId, maxCo);
    await this.assertFacultyInInstitute(coGuideIds, iid);

    const start = blueprint.stages[0];
    const metro = blueprint.stages.map((s) => ({
      stageCode: s.code,
      stageName: s.name,
      status: MetroStatus.UPCOMING,
    }));

    let created: ThesisFileDocument;
    try {
      created = await this.files.create({
        instituteId: iid,
        courseId: course._id,
        courseTypeId: courseType._id,
        departmentId: dept._id,
        sessionId: session._id,
        specialityId: speciality._id,
        blueprintId: blueprint._id,
        candidate,
        title: String(body.title || '').trim(),
        fileNo: body.fileNo || undefined,
        chiefGuideId: body.chiefGuideId || undefined,
        chiefGuideName,
        chiefGuideEmail,
        coGuideIds,
        currentStageCode: start.code,
        status: FileStatus.DRAFT,
        metro,
        documents: filePath
          ? [
              {
                kind: 'THESIS',
                version: 1,
                path: filePath,
                originalName: originalName || 'thesis.pdf',
                uploadedAt: new Date(),
                uploadedBy: user.name,
              },
            ]
          : [],
        remarks: body.remarks,
        createdBy: new Types.ObjectId(user.userId),
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new BadRequestException(
          err?.keyPattern?.thesisNumber
            ? 'A file with this thesis number already exists in this institute'
            : 'A thesis with this enrollment no. already exists in this institute',
        );
      }
      throw err;
    }
    return created;
  }

  async sendToExam(user: AuthUser, id: string) {
    if (user.role !== UserRole.COURSE) throw new BadRequestException('Only the course login can send a thesis');
    const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
    this.assertMappedCourse(user, file.courseId, 'You can only send thesis for your mapped course');
    if (file.status !== FileStatus.DRAFT) throw new BadRequestException('This thesis has already been sent to the Examination Section');
    const minCo = blueprint.guidePolicy?.minCoGuides ?? 0;
    const blockers = this.sendBlockers(file, minCo);
    if (blockers.length) throw new BadRequestException(blockers.join('. '));
    const start = blueprint.stages[0];
    file.status = FileStatus.IN_PROGRESS;
    file.currentStageCode = start.code;
    file.metro = blueprint.stages.map((s, i) => ({
      stageCode: s.code,
      stageName: s.name,
      status: i === 0 ? MetroStatus.CURRENT : MetroStatus.UPCOMING,
    }));
    file.lastActionRemark = 'Submitted by course login';
    await file.save();
    if (start.type === StageType.INITIATE && start.next) {
      return this.afterMove(await this.workflow.advance(file, blueprint, user, 'Submitted by course login'), blueprint);
    }
    return file;
  }

  async sendMany(user: AuthUser, ids: string[]) {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) throw new BadRequestException('Select at least one thesis');
    const sent: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of list) {
      try {
        await this.sendToExam(user, id);
        sent.push(id);
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not send' });
      }
    }
    return { sent, failed };
  }

  /**
   * Rows this user may approve in one go: a plain APPROVE stage (e.g. ACE review) or an AO / ACE / Dean
   * letter-routing hop (offer, thesis, reminder, revision, viva… letters) owned by the user's role and
   * authority slot, on an in-progress file. Stages needing per-item decisions (e.g. panel vetting) are excluded.
   */
  canBulkApprove(user: AuthUser, file: { status?: string; currentStageCode?: string }, blueprint?: Blueprint | null) {
    if (user.role !== UserRole.AUTHORITY || file.status !== FileStatus.IN_PROGRESS || !blueprint) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    if (!stage || stage.actorRole !== UserRole.AUTHORITY) return false;
    if (stage.type !== StageType.APPROVE && stage.type !== StageType.CONSENT_ROUTE) return false;
    return authoritySlotsMatch(stage.authoritySlot, user.authoritySlot);
  }

  /** Rows Dealing may mail to the Chief Guide in one go: in-progress files at the Request panel step with a CG email. */
  canBulkRequestPanel(
    user: AuthUser,
    file: { status?: string; currentStageCode?: string; chiefGuideEmail?: string },
    blueprint?: Blueprint | null,
  ) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) return false;
    if (file.status !== FileStatus.IN_PROGRESS || !blueprint || !String(file.chiefGuideEmail || '').trim()) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    return stage?.type === StageType.PANEL_REQUEST;
  }

  /**
   * Dealing: files already with the Chief Guide to build the panel (panel_build / additional_panel).
   * These can be mailed again in bulk — a resend if the CG was already mailed, a first send otherwise.
   */
  canBulkResendPanel(
    user: AuthUser,
    file: { status?: string; currentStageCode?: string; chiefGuideEmail?: string },
    blueprint?: Blueprint | null,
  ) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) return false;
    if (file.status !== FileStatus.IN_PROGRESS || !blueprint || !String(file.chiefGuideEmail || '').trim()) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    return stage?.type === StageType.PANEL_BUILD || stage?.type === StageType.ADDITIONAL_PANEL;
  }

  private dealingHere(user: AuthUser) {
    return [UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any);
  }

  /** Dealing: in-progress files at Examiner evaluation that can still take a reminder (< 3 sent). */
  canBulkReminder(user: AuthUser, file: { status?: string; currentStageCode?: string; reminderLevel?: number }, blueprint?: Blueprint | null) {
    if (!this.dealingHere(user) || file.status !== FileStatus.IN_PROGRESS || !blueprint) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    if (!stage || stage.type !== StageType.EVALUATE || stage.actorRole === UserRole.GUIDE) return false;
    if ((file.reminderLevel || 0) >= 3) return false;
    return blueprint.stages.some((s) => s.letterKind === LetterKind.REMINDER);
  }

  /** Dealing: in-progress files at a dispatch / send-letter step (thesis dispatch, revision letter, revised dispatch). */
  canBulkDispatch(user: AuthUser, file: { status?: string; currentStageCode?: string }, blueprint?: Blueprint | null) {
    if (!this.dealingHere(user) || file.status !== FileStatus.IN_PROGRESS || !blueprint) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    return stage?.type === StageType.DISPATCH_THESIS;
  }

  /** Assoc Dean / ACE: in-progress files at a panel-vet step for their slot. Per-examiner guards still run per file. */
  canBulkVetApprove(user: AuthUser, file: { status?: string; currentStageCode?: string }, blueprint?: Blueprint | null) {
    if (user.role !== UserRole.AUTHORITY || file.status !== FileStatus.IN_PROGRESS || !blueprint) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    if (!stage || stage.type !== StageType.PANEL_VET) return false;
    return authoritySlotsMatch(stage.authoritySlot, user.authoritySlot);
  }

  /** Dealing: in-progress files sitting at the Close step. */
  canBulkClose(user: AuthUser, file: { status?: string; currentStageCode?: string }, blueprint?: Blueprint | null) {
    if (!this.dealingHere(user) || file.status !== FileStatus.IN_PROGRESS || !blueprint) return false;
    const stage = blueprint.stages.find((s) => s.code === file.currentStageCode);
    return stage?.type === StageType.CLOSE;
  }

  /**
   * Run one safe, body-less action over several files, reusing the single-file `act` path (its stage/role/
   * per-item guards run per file). Files that don't qualify land in `failed` with the reason.
   */
  async bulkAct(user: AuthUser, ids: string[], kind: 'REMINDER' | 'DISPATCH' | 'VET_APPROVE' | 'CLOSE') {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!list.length) throw new BadRequestException('Select at least one thesis');
    if (list.length > 100) throw new BadRequestException('Do at most 100 files at a time');
    const done: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of list) {
      try {
        const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
        const stage = this.workflow.stage(blueprint, file.currentStageCode);
        let action: string;
        if (kind === 'REMINDER') action = 'SEND_REMINDER';
        else if (kind === 'VET_APPROVE') action = 'APPROVE';
        else if (kind === 'CLOSE') action = 'CLOSE';
        else action = stage.letterKind && stage.letterKind !== LetterKind.THESIS ? 'SEND_LETTER' : 'DISPATCH';
        const available = this.availableActions(user, file, blueprint, stage);
        if (!available.includes(action)) {
          throw new BadRequestException('This file is not at that step');
        }
        if (kind === 'VET_APPROVE') await this.approveUndecidedExaminers(file, stage.code);
        await this.act(user, id, action, { remark: `${kind} (bulk)` });
        done.push(id);
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not complete' });
      }
    }
    return { done, failed };
  }

  /**
   * Bulk vet-approve: the Dean ticking a file means "approve its panel", so assigned examiners still
   * undecided at this vet step become APPROVED. Held / rejected examiners are left as they are.
   */
  private async approveUndecidedExaminers(file: ThesisFileDocument, stageCode: string) {
    const practical = this.workflow.isPracticalStage(stageCode);
    let changed = false;
    for (const p of file.panel || []) {
      if (practical ? !p.isPractical : p.isPractical) continue;
      if (p.assigned && (!p.vetStatus || p.vetStatus === VetStatus.PENDING)) {
        p.vetStatus = VetStatus.APPROVED;
        changed = true;
      }
    }
    if (!changed) return;
    file.markModified('panel');
    await file.save();
  }

  /** Approve several files at the current APPROVE stage; each goes through the same checks as a single Approve. */
  async bulkApprove(user: AuthUser, ids: string[], remark?: string) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!list.length) throw new BadRequestException('Select at least one thesis');
    if (list.length > 300) throw new BadRequestException('Approve at most 300 files at a time');
    const approved: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of list) {
      try {
        const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
        if (!this.canBulkApprove(user, file, blueprint)) {
          throw new BadRequestException('This file is not waiting for your approval');
        }
        await this.act(user, id, 'APPROVE', { remark: remark || 'APPROVE (bulk)' });
        approved.push(id);
      } catch (err: any) {
        failed.push({ id, message: err?.message || 'Could not approve' });
      }
    }
    return { approved, failed };
  }

  async assignThesisNumbers(user: AuthUser, items: { id?: string; thesisNumber?: string }[]) {
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new BadRequestException('Only Dealing can assign thesis numbers');
    }
    const list = (items || []).map((row) => ({
      id: String(row?.id || '').trim(),
      thesisNumber: String(row?.thesisNumber || '').trim(),
    }));
    if (!list.length) throw new BadRequestException('Select at least one thesis');

    const saved: string[] = [];
    const failed: { id: string; message: string }[] = [];
    const seen = new Map<string, string>();
    const queued: { id: string; thesisNumber: string }[] = [];
    for (const row of list) {
      if (!row.id) {
        failed.push({ id: '', message: 'Thesis is required' });
        continue;
      }
      if (!row.thesisNumber) {
        failed.push({ id: row.id, message: 'Thesis number is required' });
        continue;
      }
      const key = row.thesisNumber.toLowerCase();
      const first = seen.get(key);
      if (first) {
        failed.push({ id: row.id, message: 'Thesis number already used in this batch' });
        continue;
      }
      seen.set(key, row.id);
      queued.push(row);
    }

    for (const row of queued) {
      try {
        await this.assignThesisNumberOne(user, row.id, row.thesisNumber);
        saved.push(row.id);
      } catch (err: any) {
        failed.push({ id: row.id, message: err?.message || 'Could not save thesis number' });
      }
    }
    return { saved, failed };
  }

  private async assignThesisNumberOne(user: AuthUser, id: string, thesisNumber: string) {
    const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
    if (file.status === FileStatus.DRAFT) {
      throw new BadRequestException('Not ready to number');
    }
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (stage.type !== StageType.ASSIGN_NUMBER) {
      throw new BadRequestException('Not ready to number');
    }
    this.workflow.actorOk(user, stage, file);
    const fileNo = await this.resolveExamFileNo(file);
    return this.applyAssignedNumbers(file, blueprint, user, fileNo, thesisNumber);
  }

  private async assertThesisNumberFree(file: ThesisFileDocument, thesisNumber: string) {
    const clash = await this.files.findOne({
      instituteId: file.instituteId,
      thesisNumber,
      _id: { $ne: file._id },
    });
    if (clash) throw new BadRequestException('Thesis number already used');
  }

  private async resolveExamFileNo(file: ThesisFileDocument) {
    const existing = String(file.fileNo || '').trim();
    if (existing) return existing;
    const session = file.sessionId ? await this.sessions.findById(file.sessionId).lean() : null;
    const prefix = session
      ? await this.fileNumbers.findForSession(file.instituteId, session.month, session.year)
      : null;
    if (!prefix) {
      const label = session ? `${session.month} ${session.year}` : 'this session';
      throw new BadRequestException(`Register a file number prefix for ${label} on Generate File No. first`);
    }
    return prefix;
  }

  private async applyAssignedNumbers(
    file: ThesisFileDocument,
    blueprint: Blueprint,
    user: AuthUser,
    fileNo: string,
    thesisNumber: string,
  ) {
    if (!fileNo) throw new BadRequestException('Exam file no. is required');
    if (!thesisNumber) throw new BadRequestException('Thesis number is required');
    await this.assertThesisNumberFree(file, thesisNumber);
    file.fileNo = fileNo;
    file.thesisNumber = thesisNumber;
    try {
      return this.afterMove(
        await this.workflow.advance(file, blueprint, user, `File ${fileNo} / Thesis ${thesisNumber}`),
        blueprint,
      );
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException('Thesis number already used');
      throw err;
    }
  }

  async saveChiefGuide(user: AuthUser, id: string, body: any) {
    const { file } = await this.workflow.load(id, user.instituteId as string);
    const isStaff =
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.INSTITUTE_ADMIN ||
      user.role === UserRole.ACADEMIC ||
      user.role === UserRole.DEALING;
    const inCourse =
      user.role === UserRole.COURSE && inMappedCourse(user, file.courseId);
    if (!isStaff && !inCourse) {
      throw new BadRequestException('You do not have permission to edit the Chief Guide');
    }
    if (inCourse) {
      this.assertMappedCourse(user, file.courseId, 'You can only edit thesis for your mapped course');
    }
    const name = String(body.name || '').trim();
    const designation = String(body.designation || '').trim();
    const departmentId = String(body.departmentId || '').trim();
    const mobile = String(body.mobile || '').replace(/\D/g, '');
    const email = String(body.email || '').trim().toLowerCase();
    const alternateMobile = String(body.alternateMobile || '').replace(/\D/g, '');
    const alternateEmail = String(body.alternateEmail || '').trim().toLowerCase();
    const errors: string[] = [];
    if (!name || name.length < 3) errors.push('Name of Chief Guide is required');
    else if (!/^[A-Za-z][A-Za-z .'-]{1,}$/.test(name)) errors.push('Name of Chief Guide may contain letters, spaces, apostrophes and hyphens only');
    if (!designation) errors.push('Designation of Chief Guide is required');
    if (!departmentId) errors.push('Department of Chief Guide is required');
    if (!mobile) errors.push('Contact is required');
    else if (!/^[6-9]\d{9}$/.test(mobile)) errors.push('Contact must be a 10-digit Indian number');
    if (!email) errors.push('Email Id of Chief Guide is required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email Id of Chief Guide is invalid');
    if (alternateMobile && !/^[6-9]\d{9}$/.test(alternateMobile)) errors.push('Alternate Mobile No. must be a 10-digit Indian number');
    if (alternateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alternateEmail)) errors.push('Alternate Email Id is invalid');
    if (errors.length) throw new BadRequestException(errors.join('. '));
    const iid = this.iid(user);
    const dept = await this.departments.findOne({ _id: departmentId, instituteId: iid });
    if (!dept) throw new BadRequestException('Department of Chief Guide not found');
    const payload = {
      name,
      email,
      mobile,
      designation,
      departmentId: dept._id,
      alternateMobile: alternateMobile || undefined,
      alternateEmail: alternateEmail || undefined,
      canGuide: true,
    };
    let guide = body.facultyId
      ? await this.faculty.findOne({ _id: body.facultyId, instituteId: iid })
      : await this.faculty.findOne({ instituteId: iid, email });
    if (guide) {
      Object.assign(guide, payload);
      await guide.save();
    } else {
      guide = await this.faculty.create({ ...payload, instituteId: iid });
    }
    file.chiefGuideId = guide._id;
    file.chiefGuideName = guide.name;
    file.chiefGuideEmail = guide.email;
    file.lastActionRemark = `Chief Guide ${guide.name}`;
    await file.save();
    return { file, faculty: guide };
  }

  async departmentDashboard(user: AuthUser, month?: string, year?: string) {
    const iid = this.iid(user);
    const current = await this.sessions.findOne({ instituteId: iid, current: true }).lean();
    const y = Number(year) || current?.year || new Date().getFullYear();
    const m = String(month || current?.month || '').trim();
    const sessionFilter: Record<string, unknown> = { instituteId: iid, year: y };
    if (m) sessionFilter.month = m;
    const sessionRows = await this.sessions.find(sessionFilter).select('_id month year').lean();
    const sessionIds: any[] = [...sessionRows.map((s) => s._id), ...sessionRows.map((s) => String(s._id))];
    const base = this.fileScope(user);
    const submittedFilter: Record<string, unknown> = {
      ...base,
      status: { $ne: FileStatus.DRAFT },
      sessionId: sessionIds.length ? { $in: sessionIds } : { $in: [] },
    };
    const submitted = await this.files.find(submittedFilter).select('departmentId updatedAt createdAt').lean();
    const addedCount = await this.files.countDocuments({
      ...base,
      status: FileStatus.DRAFT,
      sessionId: sessionIds.length ? { $in: sessionIds } : { $in: [] },
    });
    const deptIds = [...new Set(submitted.map((r) => String(r.departmentId || '')).filter(Boolean))];
    const last = submitted.reduce((acc: Date | null, r: any) => {
      const at = r.updatedAt || r.createdAt;
      if (!at) return acc;
      const d = new Date(at);
      return !acc || d > acc ? d : acc;
    }, null);
    return {
      month: m || current?.month || '',
      year: y,
      currentSession: current ? `${current.month} ${current.year}` : '',
      addedCount,
      submittedCount: submitted.length,
      submittedDeptCount: deptIds.length,
      lastSubmittedOn: last,
    };
  }

  async departmentReport(
    user: AuthUser,
    kind: string,
    courseId?: string,
    month?: string,
    year?: string,
    session?: string,
  ) {
    if (user.role !== UserRole.COURSE) throw new BadRequestException('Course reports only');
    const filter: Record<string, unknown> = this.fileScope(user);
    if (this.reportBucket(kind) === 'submitted') {
      filter.status = { $ne: FileStatus.DRAFT };
    } else {
      filter.status = FileStatus.DRAFT;
    }
    if (courseId && Types.ObjectId.isValid(courseId)) {
      this.assertMappedCourse(user, courseId, 'You can only filter your mapped course');
      filter.courseId = new Types.ObjectId(courseId);
    }
    await this.withSessionFilter(user, filter, month, year, session);
    const rows = await this.files
      .find(filter)
      .select('candidate title createdAt sessionId courseId departmentId specialityId')
      .sort({ updatedAt: -1 })
      .limit(2000)
      .lean();
    return this.withReportNames(rows);
  }

  programOf(bp: { code?: string; name?: string } | null | undefined): 'PG' | 'PHD' | null {
    const blob = `${bp?.code || ''} ${bp?.name || ''}`.toUpperCase();
    if (!blob.trim()) return null;
    if (blob.includes('PHD') || blob.includes('PH.D')) return 'PHD';
    if (blob.includes('PG_') || /\bPG\b/.test(blob) || blob.startsWith('PG')) return 'PG';
    return null;
  }

  async list(
    user: AuthUser,
    q?: string,
    departmentId?: string,
    stage?: string,
    program?: string,
    courseTypeId?: string,
    bucket?: string,
    courseId?: string,
    month?: string,
    year?: string,
    specialityId?: string,
    session?: string,
    status?: string,
    chiefGuideId?: string,
    lane?: string,
  ): Promise<any[]> {
    const filter: Record<string, unknown> = this.fileScope(user);
    if (status) {
      filter.status = status;
    } else if (user.role !== UserRole.COURSE) {
      filter.status = { $ne: FileStatus.DRAFT };
    } else if (bucket === 'added') {
      filter.status = FileStatus.DRAFT;
    } else if (bucket === 'submitted') {
      filter.status = { $ne: FileStatus.DRAFT };
    }
    if (departmentId && Types.ObjectId.isValid(departmentId)) {
      filter.departmentId = new Types.ObjectId(departmentId);
    }
    if (courseId && Types.ObjectId.isValid(courseId)) {
      this.assertMappedCourse(user, courseId, 'You can only filter your mapped course');
      filter.courseId = new Types.ObjectId(courseId);
    }
    if (specialityId && Types.ObjectId.isValid(specialityId)) {
      filter.specialityId = new Types.ObjectId(specialityId);
    }
    if (chiefGuideId && Types.ObjectId.isValid(chiefGuideId)) {
      filter.chiefGuideId = new Types.ObjectId(chiefGuideId);
    }
    await this.withSessionFilter(user, filter, month, year, session);
    if (q) {
      const qRegex = new RegExp(q, 'i');
      const qConditions = [
        { title: qRegex },
        { thesisNumber: qRegex },
        { fileNo: qRegex },
        { 'candidate.name': qRegex },
        { 'candidate.enrollmentNo': qRegex },
        { chiefGuideName: qRegex },
      ];
      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: qConditions },
        ];
        delete filter.$or;
      } else {
        filter.$or = qConditions;
      }
    }
    if (stage) {
      Object.assign(filter, stageClause(stage));
      if (status) filter.status = status;
    }
    if (courseTypeId === 'unassigned') {
      filter.courseTypeId = null;
    } else if (courseTypeId && Types.ObjectId.isValid(courseTypeId)) {
      const typeOid = new Types.ObjectId(courseTypeId);
      const matchingCourses = await this.courses.find({ courseTypeId: typeOid }).select('_id').lean();
      const courseIds = matchingCourses.map((c) => c._id);
      filter.$or = [
        { courseTypeId: typeOid },
        { courseId: { $in: courseIds } },
      ];
    }
    const prog = (program || '').toUpperCase();
    if (prog === 'PG' || prog === 'PHD') {
      const bps = await this.blueprints.find({ instituteId: this.iid(user) }).select('code name').lean();
      const ids = bps.filter((b) => this.programOf(b) === prog).map((b) => b._id);
      filter.blueprintId = { $in: ids };
    }
    const rows = await this.files
      .find(filter)
      .select('-notes -examAdmin -metro')
      .sort({ updatedAt: -1 })
      .limit(400)
      .lean();
    const withLane = await this.withDepartmentAndLane(rows, user);
    if (lane) {
      return withLane.filter((r) => r.lane === lane);
    }
    return withLane;
  }

  async metroStats(user: AuthUser, month?: string, year?: string, session?: string) {
    const iid = this.iid(user);
    const bps = await this.blueprints.find({ instituteId: iid }).lean();
    const pgBps = bps.filter((b) => this.programOf(b) === 'PG');
    const phdBps = bps.filter((b) => this.programOf(b) === 'PHD');
    const pgBp = pgBps.find((b) => b.code === 'PG_MEDICAL') || pgBps[0];
    const phdBp = phdBps.find((b) => b.code === 'PHD_MEDICAL') || phdBps[0];
    const stages: { stageCode: string; stageName: string }[] = [];
    const seen = new Set<string>();
    for (const s of pgBp?.stages || []) {
      if (s?.code && !seen.has(s.code)) {
        seen.add(s.code);
        stages.push({ stageCode: s.code, stageName: s.name || s.code });
      }
    }
    for (const s of phdBp?.stages || []) {
      if (s?.code && !seen.has(s.code)) {
        seen.add(s.code);
        stages.push({ stageCode: s.code, stageName: s.name || s.code });
      }
    }
    const bpProgram = new Map(bps.map((b) => [String(b._id), this.programOf(b)]));
    const rows = await this.files
      .find(await this.withSessionFilter(user, { ...this.fileScope(user), status: { $ne: FileStatus.DRAFT } }, month, year, session))
      .select('currentStageCode blueprintId')
      .lean();
    const counts = new Map<string, { pg: number; phd: number }>();
    for (const r of rows) {
      const code = r.currentStageCode;
      if (!code) continue;
      const cur = counts.get(code) || { pg: 0, phd: 0 };
      const prog = bpProgram.get(String(r.blueprintId));
      if (prog === 'PG') cur.pg += 1;
      else if (prog === 'PHD') cur.phd += 1;
      counts.set(code, cur);
      if (!seen.has(code)) {
        const fromBp = bps
          .flatMap((b) => b.stages || [])
          .find((s) => s.code === code);
        seen.add(code);
        stages.push({ stageCode: code, stageName: fromBp?.name || code });
      }
    }
    return {
      stages: stages.map((s) => ({
        stageCode: s.stageCode,
        stageName: s.stageName,
        pg: counts.get(s.stageCode)?.pg || 0,
        phd: counts.get(s.stageCode)?.phd || 0,
      })),
    };
  }

  async workflowBoard(user: AuthUser, month?: string, year?: string, session?: string, withReminders = false) {
    const iid = this.iid(user);
    const [types, bps, rows] = await Promise.all([
      this.courseTypes.find({ instituteId: iid }).lean(),
      this.blueprints.find({ instituteId: iid }).lean(),
      this.files.find(await this.withSessionFilter(user, { ...this.fileScope(user), status: { $ne: FileStatus.DRAFT } }, month, year, session)).select('currentStageCode courseTypeId blueprintId status panel').lean(),
    ]);
    const bpById = new Map(bps.map((b) => [String(b._id), b]));
    const allStages = bps.flatMap((b) => b.stages || []);

    const counts = new Map<string, Map<string, number>>();
    const orphans = new Map<string, number>();
    for (const r of rows) {
      const code = r.currentStageCode;
      if (!code) continue;
      const typeId = r.courseTypeId ? String(r.courseTypeId) : '';
      if (!typeId) {
        orphans.set(code, (orphans.get(code) || 0) + 1);
        continue;
      }
      const byStage = counts.get(typeId) || new Map<string, number>();
      byStage.set(code, (byStage.get(code) || 0) + 1);
      counts.set(typeId, byStage);
    }

    const stageList = (blueprintStages: { code: string; name?: string }[], byStage: Map<string, number>) => {
      const stages: { stageCode: string; stageName: string; count: number }[] = [];
      const seen = new Set<string>();
      for (const s of blueprintStages) {
        if (!s?.code || seen.has(s.code)) continue;
        seen.add(s.code);
        stages.push({ stageCode: s.code, stageName: s.name || s.code, count: byStage.get(s.code) || 0 });
      }
      // A file can sit on a stage the blueprint no longer lists, if it was edited later.
      for (const [code, count] of byStage) {
        if (seen.has(code)) continue;
        seen.add(code);
        stages.push({ stageCode: code, stageName: allStages.find((s) => s.code === code)?.name || code, count });
      }
      return stages;
    };

    const groups = types
      .filter((t) => t.blueprintId && bpById.has(String(t.blueprintId)))
      .map((t) => {
        const bp = bpById.get(String(t.blueprintId))!;
        const byStage = counts.get(String(t._id)) || new Map<string, number>();
        const stages = stageList(bp.stages || [], byStage);
        if (withReminders && (bp.stages || []).some((s) => s.code === 'cg_evaluate')) {
          const ofType = rows.filter((r) => String(r.courseTypeId || '') === String(t._id));
          const reminders = REMINDER_FILTERS.map((f) => ({
            stageCode: f.stageCode,
            stageName: f.stageName,
            count: ofType.filter((r) => matchesReminder(f.stageCode, r as any)).length,
          }));
          const anchor = stages.findIndex((s) => s.stageCode === 'reminder_dean');
          const at = anchor >= 0 ? anchor + 1 : stages.findIndex((s) => s.stageCode === 'evaluate') + 1;
          stages.splice(at > 0 ? at : stages.length, 0, ...reminders);
        }
        return {
          courseTypeId: String(t._id),
          courseTypeName: t.name,
          blueprintName: bp.name,
          total: stages.filter((s) => !isReminderFilter(s.stageCode)).reduce((sum, s) => sum + s.count, 0),
          stages,
        };
      })
      .sort((a, b) => String(a.courseTypeName).localeCompare(String(b.courseTypeName)));

    if (orphans.size) {
      const stages = stageList([], orphans);
      groups.push({
        courseTypeId: 'unassigned',
        courseTypeName: 'Unassigned course type',
        blueprintName: '',
        total: stages.reduce((sum, s) => sum + s.count, 0),
        stages,
      });
    }

    return { groups };
  }

  async inbox(
    user: AuthUser,
    lane?: string,
    month?: string,
    year?: string,
    session?: string,
    q?: string,
    departmentId?: string,
    courseTypeId?: string,
    courseId?: string,
    specialityId?: string,
    stage?: string,
    status?: string,
    chiefGuideId?: string,
  ): Promise<{ items: any[]; lanes: Record<string, number> }> {
    const baseFilter: Record<string, unknown> = this.workflow.inboxFilter(user);
    if (departmentId && Types.ObjectId.isValid(departmentId)) {
      baseFilter.departmentId = new Types.ObjectId(departmentId);
    }
    if (courseId && Types.ObjectId.isValid(courseId)) {
      baseFilter.courseId = new Types.ObjectId(courseId);
    }
    if (specialityId && Types.ObjectId.isValid(specialityId)) {
      baseFilter.specialityId = new Types.ObjectId(specialityId);
    }
    if (chiefGuideId && Types.ObjectId.isValid(chiefGuideId)) {
      baseFilter.chiefGuideId = new Types.ObjectId(chiefGuideId);
    }
    if (stage) {
      Object.assign(baseFilter, stageClause(stage));
    }
    if (status) {
      baseFilter.status = status;
    }
    if (courseTypeId && Types.ObjectId.isValid(courseTypeId)) {
      const typeOid = new Types.ObjectId(courseTypeId);
      const matchingCourses = await this.courses.find({ courseTypeId: typeOid }).select('_id').lean();
      const courseIds = matchingCourses.map((c) => c._id);
      baseFilter.$or = [
        { courseTypeId: typeOid },
        { courseId: { $in: courseIds } },
      ];
    }
    if (q) {
      const qRegex = new RegExp(q, 'i');
      const qConditions = [
        { title: qRegex },
        { thesisNumber: qRegex },
        { fileNo: qRegex },
        { 'candidate.name': qRegex },
        { 'candidate.enrollmentNo': qRegex },
        { chiefGuideName: qRegex },
      ];
      if (baseFilter.$or) {
        baseFilter.$and = [
          { $or: baseFilter.$or },
          { $or: qConditions },
        ];
        delete baseFilter.$or;
      } else {
        baseFilter.$or = qConditions;
      }
    }
    const rows = await this.files
      .find(await this.withSessionFilter(user, baseFilter, month, year, session))
      .sort({ updatedAt: -1 })
      .lean();
    const bps = await this.blueprints.find({
      _id: { $in: rows.map((r) => r.blueprintId) },
    });
    const map = new Map(bps.map((b) => [b._id.toString(), b]));
    const items = rows
      .filter((r) => {
        const bp = map.get(String(r.blueprintId));
        return bp ? this.workflow.matchesActor(r as any, bp, user) : false;
      })
      .map((r) => {
        const bp = map.get(String(r.blueprintId));
        const itemLane = bp ? this.workflow.inboxLane(r as any, bp) : 'OTHER';
        const panel = (r as any).panel || [];
        const approvedExaminers = panel.filter(
          (p: any) =>
            (p.vetStatus === 'APPROVED' || (p.assigned && !p.vetStatus)) &&
            p.vetStatus !== 'REJECTED' &&
            p.vetStatus !== 'HELD',
        );
        const acceptedExaminers = approvedExaminers.filter((p: any) => p.consentStatus === 'ACCEPTED');
        const regrettedExaminers = approvedExaminers.filter((p: any) => p.consentStatus === 'REGRETTED');
        const pendingExaminers = approvedExaminers.filter((p: any) => !p.consentStatus || p.consentStatus === 'PENDING');
        const examinerConsent = {
          approved: approvedExaminers.length,
          accepted: acceptedExaminers.length,
          regretted: regrettedExaminers.length,
          pending: pendingExaminers.length,
          summary: approvedExaminers.length > 0 ? `${acceptedExaminers.length} / ${approvedExaminers.length} Accepted` : '—',
        };
        return {
          ...r,
          lane: itemLane,
          laneLabel: INBOX_LANE_LABELS[itemLane] || itemLane,
          examinerConsent,
          canBulkApprove: this.canBulkApprove(user, r as any, bp),
          canBulkRequestPanel: this.canBulkRequestPanel(user, r as any, bp),
        };
      });
    const withDept = await this.withDepartmentNames(items);
    const lanes: Record<string, number> = {};
    for (const row of items) {
      lanes[row.lane] = (lanes[row.lane] || 0) + 1;
    }
    return {
      items: lane ? withDept.filter((r) => r.lane === lane) : withDept,
      lanes,
    };
  }

  /** Correct one thesis's exam file no. Mails, letters and portals read it live, so the new value shows everywhere. */
  async updateFileNo(user: AuthUser, id: string, value: unknown) {
    const allowed = [UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN, UserRole.DEALING] as string[];
    if (!allowed.includes(user.role)) throw new BadRequestException('Only the dealing section can change the file no.');
    const fileNo = cleanFileNumber(value);
    const file = await this.files.findOne({ _id: id, instituteId: this.iid(user) });
    if (!file) throw new NotFoundException('File not found');
    file.fileNo = fileNo;
    await file.save();
    return { ok: true, fileNo };
  }

  async update(user: AuthUser, id: string, body: any) {
    const { file } = await this.workflow.load(id, user.instituteId as string);
    const isStaff =
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.INSTITUTE_ADMIN ||
      user.role === UserRole.ACADEMIC ||
      user.role === UserRole.DEALING;
    const inCourse =
      user.role === UserRole.COURSE && inMappedCourse(user, file.courseId);
    if (!isStaff && !inCourse) {
      throw new BadRequestException('You do not have permission to edit this file');
    }
    if (!isStaff && file.status !== FileStatus.DRAFT) {
      throw new BadRequestException('This file has already been submitted. Request a guide change instead of editing.');
    }
    const iid = this.iid(user);
    if (body.courseId) {
      const course = await this.courses.findOne({ _id: body.courseId, instituteId: iid });
      if (!course) throw new BadRequestException('Course not found');
      if (inCourse) {
        this.assertMappedCourse(user, course._id, 'You can only add thesis for your mapped course');
      }
      if (!course.courseTypeId) throw new BadRequestException('Course has no course type');
      const courseType = await this.courseTypes.findOne({ _id: course.courseTypeId, instituteId: iid });
      if (!courseType?.blueprintId) throw new BadRequestException('Course type has no workflow blueprint');
      file.courseId = course._id;
      file.courseTypeId = courseType._id;
      file.blueprintId = courseType.blueprintId as Types.ObjectId;
      if (course.departmentId && !body.departmentId) file.departmentId = course.departmentId;
    }
    if (body.courseTypeId && !body.courseId) {
      const courseType = await this.courseTypes.findOne({ _id: body.courseTypeId, instituteId: iid });
      if (courseType) {
        file.courseTypeId = courseType._id;
        if (courseType.blueprintId) file.blueprintId = courseType.blueprintId as Types.ObjectId;
      }
    }
    if (body.departmentId) {
      const dept = await this.departments.findOne({ _id: body.departmentId, instituteId: iid });
      if (!dept) throw new BadRequestException('Department not found');
      file.departmentId = dept._id;
    }
    if (body.specialityId !== undefined) {
      if (!body.specialityId) {
        (file as any).specialityId = undefined;
      } else {
        const speciality = await this.specialities.findOne({ _id: body.specialityId, instituteId: iid });
        if (!speciality) throw new BadRequestException('Speciality not found');
        if (speciality.courseId && file.courseId && String(speciality.courseId) !== String(file.courseId)) {
          throw new BadRequestException('Speciality does not belong to the selected course');
        }
        file.specialityId = speciality._id;
      }
    }
    if (body.sessionId || body.sessionMonth || body.month) {
      const session = await this.resolveSession(user, body);
      file.sessionId = session._id;
    }
    if (body.title !== undefined) file.title = String(body.title || '').trim();
    if (body.candidateName || body.enrollmentNo || body.candidateEmail || body.mobile || body.dob) {
      const candidate = this.candidateFrom({
        enrollmentNo: body.enrollmentNo ?? file.candidate.enrollmentNo,
        candidateName: body.candidateName ?? file.candidate.name,
        dob: body.dob ?? file.candidate.dob,
        mobile: body.mobile ?? file.candidate.mobile,
        candidateEmail: body.candidateEmail ?? file.candidate.email,
      });
      await this.assertUniqueEnrollment(iid, candidate.enrollmentNo, String(file._id));
      file.candidate = candidate;
    }
    if (body.remarks !== undefined) file.remarks = body.remarks;
    if (body.chiefGuideId) {
      const g = await this.faculty.findOne({ _id: body.chiefGuideId, instituteId: iid });
      if (!g) throw new BadRequestException('Chief Guide not found in this institute');
      file.chiefGuideId = g._id;
      file.chiefGuideName = g.name;
      file.chiefGuideEmail = g.email;
    }
    if (Array.isArray(body.coGuideIds) || body.chiefGuideId) {
      const bp = await this.blueprints.findById(file.blueprintId);
      const maxCo = bp?.guidePolicy?.maxCoGuides ?? 0;
      file.coGuideIds = this.normalizeCoGuides(
        body.coGuideIds ?? file.coGuideIds,
        body.chiefGuideId || file.chiefGuideId,
        maxCo,
      );
      await this.assertFacultyInInstitute(file.coGuideIds, iid);
    }
    await file.save();
    return file;
  }

  async requestGuideChange(user: AuthUser, id: string, body: any) {
    const { file } = await this.workflow.load(id, user.instituteId as string);
    if (user.role !== UserRole.COURSE && user.role !== UserRole.ACADEMIC) {
      throw new BadRequestException('Only the course login (or Academic) can request a Chief Guide change');
    }
    let name = body.chiefGuideName;
    let email = body.chiefGuideEmail;
    if (body.chiefGuideId) {
      const g = await this.faculty.findOne({ _id: body.chiefGuideId, instituteId: user.instituteId });
      if (!g) throw new BadRequestException('Chief Guide not found in this institute');
      name = g.name;
      email = g.email;
    }
    if (!name) throw new BadRequestException('Proposed Chief Guide is required');
    file.guideChangeRequest = {
      chiefGuideId: body.chiefGuideId,
      chiefGuideName: name,
      chiefGuideEmail: email,
      reason: body.reason,
      status: 'PENDING',
      requestedBy: user.name,
      requestedAt: new Date(),
    };
    file.lastActionRemark = `Guide change requested: ${name}`;
    await file.save();
    return file;
  }

  async resolveGuideChange(user: AuthUser, id: string, approve: boolean, remark?: string) {
    const { file } = await this.workflow.load(id, user.instituteId as string);
    if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN, UserRole.AUTHORITY].includes(user.role as any)) {
      throw new BadRequestException('Not allowed');
    }
    const req = file.guideChangeRequest;
    if (!req || req.status !== 'PENDING') throw new BadRequestException('No pending guide change');
    if (approve) {
      if (req.chiefGuideId) file.chiefGuideId = new Types.ObjectId(req.chiefGuideId);
      file.chiefGuideName = req.chiefGuideName;
      file.chiefGuideEmail = req.chiefGuideEmail;
      req.status = 'APPROVED';
    } else {
      req.status = 'REJECTED';
    }
    file.guideChangeRequest = req;
    file.lastActionRemark = remark || (approve ? 'Guide change approved' : 'Guide change rejected');
    file.markModified('guideChangeRequest');
    await file.save();
    return file;
  }

  async get(user: AuthUser, id: string) {
    const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
    this.assertMappedCourse(user, file.courseId, 'You can only open thesis for your mapped course');
    const course = await this.courses.findById(file.courseId).lean();
    const courseType = (file.courseTypeId || course?.courseTypeId)
      ? await this.courseTypes.findById(file.courseTypeId || course?.courseTypeId).lean()
      : null;
    const department = await this.departments.findById(file.departmentId).lean();
    const session = file.sessionId ? await this.sessions.findById(file.sessionId).lean() : null;
    const speciality = file.specialityId ? await this.specialities.findById(file.specialityId).lean() : null;
    const iid = this.iid(user);
    const chiefId = this.asObjectIds(file.chiefGuideId)[0];
    const coIds = this.asObjectIds(file.coGuideIds);
    const chiefGuide = chiefId
      ? await this.faculty
          .findOne({ _id: chiefId, instituteId: iid })
          .select('name email designation mobile affiliation')
          .lean()
      : null;
    const coGuides = coIds.length
      ? await this.faculty.find({ _id: { $in: coIds }, instituteId: iid }).select('name email designation').lean()
      : [];
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    const raw = typeof (file as any).toObject === 'function' ? (file as any).toObject() : { ...file };
    raw.panel = this.visiblePanel(user, raw, stage);
    return {
      file: raw,
      coGuides,
      chiefGuide,
      session,
      speciality,
      blueprint: {
        id: String((blueprint as any)._id),
        name: blueprint.name,
        stages: blueprint.stages,
        panelRule: blueprint.panelRule,
        guidePolicy: blueprint.guidePolicy,
        revisionOwnerRole: blueprint.revisionOwnerRole,
        flags: blueprint.flags,
      },
      course,
      courseType,
      department,
      currentStage: stage,
      lane: this.workflow.inboxLane(file, blueprint),
      actions: this.availableActions(user, file, blueprint, stage),
      approvedLetters: this.approvedLetterFlags(raw, blueprint),
    };
  }

  private isPgRevisionBlueprint(blueprint?: { stages?: { code?: string }[] } | null) {
    return (blueprint?.stages || []).some((s) => s.code === 'revision_dean2');
  }

  private metroCompleted(file: { metro?: { stageCode?: string; status?: string }[] }, stageCode: string) {
    return (file.metro || []).some((m) => m.stageCode === stageCode && m.status === MetroStatus.COMPLETED);
  }

  private askedRevision(member: {
    isPractical?: boolean;
    isChiefGuide?: boolean;
    evaluation?: { verdict?: string };
    evaluationHistory?: { verdict?: string }[];
  }) {
    if (member.isPractical || member.isChiefGuide) return false;
    if (member.evaluation?.verdict === Verdict.REVISION || member.evaluation?.verdict === Verdict.REJECT) return true;
    return (member.evaluationHistory || []).some(
      (h) => h.verdict === Verdict.REVISION || h.verdict === Verdict.REJECT,
    );
  }

  private revisionExaminers(file: { panel?: any[] }) {
    return (file.panel || [])
      .map((p, panelIndex) => ({ ...p, panelIndex }))
      .filter((p) => this.askedRevision(p));
  }

  approvedLetterFlags(file: { metro?: any[]; currentStageCode?: string; panel?: any[] }, blueprint?: { stages?: { code?: string }[] } | null) {
    if (!this.isPgRevisionBlueprint(blueprint)) return { cg: false, examiner: false };
    const stage = String(file.currentStageCode || '');
    const cg =
      this.metroCompleted(file, 'revision_dean') ||
      ['revision_letter', 'revision_upload', 'revision_dean2', 'revision_dispatch'].includes(stage);
    const examiner = this.metroCompleted(file, 'revision_dean2') || stage === 'revision_dispatch';
    const hasExaminer = this.revisionExaminers(file).length > 0;
    return { cg: cg && hasExaminer, examiner: examiner && hasExaminer };
  }

  async listApprovedLetters(
    user: AuthUser,
    kindRaw?: string,
    month?: string,
    year?: string,
    session?: string,
    q?: string,
    courseId?: string,
    specialityId?: string,
    courseTypeId?: string,
    departmentId?: string,
  ) {
    const kind = String(kindRaw || 'CG').toUpperCase() === 'EXAMINER' ? 'EXAMINER' : 'CG';
    const baseFilter: Record<string, unknown> = {
      ...this.fileScope(user),
      status: { $ne: FileStatus.DRAFT },
    };
    if (q) {
      const qRegex = new RegExp(q, 'i');
      baseFilter.$or = [
        { title: qRegex },
        { thesisNumber: qRegex },
        { fileNo: qRegex },
        { 'candidate.name': qRegex },
        { 'candidate.enrollmentNo': qRegex },
        { chiefGuideName: qRegex },
      ];
    }
    if (courseId && Types.ObjectId.isValid(courseId)) baseFilter.courseId = new Types.ObjectId(courseId);
    if (specialityId && Types.ObjectId.isValid(specialityId)) baseFilter.specialityId = new Types.ObjectId(specialityId);
    if (departmentId && Types.ObjectId.isValid(departmentId)) baseFilter.departmentId = new Types.ObjectId(departmentId);
    if (courseTypeId && Types.ObjectId.isValid(courseTypeId)) {
      const typeOid = new Types.ObjectId(courseTypeId);
      const matchingCourses = await this.courses.find({ courseTypeId: typeOid }).select('_id').lean();
      baseFilter.$or = [
        ...(Array.isArray(baseFilter.$or) ? (baseFilter.$or as object[]) : []),
        { courseTypeId: typeOid },
        { courseId: { $in: matchingCourses.map((c) => c._id) } },
      ];
    }
    const rows = await this.files
      .find(await this.withSessionFilter(user, baseFilter, month, year, session))
      .sort({ updatedAt: -1 })
      .lean();
    const bps = await this.blueprints.find({ _id: { $in: rows.map((r) => r.blueprintId) } });
    const bpMap = new Map(bps.map((b) => [String(b._id), b]));
    const eligible: typeof rows = [];
    for (const file of rows) {
      const bp = bpMap.get(String(file.blueprintId));
      const flags = this.approvedLetterFlags(file as any, bp);
      if (kind === 'CG' ? !flags.cg : !flags.examiner) continue;
      eligible.push(file);
    }
    const named = await this.withReportNames(eligible);
    const items: any[] = [];
    for (const file of named) {
      for (const member of this.revisionExaminers(file as any)) {
        items.push({
          id: `${file._id}:${member.panelIndex}`,
          fileId: String(file._id),
          panelIndex: member.panelIndex,
          kind,
          thesisNumber: file.thesisNumber || '',
          fileNo: file.fileNo || '',
          title: file.title || '',
          candidateName: file.candidate?.name || '',
          enrollmentNo: file.candidate?.enrollmentNo || '',
          courseName: file.courseName || '—',
          specialityName: file.specialityName || '—',
          departmentName: file.departmentName || '—',
          chiefGuideName: file.chiefGuideName || '',
          examinerName: member.name || '',
          examinerDesignation: member.designation || '',
          examinerEmail: member.email || '',
          currentStageCode: file.currentStageCode,
        });
      }
    }
    return { kind, items };
  }

  async revisionLetter(user: AuthUser, id: string, kindRaw?: string, panelIndexRaw?: string) {
    const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
    this.assertMappedCourse(user, file.courseId, 'You can only open thesis for your mapped course');
    const kind = String(kindRaw || 'CG').toUpperCase() === 'EXAMINER' ? 'EXAMINER' : 'CG';
    const flags = this.approvedLetterFlags(file, blueprint);
    if (kind === 'CG' ? !flags.cg : !flags.examiner) {
      throw new BadRequestException(
        kind === 'EXAMINER'
          ? 'Examiner re-evaluation letter is available after Associate Dean approves the revised thesis'
          : 'Chief Guide revision letter is available after Associate Dean approves the modification',
      );
    }
    const examiners = this.revisionExaminers(file);
    if (!examiners.length) throw new BadRequestException('No examiner asked for revision / modification on this file');
    const idx = panelIndexRaw === undefined || panelIndexRaw === null || panelIndexRaw === '' ? NaN : Number(panelIndexRaw);
    const member = Number.isInteger(idx) ? examiners.find((p) => p.panelIndex === idx) || file.panel[idx] : examiners[0];
    if (!member || !this.askedRevision(member)) {
      throw new BadRequestException('Select an examiner who asked for revision / modification');
    }
    return this.comms.renderRevisionLetter(user, file, kind, {
      name: member.name,
      designation: member.designation,
      email: member.email,
    });
  }

  visiblePanel(user: AuthUser, file: { panel?: any[]; currentStageCode?: string }, stage: { type: string; code?: string }) {
    const full = (file.panel || []).map((p, i) => ({ ...p, panelIndex: i }));
    if (this.workflow.isPracticalStage(stage.code || file.currentStageCode)) {
      return full.filter((p) => p.isPractical);
    }
    const thesis = full.filter((p) => !p.isPractical);
    const seesFull =
      user.role === UserRole.DEALING ||
      user.role === UserRole.INSTITUTE_ADMIN ||
      (user.role === UserRole.AUTHORITY &&
        (stage.type === StageType.PANEL_SELECT || stage.type === StageType.PICK_NTH));
    if (seesFull) return thesis;
    if (stage.type === StageType.PANEL_SELECT || stage.type === StageType.PANEL_VET) {
      return thesis.filter((p) => p.assigned);
    }
    // AO / ACE / Dean letter hops run before examiner consent. Show the names the Dean
    // selected; leftover unassigned names stay on Dealing's full panel.
    return thesis.filter((p) => p.assigned || p.consentStatus === ConsentStatus.ACCEPTED);
  }

  availableActions(user: AuthUser, file: ThesisFileDocument, blueprint: Blueprint, stage: any) {
    if (file.status === FileStatus.DRAFT) {
      if (user.role !== UserRole.COURSE) return [];
      const minCo = blueprint.guidePolicy?.minCoGuides ?? 0;
      return this.sendBlockers(file, minCo).length ? [] : ['SEND_TO_EXAM'];
    }
    const guideTaskStage =
      stage.actorRole === UserRole.GUIDE &&
      [StageType.VIVA_DATE, StageType.REVISION, StageType.EVALUATE].includes(stage.type);
    try {
      this.workflow.actorOk(user, stage, file);
    } catch {
      if ([StageType.PANEL_BUILD, StageType.ADDITIONAL_PANEL].includes(stage.type) &&
        [UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
        return ['RESEND_PANEL'];
      }
      if (guideTaskStage && [UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
        return ['NOTIFY_GUIDE'];
      }
      if (user.role === UserRole.ACADEMIC && blueprint.flags?.resultHoldRelease) {
        return ['ACKNOWLEDGE_RESULT'];
      }
      if (user.role !== UserRole.INSTITUTE_ADMIN) return [];
    }
    const actions: string[] = [];
    if (file.status === FileStatus.ON_HOLD) {
      actions.push('RESUME');
      return actions;
    }
    switch (stage.type) {
      case StageType.APPROVE:
        if (stage.authoritySlot === 'ACE') {
          actions.push('APPROVE', 'HOLD');
        } else {
          actions.push('APPROVE', 'HOLD', 'REJECT');
        }
        break;
      case StageType.CONSENT_ROUTE:
        actions.push('APPROVE', 'HOLD', 'REJECT');
        break;
      case StageType.ASSIGN_NUMBER:
        actions.push('ASSIGN_NUMBER', 'HOLD');
        break;
      case StageType.PANEL_REQUEST:
        actions.push('REQUEST_PANEL');
        break;
      case StageType.PANEL_BUILD:
        if ([UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
          actions.push('RESEND_PANEL');
        }
        break;
      case StageType.PANEL_SELECT:
        actions.push('CONFIRM_SELECTION');
        break;
      case StageType.PANEL_VET:
        actions.push('APPROVE', 'HOLD', 'REJECT');
        break;
      case StageType.CONSENT:
        if (user.role === UserRole.DEALING || user.role === UserRole.INSTITUTE_ADMIN) {
          actions.push('SEND_OFFER');
          if (this.workflow.allConsented(file)) actions.push('CONTINUE');
          if (!this.workflow.isPracticalStage(stage.code)) actions.push('REQUEST_ADDITIONAL_PANEL');
        }
        break;
      case StageType.DISPATCH_THESIS:
        if ([LetterKind.REVISION, LetterKind.VIVA, LetterKind.CG_EVAL, LetterKind.BOARD].includes(stage.letterKind as any)) {
          actions.push('SEND_LETTER');
          if (stage.letterKind === LetterKind.REVISION && file.revisionLetterSentAt) actions.push('CONTINUE');
        } else {
          actions.push('DISPATCH');
        }
        break;
      case StageType.EVALUATE:
        if (stage.actorRole === UserRole.GUIDE) {
          if ([UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
            actions.push('NOTIFY_GUIDE');
          }
          if (blueprint.flags?.resultHoldRelease) actions.push('HOLD_RESULT', 'RELEASE_RESULT');
          break;
        }
        if ((file.reminderLevel || 0) < 3 && blueprint.stages.some((s) => s.letterKind === LetterKind.REMINDER)) {
          actions.push('SEND_REMINDER');
        }
        if (blueprint.flags?.resultHoldRelease) actions.push('HOLD_RESULT', 'RELEASE_RESULT');
        break;
      case StageType.WAIT:
        actions.push('CONTINUE');
        break;
      case StageType.PICK_NTH:
        actions.push('PICK_NTH');
        break;
      case StageType.REVISION: {
        const owner = blueprint.revisionOwnerRole || UserRole.DEALING;
        if (user.role === owner || user.role === UserRole.INSTITUTE_ADMIN) actions.push('UPLOAD_REVISION');
        if (owner === UserRole.GUIDE && [UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
          actions.push('NOTIFY_GUIDE');
        }
        break;
      }
      case StageType.ADDITIONAL_PANEL:
        actions.push('REQUEST_ADDITIONAL_PANEL', 'RESEND_PANEL');
        break;
      case StageType.VIVA:
        actions.push('SAVE_VIVA_DETAILS', 'CONTINUE');
        break;
      case StageType.PRACTICAL:
        actions.push('CONTINUE');
        break;
      case StageType.VIVA_DATE:
        actions.push('SET_VIVA_DATE');
        if (this.workflow.isPracticalStage(stage.code)) actions.push('SEND_LETTER');
        if (stage.actorRole === UserRole.GUIDE && [UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
          actions.push('NOTIFY_GUIDE');
        }
        if (this.workflow.isPracticalStage(stage.code) && [UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
          actions.push('NOTIFY_CHAIR');
        }
        break;
      case StageType.CLOSE:
        actions.push('CLOSE', 'REMUNERATE', 'SAVE_EXAM_ADMIN');
        if (blueprint.flags?.resultHoldRelease) {
          actions.push('HOLD_RESULT', 'RELEASE_RESULT');
          if (user.role === UserRole.ACADEMIC || user.role === UserRole.DEALING || user.role === UserRole.INSTITUTE_ADMIN) {
            actions.push('ACKNOWLEDGE_RESULT');
          }
        }
        break;
      default:
        break;
    }
    return actions;
  }

  async act(user: AuthUser, id: string, action: string, body: any) {
    if (action === 'SEND_TO_EXAM') return this.sendToExam(user, id);
    const { file, blueprint } = await this.workflow.load(id, user.instituteId as string);
    if (file.status === FileStatus.DRAFT) {
      throw new BadRequestException('Send this thesis to the Examination Section before workflow actions');
    }
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (action === 'HOLD_RESULT' || action === 'RELEASE_RESULT' || action === 'NOTIFY_GUIDE') {
      if (![UserRole.DEALING, UserRole.INSTITUTE_ADMIN, UserRole.AUTHORITY].includes(user.role as any)) {
        throw new BadRequestException('Not allowed');
      }
    } else if (action === 'ACKNOWLEDGE_RESULT') {
      if (![UserRole.ACADEMIC, UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
        throw new BadRequestException('Not allowed');
      }
    } else {
      this.workflow.actorOk(user, stage, file);
    }
    const remark = body?.remark;

    switch (action) {
      case 'APPROVE':
      case 'CONTINUE':
      case 'REQUEST_PANEL':
      case 'CONFIRM_SELECTION':
      case 'DISPATCH':
        if (action === 'CONFIRM_SELECTION') {
          const selected = (file.panel || []).filter((p) => p.assigned);
          if (!selected.length) {
            throw new BadRequestException('Tick the selected examiners in the panel before confirming');
          }
        }
        if (action === 'APPROVE' && stage.type === StageType.PANEL_VET) {
          const practical = this.workflow.isPracticalStage(stage.code);
          const pending = file.panel.filter((p) => {
            if (practical ? !p.isPractical : p.isPractical) return false;
            return p.assigned && (!p.vetStatus || p.vetStatus === 'PENDING');
          });
          if (pending.length) {
            throw new BadRequestException(
              `Still need a vet decision for: ${pending.map((p) => p.name.trim()).join(', ')}`,
            );
          }
          if (practical) {
            const approved = file.panel.filter((p) => p.isPractical && p.vetStatus === 'APPROVED');
            const roles = new Set(approved.map((p) => p.practicalRole));
            if (!roles.has(PracticalRole.CHAIRPERSON) || !roles.has(PracticalRole.INTERNAL) || !roles.has(PracticalRole.EXTERNAL)) {
              throw new BadRequestException('Associate Dean must approve Chairperson, Internal and External');
            }
          }
        }
        if (action === 'CONTINUE' && stage.type === StageType.PRACTICAL) {
          const roles = new Set(
            file.panel.filter((p) => p.isPractical && p.assigned).map((p) => p.practicalRole),
          );
          if (
            !roles.has(PracticalRole.CHAIRPERSON) ||
            !roles.has(PracticalRole.INTERNAL) ||
            !roles.has(PracticalRole.EXTERNAL)
          ) {
            throw new BadRequestException('Assign Chairperson, Internal and External before sending to Associate Dean');
          }
        }
        if (action === 'CONTINUE' && stage.letterKind === LetterKind.REVISION && !file.revisionLetterSentAt) {
          throw new BadRequestException('Send the revision letter first (pending / resend)');
        }
        return this.afterMove(await this.workflow.advance(file, blueprint, user, remark || action), blueprint);
      case 'NOTIFY_GUIDE':
        return this.notifyGuide(file, blueprint, true);
      case 'HOLD':
        return this.workflow.hold(file, blueprint, user, remark);
      case 'RESUME':
        return this.workflow.resume(file, blueprint);
      case 'REJECT':
        return this.workflow.reject(file, blueprint, user, remark || 'Rejected');
      case 'ASSIGN_NUMBER': {
        const fileNo = String(body?.fileNo || '').trim();
        const thesisNumber = String(body?.thesisNumber || '').trim();
        return this.applyAssignedNumbers(file, blueprint, user, fileNo, thesisNumber);
      }
      case 'CLOSE':
        file.status = FileStatus.COMPLETED;
        this.workflow.markCurrentComplete(file, user, remark);
        this.workflow.rebuildMetro(file, blueprint);
        await file.save();
        return file;
      case 'HOLD_RESULT':
        file.resultStatus = 'HOLD';
        await file.save();
        return file;
      case 'RELEASE_RESULT':
        file.resultStatus = 'RELEASE';
        await file.save();
        return file;
      case 'SET_VIVA_DATE':
        if (!body?.vivaDate) throw new BadRequestException('Viva / practical date is required');
        file.vivaDate = body.vivaDate;
        if (body.vivaTime) file.vivaTime = String(body.vivaTime);
        if (body.vivaVenue) file.vivaVenue = String(body.vivaVenue);
        if (this.workflow.isPracticalStage(stage.code)) {
          await this.comms.dispatchLetter(user.instituteId as string, file, LetterKind.BOARD, {
            vivaDate: file.vivaDate || '',
            vivaTime: file.vivaTime || '',
            vivaVenue: file.vivaVenue || '',
          });
        }
        return this.afterMove(
          await this.workflow.advance(
            file,
            blueprint,
            user,
            `Date ${body.vivaDate}${body.vivaTime ? ` ${body.vivaTime}` : ''}${body.vivaVenue ? ` at ${body.vivaVenue}` : ''}`,
          ),
          blueprint,
        );
      case 'SAVE_VIVA_DETAILS':
        file.vivaTime = body?.vivaTime != null ? String(body.vivaTime) : file.vivaTime;
        file.vivaVenue = body?.vivaVenue != null ? String(body.vivaVenue) : file.vivaVenue;
        if (body?.vivaDate) file.vivaDate = String(body.vivaDate);
        file.lastActionRemark = 'Viva / practical details saved';
        await file.save();
        return file;
      case 'SAVE_EXAM_ADMIN':
        file.examAdmin = {
          hall: body?.hall ?? file.examAdmin?.hall,
          supervisors: body?.supervisors ?? file.examAdmin?.supervisors,
          staffDuty: body?.staffDuty ?? file.examAdmin?.staffDuty,
          eligibleCount: body?.eligibleCount ?? file.examAdmin?.eligibleCount,
        };
        file.lastActionRemark = 'Exam administration saved';
        await file.save();
        return file;
      case 'ACKNOWLEDGE_RESULT':
        if (![UserRole.ACADEMIC, UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
          throw new BadRequestException('Not allowed');
        }
        file.academicAcknowledgedAt = new Date();
        file.academicAcknowledgedBy = user.name;
        file.lastActionRemark = `Academic acknowledged result (${file.resultStatus || 'RELEASE'})`;
        await file.save();
        return file;
      case 'SEND_LETTER':
        return this.sendStageLetter(user, file, blueprint, remark);
      case 'NOTIFY_CHAIR':
        return this.notifyChairperson(file, blueprint);
      case 'SEND_REMINDER': {
        const hop = blueprint.stages.find((s) => s.letterKind === LetterKind.REMINDER);
        if (!hop) throw new BadRequestException('This blueprint has no reminder letter hops');
        if ((file.reminderLevel || 0) >= 3) throw new BadRequestException('All three reminders have been used');
        file.reminderLevel = (file.reminderLevel || 0) + 1;
        await this.comms.dispatchLetter(user.instituteId as string, file, 'REMINDER', {
          reminderLevel: String(file.reminderLevel),
        });
        return this.afterMove(
          await this.workflow.jumpTo(
            file,
            blueprint,
            user,
            hop.code,
            remark || `Evaluation reminder ${file.reminderLevel} sent for approval`,
          ),
          blueprint,
        );
      }
      case 'REQUEST_ADDITIONAL_PANEL':
        throw new BadRequestException('Use the additional-panel action from File 360');
      default:
        throw new BadRequestException(`Unknown action ${action}`);
    }
  }

  private async sendStageLetter(user: AuthUser, file: ThesisFileDocument, blueprint: Blueprint, remark?: string) {
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    const kind = stage.letterKind || LetterKind.REVISION;
    const extra: Record<string, string> = {
      vivaTime: file.vivaTime || '',
      vivaVenue: file.vivaVenue || '',
    };
    await this.comms.dispatchLetter(user.instituteId as string, file, kind, extra);
    if (kind === LetterKind.REVISION) {
      file.revisionLetterSentAt = new Date();
      if (file.chiefGuideEmail) {
        await this.comms.sendForPurpose({
          instituteId: String(file.instituteId),
          purpose: 'REVISION',
          file,
          to: file.chiefGuideEmail,
          toName: file.chiefGuideName,
          extraVars: { ...extra, chiefGuideName: file.chiefGuideName || '', chiefGuideEmail: file.chiefGuideEmail },
        });
      }
      file.lastActionRemark = remark || 'Revision letter sent';
      await file.save();
      return file;
    }
    if (kind === LetterKind.BOARD) {
      file.lastActionRemark = remark || 'Board of Examiners letter sent';
      await file.save();
      return file;
    }
    if (kind === LetterKind.VIVA) {
      const next = stage.next ? this.workflow.stage(blueprint, stage.next) : null;
      if (next?.type !== StageType.VIVA_DATE && file.chiefGuideEmail) {
        await this.comms.sendForPurpose({
          instituteId: String(file.instituteId),
          purpose: 'VIVA',
          file,
          to: file.chiefGuideEmail,
          toName: file.chiefGuideName,
          extraVars: {
            ...extra,
            chiefGuideName: file.chiefGuideName || '',
            chiefGuideEmail: file.chiefGuideEmail,
          },
        });
      }
      return this.afterMove(await this.workflow.advance(file, blueprint, user, remark || 'Viva letter sent'), blueprint);
    }
    return this.afterMove(await this.workflow.advance(file, blueprint, user, remark || 'Letter sent'), blueprint);
  }

  async notifyChairperson(file: ThesisFileDocument, blueprint: Blueprint) {
    const chair = (file.panel || []).find(
      (p) => p.isPractical && p.practicalRole === PracticalRole.CHAIRPERSON && p.consentStatus === ConsentStatus.ACCEPTED,
    );
    if (!chair?.email) throw new BadRequestException('Chairperson has not accepted the practical offer yet');
    const token = randomBytes(24).toString('hex');
    await this.tokens.create({
      token,
      instituteId: file.instituteId,
      fileId: file._id,
      purpose: 'VIVA_DATE',
      email: chair.email.toLowerCase(),
      name: chair.name,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    const link = taskUrl(token);
    await this.comms.sendForPurpose({
      instituteId: String(file.instituteId),
      purpose: 'VIVA_DATE',
      file,
      to: chair.email,
      toName: chair.name,
      extraVars: {
        taskLink: link,
        examinerName: chair.name || '',
        vivaTime: file.vivaTime || '',
        vivaVenue: file.vivaVenue || '',
      },
    });
    file.lastActionRemark = `Practical date link sent to Chairperson ${chair.name}`;
    await file.save();
    return file;
  }

  async addDocument(user: AuthUser, id: string, kind: string, path: string, originalName: string) {
    const { file } = await this.workflow.load(id, user.instituteId as string);
    const deptDraft =
      user.role === UserRole.COURSE &&
      file.status === FileStatus.DRAFT &&
      inMappedCourse(user, file.courseId);
    if (!deptDraft && ![UserRole.DEALING, UserRole.INSTITUTE_ADMIN].includes(user.role as any)) {
      throw new BadRequestException('Not allowed');
    }
    const allowed = new Set(['THESIS', 'AWARD_SHEET', 'CHALLAN', 'QUESTION_PAPER', 'SUPPORTING']);
    const k = String(kind || 'SUPPORTING').toUpperCase();
    if (!allowed.has(k)) throw new BadRequestException('Unknown document kind');
    const version = (file.documents?.filter((d) => d.kind === k).length || 0) + 1;
    file.documents.push({
      kind: k,
      version,
      path,
      originalName,
      uploadedAt: new Date(),
      uploadedBy: user.name,
    });
    file.markModified('documents');
    file.lastActionRemark = `${k.replaceAll('_', ' ')} uploaded`;
    await file.save();
    return file;
  }

  async addNote(user: AuthUser, id: string, message: string) {
    if (!message?.trim()) throw new BadRequestException('Message required');
    const { file } = await this.workflow.load(id, user.instituteId as string);
    file.notes = file.notes || [];
    file.notes.push({ at: new Date(), by: user.name, role: user.role, message: message.trim() });
    file.markModified('notes');
    await file.save();
    return file;
  }

  async auditTrail(user: AuthUser, id: string) {
    const file = await this.files.findOne({ _id: id, ...this.fileScope(user) }).select('_id').lean();
    if (!file) throw new NotFoundException('File not found');
    const rows = await this.audit
      .find({
        instituteId: this.iid(user),
        recordId: new Types.ObjectId(id),
        table: 'ThesisFile',
      })
      .sort({ createdAt: -1 })
      .limit(40)
      .select(
        'actorName actorEmail operation action createdAt after.lastActionRemark before.lastActionRemark after.notes before.notes after.metro before.metro',
      )
      .lean();
    return rows.map((row: any) => {
      const before = row.before || {};
      const after = row.after || {};
      const nextRemark = String(after.lastActionRemark || '').trim();
      const prevRemark = String(before.lastActionRemark || '').trim();
      let remark = nextRemark && nextRemark !== prevRemark ? nextRemark : '';
      if (!remark) {
        const beforeMetro = new Map(
          (Array.isArray(before.metro) ? before.metro : []).map((m: any) => [
            String(m.stageCode || ''),
            String(m.remark || '').trim(),
          ]),
        );
        const metroHit = (Array.isArray(after.metro) ? after.metro : []).find((m: any) => {
          const next = String(m.remark || '').trim();
          return next && next !== beforeMetro.get(String(m.stageCode || ''));
        });
        if (metroHit?.remark) remark = String(metroHit.remark).trim();
      }
      const beforeNotes = Array.isArray(before.notes) ? before.notes.length : 0;
      const addedNotes = (Array.isArray(after.notes) ? after.notes : [])
        .slice(beforeNotes)
        .map((n: any) => ({ by: n.by, role: n.role, message: n.message }))
        .filter((n: { message?: string }) => String(n.message || '').trim());
      return {
        _id: row._id,
        actorName: row.actorName,
        actorEmail: row.actorEmail,
        operation: row.operation,
        action: row.action,
        createdAt: row.createdAt,
        remark,
        notes: addedNotes,
      };
    });
  }

  async results(user: AuthUser, month?: string, year?: string, session?: string): Promise<{ held: any[]; released: any[] }> {
    const rows = await this.files
      .find(await this.withSessionFilter(user, { ...this.fileScope(user), status: { $ne: FileStatus.DRAFT } }, month, year, session))
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean();
    return {
      held: rows.filter((r) => r.resultStatus === 'HOLD'),
      released: rows.filter((r) => r.resultStatus !== 'HOLD'),
    };
  }

  async submissions(user: AuthUser, month?: string, year?: string, session?: string): Promise<{ numbered: any[]; awaitingNumber: any[]; submitted: any[]; notSubmitted: any[] }> {
    const rows = await this.files.find(await this.withSessionFilter(user, this.fileScope(user), month, year, session)).sort({ updatedAt: -1 }).limit(400).lean();
    const numbered = rows.filter((r) => !!r.thesisNumber);
    const awaitingNumber = rows.filter((r) => !r.thesisNumber);
    return { numbered, awaitingNumber, submitted: numbered, notSubmitted: awaitingNumber };
  }

  private normalizeCoGuides(raw: unknown, chiefGuideId: unknown, maxCo: number) {
    const ids = (Array.isArray(raw) ? raw : [])
      .map((id) => String(id || '').trim())
      .filter((id) => id && id !== String(chiefGuideId || '') && Types.ObjectId.isValid(id));
    return [...new Set(ids)].slice(0, maxCo).map((id) => new Types.ObjectId(id));
  }

  private async assertFacultyInInstitute(ids: Types.ObjectId[], instituteId: unknown) {
    if (!ids.length) return;
    const n = await this.faculty.countDocuments({ _id: { $in: ids }, instituteId });
    if (n !== ids.length) throw new BadRequestException('Co-Guide not found in this institute');
  }

  private async withDepartmentNames<T extends { departmentId?: unknown; courseId?: unknown; courseTypeId?: unknown }>(
    rows: T[],
  ) {
    const deptIds = this.idsForIn(rows.map((r) => r.departmentId));
    const courseIds = this.idsForIn(rows.map((r) => r.courseId));
    const typeIdsFromFile = this.idsForIn(rows.map((r) => r.courseTypeId));
    const depts = deptIds.length
      ? await this.departments.find({ _id: { $in: deptIds } }).select('name').lean()
      : ([] as { _id: unknown; name: string }[]);
    const courses = courseIds.length
      ? await this.courses.find({ _id: { $in: courseIds } }).select('name courseTypeId').lean()
      : ([] as { _id: unknown; name: string; courseTypeId?: unknown }[]);
    const names = new Map(depts.map((d) => [String(d._id), d.name]));
    const courseMap = new Map(courses.map((c) => [String(c._id), c] as const));
    const extraTypeIds = this.idsForIn([...typeIdsFromFile, ...courses.map((c) => c.courseTypeId)]);
    const types = extraTypeIds.length
      ? await this.courseTypes.find({ _id: { $in: extraTypeIds } }).select('name').lean()
      : ([] as { _id: unknown; name: string }[]);
    const typeMap = new Map(types.map((t) => [String(t._id), t.name]));
    return rows.map((r) => {
      const course = courseMap.get(String(r.courseId || ''));
      const typeId = String(r.courseTypeId || course?.courseTypeId || '');
      return {
        ...r,
        departmentName: names.get(String(r.departmentId || '')) || '—',
        courseName: course?.name || '—',
        courseTypeName: typeMap.get(typeId) || '—',
      };
    });
  }

  async withReportNames(rows: any[]) {
    const named = await this.withDepartmentNames(rows);
    const sessionIds = this.idsForIn(named.map((r) => r.sessionId));
    const specIds = this.idsForIn(named.map((r) => r.specialityId));
    const [sessions, specs] = await Promise.all([
      sessionIds.length
        ? this.sessions.find({ _id: { $in: sessionIds } }).select('month year').lean()
        : Promise.resolve([] as { _id: unknown; month: string; year: number }[]),
      specIds.length
        ? this.specialities.find({ _id: { $in: specIds } }).select('name').lean()
        : Promise.resolve([] as { _id: unknown; name: string }[]),
    ]);
    const sessionMap = new Map(sessions.map((s) => [String(s._id), `${s.month} ${s.year}`] as const));
    const specMap = new Map(specs.map((s) => [String(s._id), s.name] as const));
    return named.map((r) => ({
      ...r,
      sessionName: sessionMap.get(String(r.sessionId || '')) || '—',
      specialityName: specMap.get(String(r.specialityId || '')) || '—',
    }));
  }

  private async withDepartmentAndLane(rows: any[], user?: AuthUser) {
    const named = await this.withDepartmentNames(rows);
    const bpIds = this.idsForIn(named.map((r) => r.blueprintId));
    const bps = bpIds.length
      ? await this.blueprints.find({ _id: { $in: bpIds } }).lean()
      : [];
    const map = new Map(bps.map((b) => [String(b._id), b]));
    const sessionIds = this.idsForIn(named.map((r) => r.sessionId));
    const specIds = this.idsForIn(named.map((r) => r.specialityId));
    const facultyIds = this.idsForIn(named.map((r) => r.chiefGuideId));
    const [sessions, specs, guides] = await Promise.all([
      sessionIds.length
        ? this.sessions.find({ _id: { $in: sessionIds } }).select('month year').lean()
        : Promise.resolve([] as { _id: unknown; month: string; year: number }[]),
      specIds.length
        ? this.specialities.find({ _id: { $in: specIds } }).select('name').lean()
        : Promise.resolve([] as { _id: unknown; name: string }[]),
      facultyIds.length
        ? this.faculty.find({ _id: { $in: facultyIds } }).select('name email designation mobile alternateMobile alternateEmail departmentId').lean()
        : Promise.resolve([] as { _id: unknown; designation?: string; mobile?: string }[]),
    ]);
    const sessionMap = new Map(sessions.map((s) => [String(s._id), `${s.month} ${s.year}`] as const));
    const specMap = new Map(specs.map((s) => [String(s._id), s.name] as const));
    const guideMap = new Map(guides.map((g) => [String(g._id), g] as const));
    // Which files at the panel-build step were already mailed to the CG → "Resend"; the rest are a first "Send".
    const resendIds = named
      .filter((r) => (user ? this.canBulkResendPanel(user, r as any, map.get(String(r.blueprintId))) : false))
      .map((r) => r._id);
    const mailedSet = new Set<string>();
    if (resendIds.length) {
      const mailed = await this.tokens
        .find({ fileId: { $in: resendIds }, purpose: 'PANEL_BUILD' })
        .select('fileId')
        .lean();
      for (const t of mailed) mailedSet.add(String(t.fileId));
    }
    return named.map((r) => {
      const bp = map.get(String(r.blueprintId));
      const lane = bp ? this.workflow.inboxLane(r as any, bp) : 'OTHER';
      const guide = guideMap.get(String(r.chiefGuideId || ''));
      const minCo = bp?.guidePolicy?.minCoGuides ?? 0;
      const sendBlockers = this.sendBlockers(r, minCo);
      const panel = (r as any).panel || [];
      const approvedExaminers = panel.filter(
        (p: any) =>
          (p.vetStatus === 'APPROVED' || (p.assigned && !p.vetStatus)) &&
          p.vetStatus !== 'REJECTED' &&
          p.vetStatus !== 'HELD',
      );
      const acceptedExaminers = approvedExaminers.filter((p: any) => p.consentStatus === 'ACCEPTED');
      const regrettedExaminers = approvedExaminers.filter((p: any) => p.consentStatus === 'REGRETTED');
      const pendingExaminers = approvedExaminers.filter((p: any) => !p.consentStatus || p.consentStatus === 'PENDING');
      const examinerConsent = {
        approved: approvedExaminers.length,
        accepted: acceptedExaminers.length,
        regretted: regrettedExaminers.length,
        pending: pendingExaminers.length,
        summary: approvedExaminers.length > 0 ? `${acceptedExaminers.length} / ${approvedExaminers.length} Accepted` : '—',
      };
      return {
        ...r,
        lane,
        laneLabel: INBOX_LANE_LABELS[lane] || lane,
        canBulkApprove: user ? this.canBulkApprove(user, r, bp) : false,
        canBulkRequestPanel: user ? this.canBulkRequestPanel(user, r, bp) : false,
        canBulkResendPanel: user ? this.canBulkResendPanel(user, r, bp) : false,
        panelRequested: mailedSet.has(String(r._id)),
        canBulkReminder: user ? this.canBulkReminder(user, r as any, bp) : false,
        canBulkDispatch: user ? this.canBulkDispatch(user, r as any, bp) : false,
        canBulkVetApprove: user ? this.canBulkVetApprove(user, r as any, bp) : false,
        canBulkClose: user ? this.canBulkClose(user, r as any, bp) : false,
        sessionName: sessionMap.get(String(r.sessionId || '')) || '—',
        specialityName: specMap.get(String(r.specialityId || '')) || '—',
        chiefGuideDesignation: guide?.designation || '',
        chiefGuideMobile: guide?.mobile || '',
        chiefGuideAlternateMobile: (guide as any)?.alternateMobile || '',
        chiefGuideAlternateEmail: (guide as any)?.alternateEmail || '',
        hasThesisPdf: (r.documents || []).some((d: any) => d.kind === 'THESIS'),
        sendReady: sendBlockers.length === 0,
        sendBlockers,
        examinerConsent,
      };
    });
  }

  private async afterMove(file: ThesisFileDocument, blueprint: Blueprint) {
    await this.maybeNotifyGuide(file, blueprint);
    return file;
  }

  private async maybeNotifyGuide(file: ThesisFileDocument, blueprint: Blueprint) {
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    if (stage.actorRole !== UserRole.GUIDE) return;
    if (![StageType.VIVA_DATE, StageType.REVISION, StageType.EVALUATE].includes(stage.type as any)) return;
    if (!file.chiefGuideEmail) return;
    await this.notifyGuide(file, blueprint, false);
  }

  async notifyGuide(file: ThesisFileDocument, blueprint: Blueprint, resend = false) {
    const stage = this.workflow.stage(blueprint, file.currentStageCode);
    this.workflow.applyIncomingStage(file, blueprint, file.currentStageCode);
    if (!file.chiefGuideEmail) throw new BadRequestException('Chief Guide email missing');
    const purpose =
      stage.type === StageType.VIVA_DATE ? 'VIVA_DATE' : stage.type === StageType.EVALUATE ? 'EVALUATE' : 'REVISION';
    if (!resend) {
      const existing = await this.tokens.findOne({
        fileId: file._id,
        purpose,
        email: file.chiefGuideEmail.toLowerCase(),
        verified: false,
        expiresAt: { $gt: new Date() },
      });
      if (existing) return file;
    }
    const token = randomBytes(24).toString('hex');
    await this.tokens.create({
      token,
      instituteId: file.instituteId,
      fileId: file._id,
      purpose,
      email: file.chiefGuideEmail.toLowerCase(),
      name: file.chiefGuideName,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    const link = taskUrl(token);
    await this.comms.sendForPurpose({
      instituteId: String(file.instituteId),
      purpose,
      file,
      to: file.chiefGuideEmail,
      toName: file.chiefGuideName,
      extraVars: {
        taskLink: link,
        examinerName: file.chiefGuideName || '',
        chiefGuideName: file.chiefGuideName || '',
        chiefGuideEmail: file.chiefGuideEmail,
      },
    });
    await file.save();
    return file;
  }
}
