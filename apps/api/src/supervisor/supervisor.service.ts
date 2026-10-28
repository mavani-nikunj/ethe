import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SUPERVISOR_SHIFTS,
  SUPERVISOR_STATUS_LABELS,
  SupervisorStatus,
  cleanMobile,
  isValidEmail,
  isValidMobile,
  normalizeEmail,
} from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { Department } from '../database/masters.schema';
import { ExamPaper, ExamShift } from '../database/exam-paper.schema';
import { ExamCandidate } from '../database/exam-candidate.schema';
import { Course, Speciality } from '../database/masters.schema';
import {
  SupervisorAppointment,
  SupervisorLookup,
  SupervisorPerson,
  SupervisorSchedule,
  SupervisorSession,
  SupervisorToken,
} from '../database/supervisor.schema';
import { DutyAllotment, DutySitting, DutyStaffMember } from '../database/staff-duty.schema';
import { MONTHS } from './months';
import {
  BulkResult,
  canApprove,
  canEdit,
  dayName,
  escapeRegex,
  iid,
  isoDate,
  oid,
  oids,
  requireAce,
  requireDealing,
  text,
} from './supervisor-access';
import { SupervisorMail, SupervisorMailService, SUPERVISOR_LETTERS } from './supervisor-mail.service';
import { SupervisorTaskService } from './supervisor-task.service';
import { removeUpload } from '../practical/practical-files';
import { bankFieldsChecked } from './supervisor-bank';

/** List views behind the menu items (docs/supervisor-plan.md §6). */
const VIEW_STATUS: Record<string, string[]> = {
  all: [SupervisorStatus.DRAFT, SupervisorStatus.WITH_ACE, SupervisorStatus.APPROVED, SupervisorStatus.OFFER_SENT, SupervisorStatus.ACCEPTED, SupervisorStatus.REGRETTED],
  'to-ace': [SupervisorStatus.DRAFT],
  'with-ace': [SupervisorStatus.WITH_ACE],
  approved: [SupervisorStatus.APPROVED],
  'offer-pending': [SupervisorStatus.OFFER_SENT],
  accepted: [SupervisorStatus.ACCEPTED],
  regretted: [SupervisorStatus.REGRETTED],
  withdrawn: [SupervisorStatus.WITHDRAWN],
};

/** Statuses whose details and duties Dealing may still change. */
const EDITABLE = new Set<string>([SupervisorStatus.DRAFT, SupervisorStatus.WITH_ACE, SupervisorStatus.APPROVED, SupervisorStatus.OFFER_SENT]);

type Appt = SupervisorAppointment & { _id: Types.ObjectId };

@Injectable()
export class SupervisorService {
  constructor(
    @InjectModel(SupervisorSession.name) private sessions: Model<SupervisorSession>,
    @InjectModel(SupervisorLookup.name) private lookups: Model<SupervisorLookup>,
    @InjectModel(SupervisorSchedule.name) private schedules: Model<SupervisorSchedule>,
    @InjectModel(SupervisorPerson.name) private people: Model<SupervisorPerson>,
    @InjectModel(SupervisorAppointment.name) private appts: Model<SupervisorAppointment>,
    @InjectModel(SupervisorToken.name) private tokens: Model<SupervisorToken>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(ExamPaper.name) private papers: Model<ExamPaper>,
    @InjectModel(ExamShift.name) private examShifts: Model<ExamShift>,
    @InjectModel(ExamCandidate.name) private candidates: Model<ExamCandidate>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(DutySitting.name) private dutySittings: Model<DutySitting>,
    @InjectModel(DutyAllotment.name) private dutyAllotments: Model<DutyAllotment>,
    @InjectModel(DutyStaffMember.name) private dutyMembers: Model<DutyStaffMember>,
    private mail: SupervisorMailService,
    private tasks: SupervisorTaskService,
  ) {}

  // ---------------------------------------------------------------- meta & sessions

  async meta(user: AuthUser) {
    const inst = iid(user);
    const [sessions, lookups, depts] = await Promise.all([
      this.sessions.find({ instituteId: inst }).sort({ year: -1, createdAt: -1 }).lean(),
      this.lookups.find({ instituteId: inst }).lean(),
      this.departments.find({ instituteId: inst }).select('name').sort({ name: 1 }).lean(),
    ]);
    const now = new Date().getFullYear();
    const years = new Set<number>();
    for (let y = 2020; y <= now + 1; y++) years.add(y);
    for (const s of sessions) years.add(s.year);
    for (const l of lookups.filter((l) => l.kind === 'YEAR')) years.add(Number(l.name));
    const active = sessions.find((s) => s.active);
    return {
      sessions: sessions.map((s) => ({ _id: s._id, month: s.month, year: s.year, fileNumber: s.fileNumber, active: s.active })),
      activeSessionId: active?._id || null,
      months: [...MONTHS, ...lookups.filter((l) => l.kind === 'MONTH').map((l) => l.name).sort()],
      years: [...years].filter((y) => y > 1900).sort((a, b) => b - a),
      designations: lookups.filter((l) => l.kind === 'DESIGNATION').map((l) => l.name).sort(),
      // Masters departments plus the ones added with "+" on the Supervisor / Staff Duty forms (old tblDepartment_Sup).
      departments: [...new Set([...depts.map((d) => d.name), ...lookups.filter((l) => l.kind === 'DEPARTMENT').map((l) => l.name)])].sort(),
      shifts: SUPERVISOR_SHIFTS,
      statusLabels: SUPERVISOR_STATUS_LABELS,
      can: { edit: canEdit(user), approve: canApprove(user) },
    };
  }

