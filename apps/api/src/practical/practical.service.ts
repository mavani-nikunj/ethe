import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PRACTICAL_AIR_STATUS_LABELS,
  PRACTICAL_DOC_TYPES,
  PRACTICAL_EXAMINER_TYPES,
  PRACTICAL_QUESTION_PAPER,
  PRACTICAL_STATUS_LABELS,
  PracticalAirStatus,
  PracticalDateMail,
  PracticalExaminerType,
  PracticalLookupKind,
  PracticalStatus,
  UserRole,
  cleanMobile,
  isPracticalChair,
  isValidEmail,
  isValidMobile,
  normalizeEmail,
  practicalTypeLabel,
} from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { asObjectIds } from '../common/course-scope';
import { normalizeAuthoritySlot } from '../common/authority-slot';
import {
  PracticalDocument,
  PracticalExaminer,
  PracticalExaminerDetail,
  PracticalExaminerDocument,
  PracticalLookup,
  PracticalSchedule,
} from '../database/practical.schema';
import { AcademicSession, Course, Department, ExaminerPool, ExamType, Faculty, Speciality } from '../database/masters.schema';
import { User } from '../database/user.schema';
import { CommTemplate } from '../database/comms.schema';
import { PracticalMail, PracticalMailService, SENDABLE_PRACTICAL_MAILS } from './practical-mail.service';
import { removeUpload } from './practical-files';
import { PracticalTaskService, PracticalTokenPurpose } from './practical-task.service';

const S = PracticalStatus;

/**
 * Each menu page is a filtered view of the same examiner list. Keys match the web routes.
 * Status sets follow the old USPApoinmentProcess queries (see docs/practical-examiner-plan.md §7a).
 */
export const PRACTICAL_VIEWS: Record<string, { statuses?: string[]; chairOnly?: boolean; airOnly?: boolean }> = {
  assigned: {},
  edit: { statuses: [S.DEAN_HELD, S.DEAN_REJECTED, S.DEAN_APPROVED, S.OFFER_SENT, S.REGRETTED, S.ACCEPTED, S.APPOINTED] },
  'to-dean': { statuses: [S.PENDING] },
  'with-dean': { statuses: [S.WITH_DEAN] },
  held: { statuses: [S.DEAN_HELD] },
  'rejected-dean': { statuses: [S.DEAN_REJECTED] },
  approved: { statuses: [S.DEAN_APPROVED, S.OFFER_SENT, S.REGRETTED, S.ACCEPTED, S.APPOINTED] },
  offer: { statuses: [S.DEAN_APPROVED] },
  'offer-pending': { statuses: [S.OFFER_SENT] },
  regret: { statuses: [S.REGRETTED] },
  accepted: { statuses: [S.ACCEPTED] },
  'accepted-all': { statuses: [S.ACCEPTED, S.APPOINTED] },
  portal: { statuses: [S.APPOINTED] },
  passcodes: { statuses: [S.APPOINTED] },
  chairperson: { statuses: [S.APPOINTED], chairOnly: true },
  air: { airOnly: true },
};

/** Where the Assoc. Dean decision may come from (old: Sent / Hold / Rejected pages). */
const VET_FROM: Record<string, string[]> = {
  APPROVE: [S.WITH_DEAN, S.DEAN_HELD, S.DEAN_REJECTED],
  HOLD: [S.WITH_DEAN, S.DEAN_REJECTED],
  REJECT: [S.WITH_DEAN, S.DEAN_HELD],
};
const VET_TO: Record<string, string> = { APPROVE: S.DEAN_APPROVED, HOLD: S.DEAN_HELD, REJECT: S.DEAN_REJECTED };

const DELETABLE = new Set<string>([S.PENDING, S.DEAN_REJECTED, S.REGRETTED]);
const TYPE_CODES = new Set<string>(PRACTICAL_EXAMINER_TYPES.map((t) => t.code));
const TYPE_ORDER = new Map<string, number>(PRACTICAL_EXAMINER_TYPES.map((t) => [t.code, t.order]));
const LOOKUP_KINDS = new Set<string>(Object.values(PracticalLookupKind));

type BulkResult = { updated: number; skipped: { id: string; name: string; reason: string }[] };

function text(v: unknown, max = 300): string {
  return String(v ?? '').trim().slice(0, max);
}