  async currentSession(user: AuthUser) {
    const row = await this.sessions.findOne({ instituteId: iid(user), active: true }).lean();
    return row ? { _id: row._id, month: row.month, year: row.year, fileNumber: row.fileNumber } : null;
  }

  /** The given session of the institute, or the active one. */
  async resolveSession(user: AuthUser, sessionId?: unknown) {
    const inst = iid(user);
    const id = String(sessionId ?? '');
    const row = Types.ObjectId.isValid(id)
      ? await this.sessions.findOne({ _id: id, instituteId: inst }).lean()
      : await this.sessions.findOne({ instituteId: inst, active: true }).lean();
    if (!row) {
      throw new BadRequestException(
        Types.ObjectId.isValid(id) ? 'Supervisor session not found' : 'No supervisor session is active. Set one on Supervisor Session first.',
      );
    }
    return row as SupervisorSession & { _id: Types.ObjectId };
  }

  /** Add (old CreateSession): an existing month + year is re-activated and gets the new file number. */
  async createSession(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const inst = iid(user);
    const month = text(body.month, 40);
    const year = Number(body.year);
    const fileNumber = text(body.fileNumber, 120);
    if (!month) throw new BadRequestException('Please Select Month.');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Please Select Year');
    if (!fileNumber) throw new BadRequestException('Please Insert File Number');
    const allowed = (await this.meta(user)).months;
    if (!allowed.includes(month)) throw new BadRequestException('Unknown month. Add it with "+" first.');
    let row = await this.sessions.findOne({ instituteId: inst, month, year });
    const existed = Boolean(row);
    if (row) {
      row.fileNumber = fileNumber;
      await row.save();
    } else {
      row = await this.sessions.create({ instituteId: inst, month, year, fileNumber, active: false });
    }
    // Staff Duty creates a session for a month without taking over the active one (activate: false).
    if (body.activate !== false) await this.activateSession(user, String(row._id));
    return { _id: row._id, existed };
  }

  async updateSession(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const fileNumber = text(body.fileNumber, 120);
    if (!fileNumber) throw new BadRequestException('Please Insert File Number');
    const res = await this.sessions.updateOne({ _id: oid(id, 'Session'), instituteId: iid(user) }, { $set: { fileNumber } });
    if (!res.matchedCount) throw new NotFoundException('Session not found');
    return { ok: true };
  }

  /** Only one supervisor session is active for the whole institute. */
  async activateSession(user: AuthUser, id: string) {
    requireDealing(user);
    const inst = iid(user);
    const row = await this.sessions.findOne({ _id: oid(id, 'Session'), instituteId: inst });
    if (!row) throw new NotFoundException('Session not found');
    await this.sessions.updateMany({ instituteId: inst, _id: { $ne: row._id } }, { $set: { active: false } });
    row.active = true;
    await row.save();
    return { ok: true };
  }

  /** "+" buttons: MONTH (e.g. "July Slot-I"), YEAR, DESIGNATION, DEPARTMENT (Staff Duty). */
  async addLookup(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const kind = text(body.kind, 20).toUpperCase();
    const name = text(body.name, 60);
    if (!['MONTH', 'YEAR', 'DESIGNATION', 'DEPARTMENT'].includes(kind)) throw new BadRequestException('Unknown list');
    if (!name) {
      const label: Record<string, string> = {
        MONTH: 'Please Enter Month.',
        YEAR: 'Please Enter Year.',
        DESIGNATION: 'Please enter Designation name.',
        DEPARTMENT: 'Please enter department name.',
      };
      throw new BadRequestException(label[kind]);
    }
    if (kind === 'YEAR' && !/^(19|20|21)\d{2}$/.test(name)) throw new BadRequestException('Enter a 4-digit year');
    if (kind === 'MONTH' && MONTHS.some((m) => m.toLowerCase() === name.toLowerCase())) throw new ConflictException('Month Already Exists.....');
    const inst = iid(user);
    const same = { $regex: `^${escapeRegex(name)}$`, $options: 'i' };
    const exists =
      (await this.lookups.findOne({ instituteId: inst, kind, name: same }).lean()) ||
      (kind === 'DEPARTMENT' ? await this.departments.findOne({ instituteId: inst, name: same }).lean() : null);
    if (exists) {
      throw new ConflictException(
        kind === 'MONTH' ? 'Month Already Exists.....' : kind === 'DEPARTMENT' ? 'Department name already exists.' : `${name} already exists`,
      );
    }
    await this.lookups.create({ instituteId: inst, kind, name });
    return { name };
  }

  // ---------------------------------------------------------------- schedule

  async listSchedule(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.resolveSession(user, q.sessionId);
    const rows = await this.schedules.find({ sessionId: session._id }).lean();
    const duty = await this.dutyCounts(session._id);
    return rows
      .sort((a, b) => a.examDate.localeCompare(b.examDate) || shiftOrder(a.shift) - shiftOrder(b.shift))
      .map((r) => ({ ...r, day: dayName(r.examDate), supervisors: duty.get(String(r._id)) || 0 }));
  }

  private async dutyCounts(sessionId: Types.ObjectId) {
    const rows = await this.appts
      .aggregate([
        { $match: { sessionId, status: { $nin: [SupervisorStatus.WITHDRAWN, SupervisorStatus.REGRETTED] } } },
        { $unwind: '$duties' },
        { $group: { _id: '$duties.scheduleId', n: { $sum: 1 } } },
      ])
      .exec();
    return new Map<string, number>(rows.map((r) => [String(r._id), r.n]));
  }

  private scheduleFields(body: Record<string, unknown>) {
    const examName = text(body.examName, 500);
    const examDate = isoDate(body.examDate);
    const shift = SUPERVISOR_SHIFTS.find((s) => s.name === text(body.shift, 20));
    const studentCount = Number(body.studentCount);
    if (!examName) throw new BadRequestException('Please Enter Exam Name.');
    if (!examDate) throw new BadRequestException('Please enter Date.');
    if (!shift) throw new BadRequestException('Please Select Shift.');
    if (!Number.isInteger(studentCount) || studentCount < 0 || studentCount > 100000) {
      throw new BadRequestException('Please Enter Number of Students.');
    }
    return { examName, examDate, shift: shift.name, time: shift.time, studentCount };
  }

  async createSchedule(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.resolveSession(user, body.sessionId);
    const f = this.scheduleFields(body);
    const dup = await this.schedules.findOne({ sessionId: session._id, examDate: f.examDate, shift: f.shift }).lean();
    if (dup) throw new ConflictException('Duplicate Records. This date and shift is already scheduled.');
    return this.schedules.create({ instituteId: iid(user), sessionId: session._id, ...f });
  }

  /** Edit moves the assigned duties to the new date / shift and reports who was affected. */
  async updateSchedule(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const row = await this.schedules.findOne({ _id: oid(id, 'Schedule'), instituteId: iid(user) });
    if (!row) throw new NotFoundException('Schedule not found');
    const f = this.scheduleFields(body);
    const dup = await this.schedules
      .findOne({ sessionId: row.sessionId, examDate: f.examDate, shift: f.shift, _id: { $ne: row._id } })
      .lean();
    if (dup) throw new ConflictException('Duplicate Records. This date and shift is already scheduled.');
    const moved = f.examDate !== row.examDate || f.shift !== row.shift;
    const from = { examDate: row.examDate, shift: row.shift };
    Object.assign(row, f);
    await row.save();
    let affected: string[] = [];
    if (moved) {
      const holders = await this.appts.find({ 'duties.scheduleId': row._id }).select('name').lean();
      affected = holders.map((h) => h.name);
      await this.appts.updateMany(
        { 'duties.scheduleId': row._id },
        {
          $set: {
            'duties.$[d].examDate': f.examDate,
            'duties.$[d].shift': f.shift,
            'duties.$[d].reportingTime': SUPERVISOR_SHIFTS.find((s) => s.name === f.shift)!.reportingTime,
          },
        },
        { arrayFilters: [{ 'd.scheduleId': row._id }] },
      );
      await this.moveStaffDuty(row._id, row.sessionId, from, { examDate: f.examDate, shift: f.shift });
    }
    return { ok: true, affected };
  }