function optionalNumber(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label} must be a positive number`);
  return n;
}

function oid(v: unknown, label: string): Types.ObjectId {
  const s = String(v ?? '');
  if (!Types.ObjectId.isValid(s)) throw new BadRequestException(`${label} is required`);
  return new Types.ObjectId(s);
}

@Injectable()
export class PracticalService {
  constructor(
    @InjectModel(PracticalSchedule.name) private schedules: Model<PracticalSchedule>,
    @InjectModel(PracticalExaminer.name) private examiners: Model<PracticalExaminer>,
    @InjectModel(PracticalExaminerDetail.name) private details: Model<PracticalExaminerDetail>,
    @InjectModel(PracticalLookup.name) private lookups: Model<PracticalLookup>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(Faculty.name) private faculty: Model<Faculty>,
    @InjectModel(ExaminerPool.name) private pool: Model<ExaminerPool>,
    @InjectModel(ExamType.name) private examTypes: Model<ExamType>,
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(CommTemplate.name) private templates: Model<CommTemplate>,
    @InjectModel(PracticalDocument.name) private documents: Model<PracticalDocument>,
    private tasks: PracticalTaskService,
    private mail: PracticalMailService,
  ) {}

  // ---------- roles ----------

  private iid(user: AuthUser) {
    return new Types.ObjectId(user.instituteId as string);
  }

  isDealing(user: AuthUser) {
    return user.role === UserRole.DEALING;
  }

  isDean(user: AuthUser) {
    return user.role === UserRole.AUTHORITY && normalizeAuthoritySlot(user.authoritySlot) === 'ASSOC_DEAN';
  }

  private requireDealing(user: AuthUser) {
    if (!this.isDealing(user)) throw new ForbiddenException('Only the Dealing Assistant can do this');
  }

  private requireDean(user: AuthUser) {
    if (!this.isDean(user)) throw new ForbiddenException('Only the Associate Dean can approve, hold or reject');
  }

  private historyEvent(user: AuthUser, status: string, remark?: string) {
    return {
      status,
      at: new Date(),
      by: user.userId,
      byName: user.name,
      role: user.role === UserRole.AUTHORITY ? normalizeAuthoritySlot(user.authoritySlot) || user.role : user.role,
      ...(remark ? { remark } : {}),
    };
  }

  /**
   * Course scope. The Associate Dean works only on the courses mapped to their login (none mapped = none).
   * Others are limited to mapped courses when they have any, otherwise see all.
   */
  private courseScope(user: AuthUser): Types.ObjectId[] | null {
    const mapped = asObjectIds(user.courseIds);
    if (this.isDean(user)) return mapped;
    return mapped.length ? mapped : null;
  }

  /** Dealing sees only their own boards; course scope applies to everyone. */
  private scopeFilter(user: AuthUser, dealingId?: string) {
    const filter: Record<string, unknown> = { instituteId: this.iid(user) };
    if (this.isDealing(user)) filter.dealingUserId = new Types.ObjectId(user.userId);
    else if (dealingId && Types.ObjectId.isValid(dealingId)) filter.dealingUserId = new Types.ObjectId(dealingId);
    const scope = this.courseScope(user);
    if (scope) filter.courseId = { $in: scope };
    return filter;
  }

  private inCourseScope(user: AuthUser, courseId: unknown) {
    const scope = this.courseScope(user);
    return !scope || scope.some((id) => String(id) === String(courseId));
  }

  private assertInScope(user: AuthUser, row: { instituteId: unknown; dealingUserId?: unknown; courseId?: unknown }) {
    if (String(row.instituteId) !== String(user.instituteId)) throw new NotFoundException('Examiner not found');
    if (this.isDealing(user) && String(row.dealingUserId) !== String(user.userId)) {
      throw new ForbiddenException('This examiner belongs to another Dealing Assistant');
    }
    if (!this.inCourseScope(user, row.courseId)) {
      throw new ForbiddenException('This course is not mapped to your login');
    }
  }

  // ---------- sessions & masters ----------

  async resolveSessionId(user: AuthUser, sessionId?: string): Promise<Types.ObjectId> {
    if (sessionId && Types.ObjectId.isValid(sessionId)) {
      const row = await this.sessions.findOne({ _id: sessionId, instituteId: this.iid(user) }).select('_id').lean();
      if (!row) throw new BadRequestException('Exam session not found');
      return row._id as Types.ObjectId;
    }
    const current = await this.sessions.findOne({ instituteId: this.iid(user), current: true }).select('_id').lean();
    if (!current) throw new BadRequestException('No academic session is active. Activate a session first.');
    return current._id as Types.ObjectId;
  }

  async ensureSession(user: AuthUser, body: { month?: string; year?: number | string }) {
    this.requireDealing(user);
    const month = text(body?.month, 40);
    const year = Number(body?.year);
    if (!month) throw new BadRequestException('Exam month is required');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Exam year is invalid');
    const found = await this.sessions.findOne({ instituteId: this.iid(user), month, year }).lean();
    if (found) return found;
    return this.sessions.create({ instituteId: this.iid(user), month, year, current: false });
  }

  async meta(user: AuthUser) {
    const iid = this.iid(user);
    const scope = this.courseScope(user);
    const courseFilter: Record<string, unknown> = { instituteId: iid, active: { $ne: false } };
    if (scope) courseFilter._id = { $in: scope };
    const [sessions, courses, examTypes, dealings] = await Promise.all([
      this.sessions.find({ instituteId: iid }).sort({ year: -1, createdAt: -1 }).lean(),
      this.courses.find(courseFilter).sort({ name: 1 }).lean(),
      this.examTypes.find({ instituteId: iid }).sort({ name: 1 }).lean(),
      this.users
        .find({ instituteId: iid, role: UserRole.DEALING })
        .select('name email')
        .sort({ name: 1 })
        .lean(),
    ]);
    const specialities = await this.specialities
      .find({ instituteId: iid, courseId: { $in: courses.map((c) => c._id) } })
      .sort({ name: 1 })
      .lean();
    const current = sessions.find((s) => s.current);
    return {
      sessions: sessions.map((s) => ({ _id: s._id, month: s.month, year: s.year, current: !!s.current })),
      currentSessionId: current?._id || null,
      courses: courses.map((c) => ({ _id: c._id, name: c.name })),
      specialities: specialities.map((s) => ({ _id: s._id, name: s.name, courseId: s.courseId })),
      examTypes: examTypes.map((e) => ({ _id: e._id, name: e.name })),
      dealings: this.isDealing(user)
        ? dealings.filter((d) => String(d._id) === user.userId).map((d) => ({ _id: d._id, name: d.name }))
        : dealings.map((d) => ({ _id: d._id, name: d.name })),
      types: PRACTICAL_EXAMINER_TYPES,
      statusLabels: PRACTICAL_STATUS_LABELS,
      can: {
        edit: this.isDealing(user),
        vet: this.isDean(user),
      },
      scopeNote:
        this.isDean(user) && !courses.length
          ? 'No courses are mapped to your login. Ask the Institute Admin to tick your courses under Masters → Staff.'
          : null,
    };
  }

  async listLookups(user: AuthUser) {
    const iid = this.iid(user);
    const [rows, depts] = await Promise.all([
      this.lookups.find({ instituteId: iid }).sort({ name: 1 }).lean(),
      this.departments.find({ instituteId: iid, active: { $ne: false } }).select('name').lean(),
    ]);
    const out: Record<string, string[]> = { DESIGNATION: [], DEPARTMENT: [], SCHEDULE: [] };
    for (const r of rows) (out[r.kind] ||= []).push(r.name);
    const deptNames = new Set([...out.DEPARTMENT, ...depts.map((d) => d.name)]);
    out.DEPARTMENT = [...deptNames].sort((a, b) => a.localeCompare(b));
    return out;
  }

  async addLookup(user: AuthUser, body: { kind?: string; name?: string }) {
    this.requireDealing(user);
    const kind = text(body?.kind, 30).toUpperCase();
    const name = text(body?.name, 160);
    if (!LOOKUP_KINDS.has(kind)) throw new BadRequestException('Unknown list');
    if (!name) throw new BadRequestException('Name is required');
    await this.lookups.updateOne(
      { instituteId: this.iid(user), kind, name },
      { $setOnInsert: { instituteId: this.iid(user), kind, name } },
      { upsert: true },
    );
    return { kind, name };
  }

  async addSpeciality(user: AuthUser, body: { courseId?: string; name?: string }) {
    this.requireDealing(user);
    const courseId = oid(body?.courseId, 'Course');
    const name = text(body?.name, 160);
    if (!name) throw new BadRequestException('Speciality name is required');
    const course = await this.courses.findOne({ _id: courseId, instituteId: this.iid(user) }).lean();
    if (!course) throw new BadRequestException('Course not found');
    const clash = await this.specialities
      .findOne({ instituteId: this.iid(user), courseId, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      .lean();
    if (clash) throw new BadRequestException('This speciality already exists for the course');
    const row = await this.specialities.create({ instituteId: this.iid(user), courseId, name });
    return { _id: row._id, name: row.name, courseId: row.courseId };
  }

  async renameSpeciality(user: AuthUser, id: string, body: { name?: string }) {
    this.requireDealing(user);
    const name = text(body?.name, 160);
    if (!name) throw new BadRequestException('Speciality name is required');
    const row = await this.specialities.findOne({ _id: oid(id, 'Speciality'), instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('Speciality not found');
    row.name = name;
    await row.save();
    return { _id: row._id, name: row.name, courseId: row.courseId };
  }

  // ---------- schedule (top half of Appointment of Examiner) ----------

  async getSchedule(user: AuthUser, q: { sessionId?: string; specialityId?: string }) {
    if (!q.specialityId || !Types.ObjectId.isValid(q.specialityId)) return null;
    const sessionId = await this.resolveSessionId(user, q.sessionId);
    return this.schedules
      .findOne({ instituteId: this.iid(user), sessionId, specialityId: new Types.ObjectId(q.specialityId) })
      .lean();
  }

  async saveSchedule(user: AuthUser, body: Record<string, unknown>) {
    this.requireDealing(user);
    const iid = this.iid(user);
    const sessionId = await this.resolveSessionId(user, body.sessionId as string);
    const courseId = oid(body.courseId, 'Course');
    const specialityId = oid(body.specialityId, 'Speciality');
    const speciality = await this.specialities.findOne({ _id: specialityId, instituteId: iid }).lean();
    if (!speciality) throw new BadRequestException('Speciality not found');
    if (speciality.courseId && String(speciality.courseId) !== String(courseId)) {
      throw new BadRequestException('Speciality does not belong to the selected course');
    }
    if (!this.inCourseScope(user, courseId)) throw new ForbiddenException('This course is not mapped to your login');

    const department = text(body.department, 160);
    const subjectCode = text(body.subjectCode, 40);
    const tentativeSchedule = text(body.tentativeSchedule, 160);
    const totalStudents = optionalNumber(body.totalStudents, 'Total Student');
    if (!department) throw new BadRequestException('Department is required');
    if (!subjectCode) throw new BadRequestException('Subject Code is required');
    if (!totalStudents) throw new BadRequestException('Total Student is required');
    if (!tentativeSchedule) throw new BadRequestException('Tentative Practical Schedule is required');

    let examTypeId: Types.ObjectId | undefined;
    let examName: string | undefined;
    if (body.examTypeId && Types.ObjectId.isValid(String(body.examTypeId))) {
      const et = await this.examTypes.findOne({ _id: body.examTypeId, instituteId: iid }).lean();
      if (!et) throw new BadRequestException('Exam name not found');
      examTypeId = et._id as Types.ObjectId;
      examName = et.name;
    }

    const set = {
      courseId,
      department,
      subjectCode,
      totalStudents,
      totalMarks: optionalNumber(body.totalMarks, 'Total marks'),
      pageNoInternal: optionalNumber(body.pageNoInternal, 'Page no. (internal)'),
      pageNoExternal: optionalNumber(body.pageNoExternal, 'Page no. (external)'),
      tentativeSchedule,
      examTypeId,
      examName,
    };
    const row = await this.schedules.findOneAndUpdate(
      { instituteId: iid, sessionId, specialityId },
      { $set: set, $setOnInsert: { instituteId: iid, sessionId, specialityId } },
      { upsert: true, new: true },
    );
    // Keep examiners pointing at the board's course if the schedule course was corrected.
    await this.examiners.updateMany({ scheduleId: row._id }, { $set: { courseId } });
    return row;
  }

  // ---------- examiners ----------

  private async decorate(rows: any[]) {
    const ids = (key: string) => [...new Set(rows.map((r) => String(r[key] || '')).filter(Boolean))];
    const [courses, specs, sessions, users, schedules] = await Promise.all([
      this.courses.find({ _id: { $in: ids('courseId') } }).select('name').lean(),
      this.specialities.find({ _id: { $in: ids('specialityId') } }).select('name').lean(),
      this.sessions.find({ _id: { $in: ids('sessionId') } }).select('month year').lean(),
      this.users.find({ _id: { $in: ids('dealingUserId') } }).select('name').lean(),
      this.schedules.find({ _id: { $in: ids('scheduleId') } }).lean(),
    ]);
    const byId = <T extends { _id: unknown }>(list: T[]) => new Map(list.map((x) => [String(x._id), x]));
    const cm = byId(courses);
    const sm = byId(specs);
    const ssm = byId(sessions);
    const um = byId(users);
    const schm = byId(schedules);
    return rows.map((r) => {
      const session = ssm.get(String(r.sessionId)) as any;
      const schedule = schm.get(String(r.scheduleId)) as any;
      const { bank, history, ...rest } = r;
      return {
        ...rest,
        hasBank: !!bank?.account,
        courseName: (cm.get(String(r.courseId)) as any)?.name || '',
        specialityName: (sm.get(String(r.specialityId)) as any)?.name || '',
        sessionLabel: session ? `${session.month} ${session.year}` : '',
        examMonth: session?.month || '',
        examYear: session?.year || '',
        dealingName: (um.get(String(r.dealingUserId)) as any)?.name || '',
        typeLabel: practicalTypeLabel(r.type),
        statusLabel: PRACTICAL_STATUS_LABELS[r.status] || r.status,
        subjectCode: schedule?.subjectCode || '',
        practicalDate: schedule?.practicalDate || '',
        tentativeSchedule: schedule?.tentativeSchedule || '',
        lastRemark: [...(history || [])].reverse().find((h: any) => h.remark)?.remark || '',
      };
    });
  }

  private sortRows(rows: any[]) {
    return rows.sort(
      (a, b) =>
        a.courseName.localeCompare(b.courseName) ||
        a.specialityName.localeCompare(b.specialityName) ||
        (TYPE_ORDER.get(a.type) || 9) - (TYPE_ORDER.get(b.type) || 9) ||
        a.name.localeCompare(b.name),
    );
  }

  async list(
    user: AuthUser,
    q: { view?: string; sessionId?: string; courseId?: string; specialityId?: string; dealingId?: string; scheduleId?: string },
  ) {
    const view = PRACTICAL_VIEWS[q.view || 'assigned'];
    if (!view) throw new BadRequestException('Unknown list');
    const filter: Record<string, unknown> = this.scopeFilter(user, q.dealingId);
    filter.sessionId = await this.resolveSessionId(user, q.sessionId);
    if (q.courseId && Types.ObjectId.isValid(q.courseId)) {
      if (!this.inCourseScope(user, q.courseId)) return [];
      filter.courseId = new Types.ObjectId(q.courseId);
    }
    if (q.specialityId && Types.ObjectId.isValid(q.specialityId)) filter.specialityId = new Types.ObjectId(q.specialityId);
    if (q.scheduleId && Types.ObjectId.isValid(q.scheduleId)) filter.scheduleId = new Types.ObjectId(q.scheduleId);
    if (view.statuses) filter.status = { $in: view.statuses };
    if (view.chairOnly) filter.type = { $in: [PracticalExaminerType.CHAIRPERSON, PracticalExaminerType.COORDINATOR] };
    if (view.airOnly) filter.airBooking = { $exists: true, $ne: null };
    const rows = await this.examiners.find(filter).lean();
    return this.sortRows(await this.decorate(rows));
  }

  /** Download Examiner Details: every examiner ever entered, across sessions, optionally by type. */
  async history(user: AuthUser, q: { type?: string }) {
    const filter: Record<string, unknown> = this.scopeFilter(user);
    if (q.type && TYPE_CODES.has(q.type)) filter.type = q.type;
    const [rows, details] = await Promise.all([
      this.examiners.find(filter).sort({ createdAt: -1 }).limit(5000).lean(),
      this.details.find(filter).sort({ createdAt: -1 }).limit(5000).lean(),
    ]);
    const merged = [...(await this.decorate(details)).map((r) => ({ ...r, source: 'detail' })), ...(await this.decorate(rows))];
    return merged.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Add from Download Examiner Details: exam month/year + course, no speciality board. */
  async createDetail(user: AuthUser, body: Record<string, unknown>) {
    this.requireDealing(user);
    const iid = this.iid(user);
    const session = await this.ensureSession(user, { month: body.month as string, year: body.year as string });
    const courseId = oid(body.courseId, 'Course');
    if (!(await this.courses.exists({ _id: courseId, instituteId: iid }))) throw new BadRequestException('Course not found');
    if (!this.inCourseScope(user, courseId)) throw new ForbiddenException('This course is not mapped to your login');
    const fields = this.examinerFields(body, { requireAll: true });
    const clash = await this.details
      .findOne({ instituteId: iid, sessionId: session._id, courseId, type: fields.type, email: fields.email })
      .lean();
    if (clash) throw new BadRequestException(`${clash.name} (${clash.email}) is already added for this exam month and course`);
    const facultyId =
      body.facultyId && Types.ObjectId.isValid(String(body.facultyId)) ? new Types.ObjectId(String(body.facultyId)) : undefined;
    const row = await this.details.create({
      ...fields,
      facultyId,
      instituteId: iid,
      sessionId: session._id,
      courseId,
      dealingUserId: new Types.ObjectId(user.userId),
    });
    return this.getDetail(user, String(row._id));
  }

  async getDetail(user: AuthUser, id: string) {
    const row = await this.details.findById(oid(id, 'Examiner')).lean();
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    const [decorated] = await this.decorate([row]);
    return { ...decorated, source: 'detail', statusLabel: '' };
  }

  async updateDetail(user: AuthUser, id: string, body: Record<string, unknown>) {
    this.requireDealing(user);
    const row = await this.details.findById(oid(id, 'Examiner'));
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    Object.assign(row, this.examinerFields({ type: row.type, ...body }, { requireAll: true }));
    await row.save();
    return this.getDetail(user, id);
  }

  async counts(user: AuthUser, q: { sessionId?: string }) {
    const filter: Record<string, unknown> = this.scopeFilter(user);
    try {
      filter.sessionId = await this.resolveSessionId(user, q.sessionId);
    } catch {
      return {};
    }
    const grouped = await this.examiners.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const byStatus = new Map<string, number>(grouped.map((g: any) => [g._id, g.n]));
    const out: Record<string, number> = {};
    for (const [key, view] of Object.entries(PRACTICAL_VIEWS)) {
      if (!view.statuses || view.chairOnly) continue;
      out[key] = view.statuses.reduce((sum, s) => sum + (byStatus.get(s) || 0), 0);
    }
    return out;
  }

  async getOne(user: AuthUser, id: string) {
    const row = await this.examiners.findById(oid(id, 'Examiner')).lean();
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    const [decorated] = await this.decorate([row]);
    return { ...decorated, bank: row.bank || null, history: row.history || [] };
  }

  /** Name picker source: faculty for Chair/Internal/Observer/Coordinator, past externals + pool for External. */
  async suggestions(user: AuthUser, q: { type?: string }) {
    const iid = this.iid(user);
    if (q.type === PracticalExaminerType.EXTERNAL) {
      const [pastBoards, pastDetails, pool] = await Promise.all([
        this.examiners
          .find({ instituteId: iid, type: PracticalExaminerType.EXTERNAL })
          .sort({ createdAt: -1 })
          .limit(2000)
          .lean(),
        this.details
          .find({ instituteId: iid, type: PracticalExaminerType.EXTERNAL })
          .sort({ createdAt: -1 })
          .limit(2000)
          .lean(),
        this.pool.find({ instituteId: iid }).sort({ name: 1 }).lean(),
      ]);
      const seen = new Set<string>();
      const out: any[] = [];
      for (const p of [...pastDetails, ...pastBoards]) {
        if (seen.has(p.email)) continue;
        seen.add(p.email);
        out.push({
          key: `past:${p._id}`,
          name: p.name,
          designation: p.designation,
          department: p.department,
          instituteName: p.instituteName,
          instituteAddress: p.instituteAddress,
          city: p.city,
          mobile: p.mobile,
          email: p.email,
          alternateMobile: p.alternateMobile,
          alternateEmail: p.alternateEmail,
        });
      }
      for (const p of pool) {
        if (seen.has(p.email)) continue;
        seen.add(p.email);
        out.push({
          key: `pool:${p._id}`,
          name: p.name,
          designation: p.designation,
          department: p.department,
          instituteName: p.affiliation,
          instituteAddress: p.address,
          city: p.city,
          mobile: p.mobile,
          email: p.email,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    const [rows, depts, entered] = await Promise.all([
      this.faculty.find({ instituteId: iid }).sort({ name: 1 }).lean(),
      this.departments.find({ instituteId: iid }).select('name').lean(),
      q.type && TYPE_CODES.has(q.type)
        ? this.details.find({ instituteId: iid, type: q.type }).sort({ createdAt: -1 }).limit(2000).lean()
        : Promise.resolve([] as (PracticalExaminerDetail & { _id: Types.ObjectId })[]),
    ]);
    const deptName = new Map(depts.map((d) => [String(d._id), d.name]));
    // Faculty first, then people added from Download Examiner Details who are not faculty.
    const seen = new Set(rows.map((f) => String(f.email || '').toLowerCase()).filter(Boolean));
    const extra = entered
      .filter((p) => !seen.has(p.email) && (seen.add(p.email), true))
      .map((p) => ({
        key: `detail:${p._id}`,
        facultyId: p.facultyId,
        name: p.name,
        designation: p.designation,
        department: p.department,
        instituteName: p.instituteName,
        instituteAddress: p.instituteAddress,
        city: p.city,
        mobile: p.mobile,
        email: p.email,
        alternateMobile: p.alternateMobile,
        alternateEmail: p.alternateEmail,
      }));
    const faculty = rows.map((f) => ({
      key: `faculty:${f._id}`,
      facultyId: f._id,
      name: f.name,
      designation: f.designation,
      department: f.departmentId ? deptName.get(String(f.departmentId)) : '',
      mobile: f.mobile,
      email: f.email,
      alternateMobile: f.alternateMobile,
      alternateEmail: f.alternateEmail,
      city: f.city,
    }));
    return [...faculty, ...extra];
  }

  private examinerFields(body: Record<string, unknown>, opts: { requireAll: boolean }) {
    const type = text(body.type, 30).toUpperCase();
    const out: Record<string, unknown> = {
      type,
      name: text(body.name, 160),
      designation: text(body.designation, 160),
      department: text(body.department, 160),
      instituteName: text(body.instituteName, 200),
      instituteAddress: text(body.instituteAddress, 300),
      city: text(body.city, 80),
      mobile: cleanMobile(body.mobile as string),
      email: normalizeEmail(body.email),
      alternateMobile: cleanMobile(body.alternateMobile as string),
      alternateEmail: normalizeEmail(body.alternateEmail),
      salaryCode: text(body.salaryCode, 40),
    };
    if (!opts.requireAll) return out;
    if (!TYPE_CODES.has(type)) throw new BadRequestException('Select an Examiner Type');
    if (!out.name) throw new BadRequestException('Name of Examiner is required');
    if (!out.designation) throw new BadRequestException('Designation is required');
    if (!out.department) throw new BadRequestException('Department is required');
    if (!out.instituteName) throw new BadRequestException('Institute Name is required');
    if (!out.instituteAddress) throw new BadRequestException('Institute Address is required');
    if (!isValidMobile(out.mobile)) throw new BadRequestException('Mobile No. must be a 10-digit number starting with 6, 7, 8 or 9');
    if (!isValidEmail(out.email)) throw new BadRequestException('Please enter valid email e.g abc@domain.com');
    if (out.alternateMobile && !isValidMobile(out.alternateMobile)) {
      throw new BadRequestException('Alternate Mobile must be a 10-digit number starting with 6, 7, 8 or 9');
    }
    if (out.alternateEmail && !isValidEmail(out.alternateEmail)) throw new BadRequestException('Alternate email is not valid');
    if (type === PracticalExaminerType.EXTERNAL && !out.city) throw new BadRequestException('Please enter City Name.');
    return out;
  }

  private async assertNotDuplicate(scheduleId: Types.ObjectId, email: string, exceptId?: unknown) {
    const clash = await this.examiners
      .findOne({
        scheduleId,
        email,
        status: { $ne: S.REGRETTED },
        ...(exceptId ? { _id: { $ne: exceptId } } : {}),
      })
      .lean();
    if (clash) throw new BadRequestException(`${clash.name} (${email}) is already on this board`);
  }

  async create(user: AuthUser, body: Record<string, unknown>) {
    this.requireDealing(user);
    const schedule = await this.schedules.findOne({ _id: oid(body.scheduleId, 'Speciality schedule'), instituteId: this.iid(user) });
    if (!schedule) throw new BadRequestException('Save the speciality details (Update) before adding examiners');
    const fields = this.examinerFields(body, { requireAll: true });
    await this.assertNotDuplicate(schedule._id as Types.ObjectId, fields.email as string);
    const facultyId =
      body.facultyId && Types.ObjectId.isValid(String(body.facultyId)) ? new Types.ObjectId(String(body.facultyId)) : undefined;
    const row = await this.examiners.create({
      ...fields,
      facultyId,
      instituteId: this.iid(user),
      sessionId: schedule.sessionId,
      scheduleId: schedule._id,
      courseId: schedule.courseId,
      specialityId: schedule.specialityId,
      dealingUserId: new Types.ObjectId(user.userId),
      status: S.PENDING,
      history: [this.historyEvent(user, S.PENDING, 'Examiner added')],
    });
    return this.getOne(user, String(row._id));
  }

  async update(user: AuthUser, id: string, body: Record<string, unknown>) {
    this.requireDealing(user);
    const row = await this.examiners.findById(oid(id, 'Examiner'));
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    const fields = this.examinerFields({ type: row.type, ...body }, { requireAll: true });
    if (fields.type !== row.type && row.status !== S.PENDING) {
      throw new BadRequestException('Examiner type can only be changed before sending to the Assoc. Dean');
    }
    await this.assertNotDuplicate(row.scheduleId, fields.email as string, row._id);
    Object.assign(row, fields);
    if (body.bank && typeof body.bank === 'object') {
      const b = body.bank as Record<string, unknown>;
      const ifsc = text(b.ifsc, 20).toUpperCase();
      const pan = text(b.pan, 20).toUpperCase();
      if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new BadRequestException('IFSC code is not valid');
      if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new BadRequestException('PAN is not valid');
      row.bank = {
        ...(row.bank || {}),
        holderName: text(b.holderName, 160),
        bankName: text(b.bankName, 160),
        branch: text(b.branch, 200),
        ifsc,
        accountType: text(b.accountType, 40),
        account: text(b.account, 40),
        pan,
      };
      row.markModified('bank');
    }
    await row.save();
    return this.getOne(user, id);
  }

  async remove(user: AuthUser, id: string) {
    this.requireDealing(user);
    const row = await this.examiners.findById(oid(id, 'Examiner'));
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    if (!DELETABLE.has(row.status)) {
      throw new BadRequestException(
        `Cannot delete while "${PRACTICAL_STATUS_LABELS[row.status]}". Only pending, Dean-rejected or regretted examiners can be deleted.`,
      );
    }
    await this.examiners.deleteOne({ _id: row._id });
    await this.tasks.removeFor(row._id);
    return { ok: true };
  }

  async removeMany(user: AuthUser, body: { ids?: string[] }): Promise<BulkResult> {
    this.requireDealing(user);
    const result: BulkResult = { updated: 0, skipped: [] };
    for (const id of this.idList(body)) {
      try {
        await this.remove(user, id);
        result.updated += 1;
      } catch (err: any) {
        result.skipped.push({ id, name: '', reason: err?.message || 'Failed' });
      }
    }
    return result;
  }

  // ---------- status transitions ----------

  private idList(body: { ids?: unknown }) {
    const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter((x) => Types.ObjectId.isValid(x)) : [];
    if (!ids.length) throw new BadRequestException('Select at least one examiner');
    return [...new Set(ids)];
  }

  private async transition(
    user: AuthUser,
    ids: string[],
    from: string[],
    to: string,
    remark?: string,
    extra?: (row: PracticalExaminerDocument) => void,
  ): Promise<BulkResult> {
    const result: BulkResult = { updated: 0, skipped: [] };
    const rows = await this.examiners.find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } });
    const found = new Set(rows.map((r) => String(r._id)));
    for (const id of ids) if (!found.has(id)) result.skipped.push({ id, name: '', reason: 'Not found' });
    for (const row of rows) {
      try {
        this.assertInScope(user, row);
      } catch (err: any) {
        result.skipped.push({ id: String(row._id), name: row.name, reason: err.message });
        continue;
      }
      if (!from.includes(row.status)) {
        result.skipped.push({
          id: String(row._id),
          name: row.name,
          reason: `Status is "${PRACTICAL_STATUS_LABELS[row.status] || row.status}"`,
        });
        continue;
      }
      // Conditional update so two people acting at once cannot both move the same row.
      const update: Record<string, unknown> = {
        $set: { status: to },
        $push: { history: this.historyEvent(user, to, remark) },
      };
      if (extra) {
        extra(row);
        const modified = row.modifiedPaths().filter((p) => p !== 'status' && p !== 'history');
        for (const p of modified) (update.$set as Record<string, unknown>)[p] = row.get(p);
      }
      const res = await this.examiners.updateOne({ _id: row._id, status: row.status }, update);
      if (res.modifiedCount) result.updated += 1;
      else result.skipped.push({ id: String(row._id), name: row.name, reason: 'Changed by someone else; refresh' });
    }
    return result;
  }

  async sendToDean(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.transition(user, this.idList(body), [S.PENDING], S.WITH_DEAN, 'Sent to Assoc. Dean');
  }

  async vet(user: AuthUser, body: { ids?: string[]; decision?: string; remark?: string }) {
    this.requireDean(user);
    const decision = text(body?.decision, 10).toUpperCase();
    if (!VET_TO[decision]) throw new BadRequestException('Decision must be APPROVE, HOLD or REJECT');
    const remark = text(body?.remark, 500);
    if (decision === 'REJECT' && !remark) throw new BadRequestException('Give a reason for rejection');
    const label = { APPROVE: 'Approved and sent to Dealing', HOLD: 'Held', REJECT: 'Rejected' }[decision];
    return this.transition(
      user,
      this.idList(body),
      VET_FROM[decision],
      VET_TO[decision],
      remark ? `${label}: ${remark}` : label,
      (row) => {
        if (decision === 'APPROVE') row.approvedBy = { userId: user.userId, name: user.name, at: new Date() };
      },
    );
  }

  /** Assign Examiner page: Dealing rejects an examiner at any stage with a reason (old status 7). */
  async reject(user: AuthUser, id: string, body: { reason?: string }) {
    this.requireDealing(user);
    const reason = text(body?.reason, 500);
    if (!reason) throw new BadRequestException('Enter the reason for rejection');
    const from = Object.values(S).filter((s) => s !== S.REGRETTED);
    const result = await this.transition(user, [oid(id, 'Examiner').toString()], from, S.REGRETTED, `Rejected by Dealing: ${reason}`, (row) => {
      row.rejectReason = reason;
    });
    if (!result.updated) throw new BadRequestException(result.skipped[0]?.reason || 'Could not reject');
    return result;
  }

  async saveRemarks(user: AuthUser, id: string, body: { remarks?: string }) {
    this.requireDealing(user);
    const row = await this.examiners.findById(oid(id, 'Examiner'));
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    row.remarks = text(body?.remarks, 500);
    await row.save();
    return { ok: true };
  }

  // ---------- P3: offer letters ----------

  private offerPurpose(type: string) {
    return type === PracticalExaminerType.COORDINATOR ? PracticalMail.OFFER_COORDINATOR : PracticalMail.OFFER;
  }

  /**
   * Mail first, then move status, row by row. A failed mail leaves the examiner where they were so
   * the Dealing user can retry; it never marks an offer as sent when it was not.
   */
  private async mailEach(
    user: AuthUser,
    ids: string[],
    from: string[],
    work: (row: PracticalExaminerDocument) => Promise<{ to?: string; remark: string; set?: Record<string, unknown>; push?: Record<string, unknown> }>,
  ): Promise<BulkResult> {
    const result: BulkResult = { updated: 0, skipped: [] };
    const rows = await this.examiners.find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } });
    const found = new Set(rows.map((r) => String(r._id)));
    for (const id of ids) if (!found.has(id)) result.skipped.push({ id, name: '', reason: 'Not found' });
    for (const row of rows) {
      const skip = (reason: string) => result.skipped.push({ id: String(row._id), name: row.name, reason });
      try {
        this.assertInScope(user, row);
      } catch (err: any) {
        skip(err.message);
        continue;
      }
      if (!from.includes(row.status)) {
        skip(`Status is "${PRACTICAL_STATUS_LABELS[row.status] || row.status}"`);
        continue;
      }
      try {
        const out = await work(row);
        const update: Record<string, any> = {
          $set: { ...(out.to ? { status: out.to } : {}), ...(out.set || {}) },
          $push: { history: this.historyEvent(user, out.to || row.status, out.remark), ...(out.push || {}) },
        };
        await this.examiners.updateOne({ _id: row._id, status: row.status }, update);
        result.updated += 1;
      } catch (err: any) {
        skip(err?.message || 'Mail could not be sent');
      }
    }
    return result;
  }

  async sendOffer(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.DEAN_APPROVED], async (row) => {
      const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.OFFER);
      await this.mail.send(row, this.offerPurpose(row.type), { taskLink: this.tasks.linkFor(token) });
      return { to: S.OFFER_SENT, remark: `Offer letter sent to ${row.email}`, set: { 'offer.sentAt': new Date() } };
    });
  }

  async resendOffer(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.OFFER_SENT], async (row) => {
      const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.OFFER);
      await this.mail.send(row, this.offerPurpose(row.type), { taskLink: this.tasks.linkFor(token) });
      return { remark: `Offer letter re-sent to ${row.email}`, push: { 'offer.resentAt': new Date() } };
    });
  }

  /**
   * "Send to Examiner with Regret": offer to the replacement, and tell the rest of the board who
   * regretted and who replaces them (old InformationLetter).
   */
  async replacementOffer(user: AuthUser, body: { ids?: string[]; regrettedName?: string }) {
    this.requireDealing(user);
    const regrettedName = text(body?.regrettedName, 160);
    if (!regrettedName) throw new BadRequestException('Enter the name of the examiner who regretted');
    return this.mailEach(user, this.idList(body), [S.DEAN_APPROVED], async (row) => {
      const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.OFFER);
      await this.mail.send(row, this.offerPurpose(row.type), { taskLink: this.tasks.linkFor(token) });
      const board = await this.examiners
        .find({ scheduleId: row.scheduleId, status: { $nin: [S.DEAN_HELD, S.REGRETTED] } })
        .lean();
      const table = this.mail.boardTable(board);
      let informed = 0;
      for (const member of board) {
        if (String(member._id) === String(row._id) || member.email === row.email) continue;
        try {
          await this.mail.send(
            member as any,
            PracticalMail.REPLACEMENT_INFO,
            {
              regrettedExaminer: regrettedName,
              newExaminer: row.name,
              newExaminerType: practicalTypeLabel(row.type),
              boardTable: table,
            },
          );
          informed += 1;
        } catch {
          // One failed info mail must not block the replacement offer.
        }
      }
      return {
        to: S.OFFER_SENT,
        remark: `Replacement offer for ${regrettedName}; board informed (${informed})`,
        set: { 'offer.sentAt': new Date() },
      };
    });
  }

  /** Letter kinds that can be previewed / printed, and the mail purpose behind each. */
  private letterPurpose(kind: string, type: string): string | null {
    const map: Record<string, string> = {
      offer: this.offerPurpose(type),
      appointment: PracticalMail.APPOINTMENT,
      accepted: PracticalMail.ACCEPTED,
      regretted: PracticalMail.REGRETTED,
      'date-request': isPracticalChair(type) ? PracticalMail.DATE_REQUEST_CHAIR : PracticalMail.DATE_REQUEST_ALL,
      'date-reminder': PracticalMail.DATE_REMINDER,
      'date-fixed': PracticalMail.DATE_FIXED,
    };
    return map[kind] || null;
  }

  private async letterFor(row: PracticalExaminer & { _id: unknown }, kind: string) {
    const purpose = this.letterPurpose(kind, row.type);
    if (!purpose) throw new BadRequestException('Unknown letter');
    const offerToken = await this.tasks.ensureToken(row, PracticalTokenPurpose.OFFER);
    const portalToken = await this.tasks.ensureToken(row, PracticalTokenPurpose.PORTAL);
    return this.mail.preview(row, purpose, {
      taskLink: this.tasks.linkFor(offerToken),
      portalLink: this.tasks.portalLinkFor(portalToken),
      requestDate: row.dateMail?.requestedAt ? new Date(row.dateMail.requestedAt).toLocaleDateString('en-GB') : '',
    });
  }

  /** Letter preview for the row actions ("Offer Letter", "Appointment Letter" ...). */
  async letter(user: AuthUser, id: string, kind: string) {
    const row = await this.examiners.findById(oid(id, 'Examiner')).lean();
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    return this.letterFor(row, kind);
  }

  /** Download Assigned / Approved / Accepted Letter: many letters for printing in one go. */
  async lettersBulk(user: AuthUser, body: { ids?: string[]; kind?: string }) {
    const ids = this.idList(body).slice(0, 300);
    const kind = text(body?.kind, 30);
    const rows = await this.examiners.find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } }).lean();
    const out: { id: string; name: string; subject: string; body: string }[] = [];
    for (const row of this.sortRows(await this.decorate(rows))) {
      const raw = rows.find((r) => String(r._id) === String(row._id))!;
      try {
        this.assertInScope(user, raw);
      } catch {
        continue;
      }
      const l = await this.letterFor(raw, kind);
      out.push({ id: String(row._id), name: row.name, subject: l.subject, body: l.body });
    }
    return out;
  }

  // ---------- P4: appointment letter + portal ----------

  async appoint(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.ACCEPTED], async (row) => {
      const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.PORTAL);
      await this.mail.send(row, PracticalMail.APPOINTMENT, { portalLink: this.tasks.portalLinkFor(token) });
      return { to: S.APPOINTED, remark: `Appointment letter sent to ${row.email}`, set: { 'appointment.sentAt': new Date() } };
    });
  }

  async resendAppointment(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.APPOINTED], async (row) => {
      const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.PORTAL);
      await this.mail.send(row, PracticalMail.APPOINTMENT, { portalLink: this.tasks.portalLinkFor(token) });
      return { remark: `Appointment letter re-sent to ${row.email}`, push: { 'appointment.resentAt': new Date() } };
    });
  }

  /** "Select Mail Title" list: built-in mails plus the institute's own practical templates. */
  async mailTemplates(user: AuthUser) {
    const custom = await this.templates
      .find({ instituteId: this.iid(user), channel: 'EMAIL', active: true, purpose: /^PRACTICAL_/ })
      .select('name purpose')
      .lean();
    const builtIn = new Set<string>(Object.values(PracticalMail));
    return [
      ...SENDABLE_PRACTICAL_MAILS,
      ...custom.filter((t) => t.purpose && !builtIn.has(t.purpose)).map((t) => ({ purpose: t.purpose as string, name: t.name })),
    ];
  }

  async sendTemplateMail(user: AuthUser, body: { ids?: string[]; purpose?: string }) {
    this.requireDealing(user);
    const purpose = text(body?.purpose, 80);
    const allowed = await this.mailTemplates(user);
    const pick = allowed.find((t) => t.purpose === purpose);
    if (!pick) throw new BadRequestException('Select a Mail Title');
    return this.mailEach(user, this.idList(body), [S.APPOINTED], async (row) => {
      const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.PORTAL);
      await this.mail.send(row, purpose, { portalLink: this.tasks.portalLinkFor(token) });
      return { remark: `Mail sent: ${pick.name}` };
    });
  }

  // ---------- P5: Chairperson practical date ----------

  private async portalMail(row: PracticalExaminer & { _id: unknown }, purpose: string, extra: Record<string, string> = {}) {
    const token = await this.tasks.ensureToken(row, PracticalTokenPurpose.PORTAL);
    return this.mail.send(row, purpose, { portalLink: this.tasks.portalLinkFor(token), ...extra });
  }

  private async appointedBoard(scheduleId: unknown) {
    return this.examiners.find({ scheduleId, status: S.APPOINTED }).lean();
  }

  /** "Practical Date Chairperson and All Examiner": ask the chair to fix the date, inform the rest of the board. */
  async dateRequest(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.APPOINTED], async (row) => {
      if (!isPracticalChair(row.type)) throw new Error('Not a Chairperson / Exam Coordinator');
      await this.portalMail(row, PracticalMail.DATE_REQUEST_CHAIR);
      let informed = 0;
      for (const m of await this.appointedBoard(row.scheduleId)) {
        if (String(m._id) === String(row._id) || isPracticalChair(m.type)) continue;
        try {
          await this.portalMail(m as any, PracticalMail.DATE_REQUEST_ALL);
          informed += 1;
        } catch {
          // A failed member mail does not stop the chair request.
        }
      }
      const state = row.dateMail?.state === PracticalDateMail.FIXED ? PracticalDateMail.FIXED : PracticalDateMail.REQUESTED;
      return {
        remark: `Practical date requested from Chairperson; ${informed} examiner(s) informed`,
        set: { 'dateMail.state': state, 'dateMail.requestedAt': new Date() },
      };
    });
  }

  async dateReminder(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.APPOINTED], async (row) => {
      if (!isPracticalChair(row.type)) throw new Error('Not a Chairperson / Exam Coordinator');
      const schedule = await this.schedules.findById(row.scheduleId).lean();
      if (schedule?.practicalDate) throw new Error(`Practical date already fixed (${schedule.practicalDate})`);
      if (!row.dateMail?.requestedAt) throw new Error('Send "Practical Date Chairperson and All Examiner" first');
      await this.portalMail(row, PracticalMail.DATE_REMINDER, {
        requestDate: new Date(row.dateMail.requestedAt).toLocaleDateString('en-GB'),
      });
      return { remark: 'Practical date reminder sent to Chairperson', push: { 'dateMail.reminderAt': new Date() } };
    });
  }

  /** "Practical Date Fixed": the date the chair entered is mailed to the whole appointed board. */
  async dateFixed(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.APPOINTED], async (row) => {
      if (!isPracticalChair(row.type)) throw new Error('Not a Chairperson / Exam Coordinator');
      const schedule = await this.schedules.findById(row.scheduleId).lean();
      if (!schedule?.practicalDate) throw new Error('The Chairperson has not entered the practical date on the portal yet');
      let sent = 0;
      for (const m of await this.appointedBoard(row.scheduleId)) {
        try {
          await this.portalMail(m as any, PracticalMail.DATE_FIXED);
          sent += 1;
        } catch {
          // Report the count; a single bounce must not block the others.
        }
      }
      if (!sent) throw new Error('No mail could be sent');
      return {
        remark: `Practical date (${schedule.practicalDate}) sent to ${sent} board member(s)`,
        set: { 'dateMail.state': PracticalDateMail.FIXED, 'dateMail.fixedAt': new Date() },
      };
    });
  }

  // ---------- P7 (Dealing side): air booking ----------

  async ticketRequest(user: AuthUser, body: { ids?: string[] }) {
    this.requireDealing(user);
    return this.mailEach(user, this.idList(body), [S.APPOINTED], async (row) => {
      const b = (row.airBooking || {}) as Record<string, unknown>;
      if (b.status !== PracticalAirStatus.REQUESTED) {
        throw new Error(b.status ? `Booking is "${PRACTICAL_AIR_STATUS_LABELS[b.status as string]}"` : 'No air booking on the portal');
      }
      return {
        remark: 'Ticket request sent to Travel Manager',
        set: { 'airBooking.status': PracticalAirStatus.SENT_TO_TM, 'airBooking.sentToTmAt': new Date() },
      };
    });
  }

  async airRemarks(user: AuthUser, id: string, body: { remarks?: string }) {
    this.requireDealing(user);
    const row = await this.examiners.findById(oid(id, 'Examiner'));
    if (!row) throw new NotFoundException('Examiner not found');
    this.assertInScope(user, row);
    if (!row.airBooking) throw new BadRequestException('No air booking');
    await this.examiners.updateOne({ _id: row._id }, { $set: { 'airBooking.remarks': text(body?.remarks, 500) } });
    return { ok: true };
  }

  // ---------- documents (Upload Previous Question Paper / Upload all Documents) ----------

  async listDocuments(user: AuthUser, q: { kind?: string; sessionId?: string }) {
    const filter: Record<string, unknown> = { instituteId: this.iid(user) };
    if (q.kind === PRACTICAL_QUESTION_PAPER) {
      filter.kind = PRACTICAL_QUESTION_PAPER;
      filter.sessionId = await this.resolveSessionId(user, q.sessionId);
      const scope = this.courseScope(user);
      if (scope) filter.courseId = { $in: scope };
    } else {
      filter.kind = 'DOC';
    }
    const rows = await this.documents.find(filter).sort({ createdAt: -1 }).lean();
    const ids = (k: string) => [...new Set(rows.map((r: any) => String(r[k] || '')).filter(Boolean))];
    const [courses, specs] = await Promise.all([
      this.courses.find({ _id: { $in: ids('courseId') } }).select('name').lean(),
      this.specialities.find({ _id: { $in: ids('specialityId') } }).select('name').lean(),
    ]);
    const cm = new Map(courses.map((c) => [String(c._id), c.name]));
    const sm = new Map(specs.map((s) => [String(s._id), s.name]));
    return rows.map((r) => ({
      _id: r._id,
      kind: r.kind,
      uploadType: r.uploadType,
      typeLabel: r.kind === PRACTICAL_QUESTION_PAPER ? 'Previous Question Paper' : PRACTICAL_DOC_TYPES.find((t) => t.code === r.uploadType)?.label || '',
      courseName: r.courseId ? cm.get(String(r.courseId)) || '' : 'All courses',
      specialityName: r.specialityId ? sm.get(String(r.specialityId)) || '' : '',
      originalName: r.originalName,
      uploadedBy: r.uploadedBy,
      createdAt: (r as any).createdAt,
    }));
  }

  async uploadDocument(user: AuthUser, body: Record<string, unknown>, file?: { path: string; originalName: string }) {
    try {
      this.requireDealing(user);
      if (!file) throw new BadRequestException('Choose a PDF file to upload');
      const iid = this.iid(user);
      const kind = text(body.kind, 30) === PRACTICAL_QUESTION_PAPER ? PRACTICAL_QUESTION_PAPER : 'DOC';
      const key: Record<string, unknown> = { instituteId: iid, kind };
      if (kind === PRACTICAL_QUESTION_PAPER) {
        const courseId = oid(body.courseId, 'Course');
        const specialityId = oid(body.specialityId, 'Speciality');
        if (!this.inCourseScope(user, courseId)) throw new ForbiddenException('This course is not mapped to your login');
        const spec = await this.specialities.findOne({ _id: specialityId, instituteId: iid }).lean();
        if (!spec || String(spec.courseId) !== String(courseId)) throw new BadRequestException('Speciality does not belong to the course');
        Object.assign(key, { courseId, specialityId, sessionId: await this.resolveSessionId(user, body.sessionId as string) });
      } else {
        const uploadType = Number(body.uploadType);
        const def = PRACTICAL_DOC_TYPES.find((t) => t.code === uploadType);
        if (!def) throw new BadRequestException('Select the upload type');
        key.uploadType = uploadType;
        if (def.perCourse) key.courseId = oid(body.courseId, 'Course');
        else key.courseId = null;
      }
      // One file per slot: a new upload replaces the previous one (as in the old screens).
      const previous = await this.documents.find(key).lean();
      const row = await this.documents.create({ ...key, path: file.path, originalName: file.originalName, uploadedBy: user.name });
      for (const p of previous) {
        await this.documents.deleteOne({ _id: p._id });
        await removeUpload(p.path);
      }
      return { _id: row._id };
    } catch (err) {
      await removeUpload(file?.path);
      throw err;
    }
  }

  async removeDocument(user: AuthUser, id: string) {
    this.requireDealing(user);
    const row = await this.documents.findOne({ _id: oid(id, 'Document'), instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('Document not found');
    await this.documents.deleteOne({ _id: row._id });
    await removeUpload(row.path);
    return { ok: true };
  }

  async getDocument(user: AuthUser, id: string) {
    const row = await this.documents.findOne({ _id: oid(id, 'Document'), instituteId: this.iid(user) }).lean();
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  // ---------- Associate Dean signature ----------

  async signature(user: AuthUser) {
    const me = await this.users.findById(user.userId).select('signaturePath').lean();
    return { url: me?.signaturePath ? `/api/uploads/${me.signaturePath}` : null };
  }

  async setSignature(user: AuthUser, file?: { path: string }) {
    try {
      this.requireDean(user);
      if (!file) throw new BadRequestException('Choose a PNG or JPG image of your signature');
      const me = await this.users.findById(user.userId);
      if (!me) throw new NotFoundException('User not found');
      const old = me.signaturePath;
      me.signaturePath = file.path;
      await me.save();
      await removeUpload(old);
      return { url: `/api/uploads/${file.path}` };
    } catch (err) {
      await removeUpload(file?.path);
      throw err;
    }
  }

  /** Board list (for letters): everyone on the speciality except held and regretted. */
  async board(user: AuthUser, scheduleId: string) {
    const rows = await this.examiners
      .find({ instituteId: this.iid(user), scheduleId: oid(scheduleId, 'Schedule'), status: { $nin: [S.DEAN_HELD, S.REGRETTED] } })
      .lean();
    return (await this.decorate(rows)).sort(
      (a, b) => (TYPE_ORDER.get(a.type) || 9) - (TYPE_ORDER.get(b.type) || 9) || a.name.localeCompare(b.name),
    );
  }
}