  async deleteSchedule(user: AuthUser, id: string) {
    requireDealing(user);
    const row = await this.schedules.findOne({ _id: oid(id, 'Schedule'), instituteId: iid(user) }).lean();
    if (!row) throw new NotFoundException('Schedule not found');
    const holders = await this.appts
      .find({ 'duties.scheduleId': row._id, status: { $ne: SupervisorStatus.WITHDRAWN } })
      .select('name')
      .lean();
    if (holders.length) {
      throw new ConflictException(
        `Supervisors are assigned to this sitting (${holders.map((h) => h.name).join(', ')}). Remove their duty first.`,
      );
    }
    const sitting = await this.dutySittings.findOne({ scheduleId: row._id }).lean();
    if (sitting) {
      const n = await this.dutyAllotments.countDocuments({ sittingId: sitting._id });
      throw new ConflictException(
        `Staff Duty uses this sitting (${n} staff on duty). Delete it on Staff Duty → Duty Allotment first.`,
      );
    }
    await this.schedules.deleteOne({ _id: row._id });
    return { ok: true };
  }

  /** Staff Duty follows an edited sitting: its requirement, allotments and per-sitting unavailability move too. */
  private async moveStaffDuty(
    scheduleId: Types.ObjectId,
    sessionId: Types.ObjectId,
    from: { examDate: string; shift: string },
    to: { examDate: string; shift: string },
  ) {
    const sitting = await this.dutySittings.findOne({ scheduleId }).lean();
    if (!sitting) return;
    await this.dutySittings.updateOne({ _id: sitting._id }, { $set: to });
    await this.dutyAllotments.updateMany({ sittingId: sitting._id }, { $set: to });
    await this.dutyMembers.updateMany(
      { sessionId, unavailable: { $elemMatch: from } },
      { $set: { 'unavailable.$[u].examDate': to.examDate, 'unavailable.$[u].shift': to.shift } },
      { arrayFilters: [{ 'u.examDate': from.examDate, 'u.shift': from.shift }] },
    );
  }

  /** Add Venue papers held on a date + shift, with the eligible-candidate count (Decision 3). */
  async prefill(user: AuthUser, q: Record<string, unknown>) {
    const inst = iid(user);
    const examDate = isoDate(q.examDate);
    const shift = text(q.shift, 20);
    if (!examDate || !shift) throw new BadRequestException('Select the date and shift first');
    const shiftRows = await this.examShifts
      .find({ instituteId: inst, name: { $regex: `^${escapeRegex(shift)}$`, $options: 'i' } })
      .select('_id')
      .lean();
    const papers = await this.papers.find({ instituteId: inst, examDate, shiftId: { $in: shiftRows.map((s) => s._id) } }).lean();
    if (!papers.length) return { papers: [], examName: '', studentCount: 0 };
    const [courses, specs] = await Promise.all([
      this.courses.find({ _id: { $in: papers.map((p) => p.courseId) } }).select('name').lean(),
      this.specialities.find({ _id: { $in: papers.map((p) => p.specialityId) } }).select('name').lean(),
    ]);
    const cName = new Map(courses.map((c) => [String(c._id), c.name]));
    const sName = new Map(specs.map((s) => [String(s._id), s.name]));
    const out: { course: string; speciality: string; paper: string; candidates: number }[] = [];
    for (const p of papers) {
      const candidates = await this.candidates.countDocuments({ sessionId: p.sessionId, specialityId: p.specialityId, eligible: true });
      out.push({
        course: cName.get(String(p.courseId)) || '',
        speciality: sName.get(String(p.specialityId)) || '',
        paper: p.paper,
        candidates,
      });
    }
    out.sort((a, b) => a.course.localeCompare(b.course) || a.speciality.localeCompare(b.speciality) || a.paper.localeCompare(b.paper));
    return {
      papers: out,
      examName: out.map((p) => [p.course, p.speciality, p.paper].filter(Boolean).join('-')).join(', ').slice(0, 500),
      studentCount: out.reduce((n, p) => n + p.candidates, 0),
    };
  }

  // ---------------------------------------------------------------- people (Edit All Supervisor)

  async listPeople(user: AuthUser, q: Record<string, unknown>) {
    const filter: Record<string, unknown> = { instituteId: iid(user), deleted: { $ne: true } };
    const term = text(q.q, 80);
    if (term) {
      const rx = { $regex: escapeRegex(term), $options: 'i' };
      filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }];
    }
    return this.people.find(filter).sort({ name: 1 }).limit(term ? 50 : 5000).lean();
  }

  private personFields(body: Record<string, unknown>) {
    const f = {
      name: text(body.name, 200),
      designation: text(body.designation, 160),
      department: text(body.department, 160),
      instituteName: text(body.instituteName, 250),
      address: text(body.address, 500),
      mobile: cleanMobile(body.mobile as string),
      email: normalizeEmail(body.email),
    };
    if (!f.name) throw new BadRequestException('Please enter Name.');
    if (!f.designation) throw new BadRequestException('Please Select Designation');
    if (!f.department) throw new BadRequestException('Please Select Department');
    if (!f.instituteName) throw new BadRequestException('Please Enter Institute Name');
    if (!f.address) throw new BadRequestException('Please Enter Institute Address');
    if (!isValidMobile(f.mobile)) throw new BadRequestException('Mobile number should be 10 digit.');
    if (!isValidEmail(f.email)) throw new BadRequestException('Please enter valid email e.g abc@domain.com');
    return f;
  }

  /** Registry edit. Appointments not yet sent to ACE pick up the change; later ones keep their snapshot. */
  async updatePerson(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const inst = iid(user);
    const row = await this.people.findOne({ _id: oid(id, 'Supervisor'), instituteId: inst, deleted: { $ne: true } });
    if (!row) throw new NotFoundException('Supervisor not found');
    const f = this.personFields(body);
    const clash = await this.people.findOne({ instituteId: inst, email: f.email, _id: { $ne: row._id } }).lean();
    if (clash) throw new ConflictException(`Another supervisor (${clash.name}) already uses ${f.email}`);
    Object.assign(row, f);
    await row.save();
    const res = await this.appts.updateMany({ personId: row._id, status: SupervisorStatus.DRAFT }, { $set: f });
    return { ok: true, draftsUpdated: res.modifiedCount };
  }

  /** Removes people from the picker. Their appointments keep their own copy of the details. */
  async deletePeople(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const ids = oids(body.ids);
    if (!ids.length) throw new BadRequestException('Please select atleast 1 data.');
    const res = await this.people.updateMany({ _id: { $in: ids }, instituteId: iid(user) }, { $set: { deleted: true } });
    return { updated: res.modifiedCount, skipped: [] } as BulkResult;
  }

  // ---------------------------------------------------------------- appointments

  private shape(a: Appt, examNames?: Map<string, string>) {
    return {
      _id: a._id,
      sessionId: a.sessionId,
      personId: a.personId,
      name: a.name,
      designation: a.designation || '',
      department: a.department || '',
      instituteName: a.instituteName || '',
      address: a.address || '',
      mobile: a.mobile,
      email: a.email,
      status: a.status,
      statusLabel: SUPERVISOR_STATUS_LABELS[a.status] || a.status,
      duties: [...(a.duties || [])]
        .sort((x, y) => x.examDate.localeCompare(y.examDate) || shiftOrder(x.shift) - shiftOrder(y.shift))
        .map((d) => ({ ...d, day: dayName(d.examDate), examName: examNames?.get(String(d.scheduleId)) || '' })),
      totalDuty: (a.duties || []).length,
      approvedBy: a.approvedBy || null,
      offer: a.offer || null,
      acceptedAt: a.acceptedAt || null,
      regretReason: a.regretReason || '',
      withdrawReason: a.withdrawReason || '',
      salaryCode: a.salaryCode || '',
      remuneration: a.remuneration || '',
      bank: a.bank ? { ...a.bank, chequePath: undefined, hasCheque: Boolean(a.bank.chequePath) } : null,
      history: a.history || [],
    };
  }

  private async examNames(sessionId: Types.ObjectId) {
    const rows = await this.schedules.find({ sessionId }).select('examName').lean();
    return new Map(rows.map((r) => [String(r._id), r.examName]));
  }

  async listAppointments(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.resolveSession(user, q.sessionId);
    const view = text(q.view, 20) || 'all';
    const statuses = VIEW_STATUS[view];
    if (!statuses) throw new BadRequestException('Unknown list');
    const rows = (await this.appts.find({ sessionId: session._id, status: { $in: statuses } }).sort({ name: 1 }).lean()) as Appt[];
    const names = await this.examNames(session._id);
    return rows.map((r) => this.shape(r, names));
  }

  async getAppointment(user: AuthUser, id: string) {
    const a = await this.load(user, id);
    return this.shape(a, await this.examNames(a.sessionId));
  }

  private async load(user: AuthUser, id: string) {
    const a = (await this.appts.findOne({ _id: oid(id, 'Supervisor'), instituteId: iid(user) }).lean()) as Appt | null;
    if (!a) throw new NotFoundException('Supervisor not found');
    return a;
  }

  /** Email and mobile are unique among the live supervisors of a session (old Ret 3 / 4). */
  private async assertUniqueInSession(sessionId: Types.ObjectId, f: { email: string; mobile: string }, exceptId?: Types.ObjectId) {
    const base: Record<string, unknown> = { sessionId, status: { $ne: SupervisorStatus.WITHDRAWN } };
    if (exceptId) base._id = { $ne: exceptId };
    if (await this.appts.exists({ ...base, email: f.email })) {
      throw new ConflictException(`${f.email} is already a supervisor in this session.`);
    }
    if (await this.appts.exists({ ...base, mobile: f.mobile })) {
      throw new ConflictException(`Mobile ${f.mobile} is already a supervisor in this session.`);
    }
  }

  /** Add New Supervisor: from the registry ("Added Supervisor") or typed in. */
  async createAppointment(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const inst = iid(user);
    const session = await this.resolveSession(user, body.sessionId);
    const f = this.personFields(body);
    await this.assertUniqueInSession(session._id, f);
    let person = body.personId && Types.ObjectId.isValid(String(body.personId))
      ? await this.people.findOne({ _id: body.personId, instituteId: inst }).lean()
      : null;
    if (!person) person = await this.people.findOne({ instituteId: inst, email: f.email }).lean();
    if (!person) {
      person = (await this.people.create({ instituteId: inst, ...f })).toObject();
    } else if (person.deleted) {
      await this.people.updateOne({ _id: person._id }, { $set: { deleted: false } });
    }
    const created = await this.appts.create({
      instituteId: inst,
      sessionId: session._id,
      personId: person._id,
      dealingUserId: new Types.ObjectId(user.userId),
      ...f,
      status: SupervisorStatus.DRAFT,
      history: [this.event(user, SupervisorStatus.DRAFT, 'Added')],
    });
    return { _id: created._id };
  }

  async updateAppointment(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const a = await this.load(user, id);
    if (!EDITABLE.has(a.status)) throw new BadRequestException(`A supervisor who is ${SUPERVISOR_STATUS_LABELS[a.status]} cannot be edited here.`);
    const f = this.personFields(body);
    await this.assertUniqueInSession(a.sessionId, f, a._id);
    await this.appts.updateOne({ _id: a._id }, { $set: f, $push: { history: this.event(user, a.status, 'Details updated') } });
    if (f.email !== a.email) await this.tasks.rekey(a._id, f.email);
    return { ok: true };
  }

  /** Delete on Add New Supervisor: removes a DRAFT entry, otherwise withdraws it with a reason (Decision 8). */
  async withdraw(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const ids = oids(body.ids);
    if (!ids.length) throw new BadRequestException('Please select atleast 1 data.');
    const reason = text(body.reason, 300);
    const rows = (await this.appts.find({ _id: { $in: ids }, instituteId: iid(user) }).lean()) as Appt[];
    const result: BulkResult = { updated: 0, skipped: [] };
    for (const a of rows) {
      if (a.status === SupervisorStatus.WITHDRAWN) {
        result.skipped.push({ id: String(a._id), name: a.name, reason: 'Already withdrawn' });
      } else if (a.status === SupervisorStatus.DRAFT) {
        await this.appts.deleteOne({ _id: a._id });
        result.updated++;
      } else if (!reason) {
        result.skipped.push({ id: String(a._id), name: a.name, reason: `Already ${SUPERVISOR_STATUS_LABELS[a.status]}: give a reason to withdraw` });
      } else {
        await this.appts.updateOne(
          { _id: a._id },
          { $set: { status: SupervisorStatus.WITHDRAWN, withdrawReason: reason }, $push: { history: this.event(user, SupervisorStatus.WITHDRAWN, reason) } },
        );
        result.updated++;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- duties

  async addDuty(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const a = await this.load(user, id);
    if (!EDITABLE.has(a.status)) throw new BadRequestException(`Duties of a supervisor who is ${SUPERVISOR_STATUS_LABELS[a.status]} cannot be changed.`);
    const schedule = await this.schedules.findOne({ _id: oid(body.scheduleId, 'Date and Shift'), sessionId: a.sessionId }).lean();
    if (!schedule) throw new BadRequestException('Please Select Shift.');
    if ((a.duties || []).some((d) => String(d.scheduleId) === String(schedule._id))) {
      throw new ConflictException('This duty is already assigned to the supervisor.');
    }
    const def = SUPERVISOR_SHIFTS.find((s) => s.name === schedule.shift)?.reportingTime || '';
    const reportingTime = text(body.reportingTime, 20) || def;
    if (!reportingTime) throw new BadRequestException('Please enter Reporting Time.');
    await this.appts.updateOne(
      { _id: a._id },
      { $push: { duties: { scheduleId: schedule._id, examDate: schedule.examDate, shift: schedule.shift, reportingTime } } },
    );
    return this.getAppointment(user, id);
  }

  async removeDuty(user: AuthUser, id: string, scheduleId: string) {
    requireDealing(user);
    const a = await this.load(user, id);
    if (!EDITABLE.has(a.status)) throw new BadRequestException(`Duties of a supervisor who is ${SUPERVISOR_STATUS_LABELS[a.status]} cannot be changed.`);
    await this.appts.updateOne({ _id: a._id }, { $pull: { duties: { scheduleId: oid(scheduleId, 'Duty') } } });
    return this.getAppointment(user, id);
  }

  // ---------------------------------------------------------------- workflow

  private event(user: AuthUser, status: string, remark?: string) {
    return { status, at: new Date(), by: String(user.userId), byName: user.name || user.email, role: user.role, remark };
  }

  private async bulk(
    user: AuthUser,
    body: Record<string, unknown>,
    from: string,
    step: (a: Appt) => Promise<string | null>,
  ): Promise<BulkResult> {
    const ids = oids(body.ids);
    if (!ids.length) throw new BadRequestException('Please select atleast 1 data.');
    const rows = (await this.appts.find({ _id: { $in: ids }, instituteId: iid(user) }).lean()) as Appt[];
    const result: BulkResult = { updated: 0, skipped: [] };
    for (const a of rows) {
      if (a.status !== from) {
        result.skipped.push({ id: String(a._id), name: a.name, reason: `Now ${SUPERVISOR_STATUS_LABELS[a.status] || a.status}` });
        continue;
      }
      try {
        const skip = await step(a);
        if (skip) result.skipped.push({ id: String(a._id), name: a.name, reason: skip });
        else result.updated++;
      } catch (err: any) {
        result.skipped.push({ id: String(a._id), name: a.name, reason: err?.message || 'Failed' });
      }
    }
    return result;
  }

  /** Dealing: Send to Asstt. Controller (old status 1). A supervisor needs at least one duty. */
  sendToAce(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    return this.bulk(user, body, SupervisorStatus.DRAFT, async (a) => {
      if (!(a.duties || []).length) return 'No duty assigned yet';
      await this.appts.updateOne(
        { _id: a._id, status: SupervisorStatus.DRAFT },
        { $set: { status: SupervisorStatus.WITH_ACE }, $push: { history: this.event(user, SupervisorStatus.WITH_ACE, 'Sent to Asstt. Controller') } },
      );
      return null;
    });
  }

  /** ACE: Approve and Send to Dealing (old status 4). The approval date is the letter date. */
  approve(user: AuthUser, body: Record<string, unknown>) {
    requireAce(user);
    const by = { userId: String(user.userId), name: user.name || user.email, at: new Date() };
    return this.bulk(user, body, SupervisorStatus.WITH_ACE, async (a) => {
      await this.appts.updateOne(
        { _id: a._id, status: SupervisorStatus.WITH_ACE },
        { $set: { status: SupervisorStatus.APPROVED, approvedBy: by }, $push: { history: this.event(user, SupervisorStatus.APPROVED, 'Approved and sent to Dealing') } },
      );
      return null;
    });
  }

  /** Dealing: Send Offer to Supervisor (old status 5): email with the duty table and the link. */
  sendOffer(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    return this.bulk(user, body, SupervisorStatus.APPROVED, async (a) => {
      if (!(a.duties || []).length) return 'No duty assigned';
      await this.mailOffer(a);
      await this.appts.updateOne(
        { _id: a._id, status: SupervisorStatus.APPROVED },
        {
          $set: { status: SupervisorStatus.OFFER_SENT, 'offer.sentAt': new Date() },
          $push: { history: this.event(user, SupervisorStatus.OFFER_SENT, 'Offer sent') },
        },
      );
      return null;
    });
  }

  /** Dealing: Re-send Letter; status stays "Offer sent". */
  resendOffer(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    return this.bulk(user, body, SupervisorStatus.OFFER_SENT, async (a) => {
      await this.mailOffer(a);
      await this.appts.updateOne(
        { _id: a._id },
        { $push: { 'offer.resentAt': new Date(), history: this.event(user, SupervisorStatus.OFFER_SENT, 'Offer re-sent') } },
      );
      return null;
    });
  }

  private async mailOffer(a: Appt) {
    const token = await this.tasks.ensureToken(a);
    const res = await this.mail.send(a, SupervisorMail.OFFER, await this.examNames(a.sessionId), { taskLink: this.tasks.linkFor(token) });
    if (res.status === 'FAILED') throw new Error('Email could not be sent');
  }

  // ---------------------------------------------------------------- accepted supervisors

  /** Accepted from Supervisor → edit: salary code, remuneration, bank details, cheque. */
  async updateAcceptance(user: AuthUser, id: string, body: Record<string, unknown>, chequePath?: string) {
    requireDealing(user);
    const a = await this.load(user, id);
    if (a.status !== SupervisorStatus.ACCEPTED) throw new BadRequestException('Only accepted supervisors have bank details to edit.');
    const f = this.personFields(body);
    await this.assertUniqueInSession(a.sessionId, f, a._id);
    const bank = bankFieldsChecked(body);
    const salaryCode = text(body.salaryCode, 100);
    const remuneration = text(body.remuneration, 100);
    if (!salaryCode) throw new BadRequestException('Please Enter Salary Code');
    const old = a.bank?.chequePath;
    await this.appts.updateOne(
      { _id: a._id },
      {
        $set: { ...f, salaryCode, remuneration, bank: { ...bank, chequePath: chequePath || old } },
        $push: { history: this.event(user, a.status, 'Acceptance details updated') },
      },
    );
    if (chequePath && old && old !== chequePath) await removeUpload(old);
    return { ok: true };
  }

  async chequeOf(user: AuthUser, id: string) {
    const a = await this.load(user, id);
    if (!a.bank?.chequePath) throw new NotFoundException('Cancelled cheque not uploaded!');
    return { path: a.bank.chequePath, name: `Cancelled cheque - ${a.name}${extOf(a.bank.chequePath)}` };
  }

  // ---------------------------------------------------------------- letters & reports

  /** Download Letter/Acceptance: offer (approved by ACE), acceptance or regret letters for the selected supervisors. */
  async letters(user: AuthUser, body: Record<string, unknown>) {
    const kind = text(body.kind, 20);
    const purpose = SUPERVISOR_LETTERS[kind];
    if (!purpose) throw new BadRequestException('Please select Letter Type');
    const ids = oids(body.ids);
    if (!ids.length) throw new BadRequestException('Please select atleast 1 data.');
    const allowed: Record<string, string[]> = {
      offer: [SupervisorStatus.APPROVED, SupervisorStatus.OFFER_SENT, SupervisorStatus.ACCEPTED, SupervisorStatus.REGRETTED],
      acceptance: [SupervisorStatus.ACCEPTED],
      regret: [SupervisorStatus.REGRETTED],
    };
    const rows = (await this.appts.find({ _id: { $in: ids }, instituteId: iid(user), status: { $in: allowed[kind] } }).lean()) as Appt[];
    const out: { _id: Types.ObjectId; name: string; subject: string; body: string }[] = [];
    for (const a of rows) {
      const { subject, body: html } = await this.mail.preview(a, purpose, await this.examNames(a.sessionId));
      out.push({ _id: a._id, name: a.name, subject, body: html });
    }
    return out;
  }

  /** Day Wise Supervisor (session) or the old Timing Report (date range): one row per duty. */
  async dayWise(user: AuthUser, q: Record<string, unknown>) {
    const from = isoDate(q.from);
    const to = isoDate(q.to);
    const match: Record<string, unknown> = {
      instituteId: iid(user),
      status: { $nin: [SupervisorStatus.WITHDRAWN, SupervisorStatus.REGRETTED] },
    };
    if (from || to) {
      if (!from || !to) throw new BadRequestException('Select both From Date and To Date');
      if (from > to) throw new BadRequestException('From Date must be before To Date');
    } else {
      match.sessionId = (await this.resolveSession(user, q.sessionId))._id;
    }
    const rows = (await this.appts.find(match).lean()) as Appt[];
    const scheduleIds = [...new Set(rows.flatMap((r) => (r.duties || []).map((d) => String(d.scheduleId))))];
    const sched = await this.schedules.find({ _id: { $in: scheduleIds } }).select('examName').lean();
    const names = new Map(sched.map((s) => [String(s._id), s.examName]));
    const out: any[] = [];
    for (const a of rows) {
      for (const d of a.duties || []) {
        if (from && (d.examDate < from || d.examDate > to)) continue;
        out.push({
          key: `${a._id}-${d.scheduleId}`,
          appointmentId: a._id,
          examDate: d.examDate,
          day: dayName(d.examDate),
          shift: d.shift,
          reportingTime: d.reportingTime,
          examName: names.get(String(d.scheduleId)) || '',
          name: a.name,
          designation: a.designation || '',
          department: a.department || '',
          instituteName: a.instituteName || '',
          address: a.address || '',
          mobile: a.mobile,
          email: a.email,
          status: a.status,
          statusLabel: SUPERVISOR_STATUS_LABELS[a.status] || a.status,
        });
      }
    }
    return out.sort((x, y) => x.examDate.localeCompare(y.examDate) || shiftOrder(x.shift) - shiftOrder(y.shift) || x.name.localeCompare(y.name));
  }

  /** Dealing home tiles (old SupervisorCount) for the active session. */
  async counts(user: AuthUser, q: Record<string, unknown>) {
    let session: (SupervisorSession & { _id: Types.ObjectId }) | null = null;
    try {
      session = await this.resolveSession(user, q.sessionId);
    } catch {
      return { session: null, counts: {} };
    }
    const rows = await this.appts.aggregate([{ $match: { sessionId: session._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).exec();
    return { session: { _id: session._id, month: session.month, year: session.year }, counts: Object.fromEntries(rows.map((r) => [r._id, r.n])) };
  }
}

function shiftOrder(s: string) {
  const i = SUPERVISOR_SHIFTS.findIndex((x) => x.name === s);
  return i < 0 ? 9 : i;
}

function extOf(p: string) {
  const m = /\.[a-z0-9]+$/i.exec(p);
  return m ? m[0] : '';
}
