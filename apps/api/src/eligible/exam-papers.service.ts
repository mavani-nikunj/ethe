import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/current-user';
import { ExamPaper, ExamShift, ExamTimeSlot } from '../database/exam-paper.schema';
import { SeatAllotment } from '../database/seat-allotment.schema';
import { AcademicSession, Course, Speciality } from '../database/masters.schema';
import {
  assertCourseInScope,
  courseScope,
  escapeRegex,
  iid,
  inCourseScope,
  oid,
  requireDealing,
  resolveSessionId,
  text,
} from './eligible-access';

/** Old tblShift / tblTimeSlot master data, seeded the first time an institute opens the menu. */
const DEFAULT_SHIFTS = ['Morning', 'Evening'];
const DEFAULT_TIME_SLOTS = ['09:30 AM to 12:30 PM', '02:00 PM to 05:00 PM'];

export type PaperRow = {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  courseId: Types.ObjectId;
  specialityId: Types.ObjectId;
  paper: string;
  examDate: string;
  shiftId: Types.ObjectId;
  timeSlotId: Types.ObjectId;
  venue: string;
  fees: number;
  courseName: string;
  specialityName: string;
  shiftName: string;
  timeName: string;
};

@Injectable()
export class ExamPapersService {
  constructor(
    @InjectModel(ExamPaper.name) private papers: Model<ExamPaper>,
    @InjectModel(ExamShift.name) private shifts: Model<ExamShift>,
    @InjectModel(ExamTimeSlot.name) private timeSlots: Model<ExamTimeSlot>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(SeatAllotment.name) private allotments: Model<SeatAllotment>,
  ) {}

  /** A paper seated in a locked allotment can't be moved or deleted. */
  private async assertNotLocked(paperId: unknown) {
    if (await this.allotments.exists({ locked: true, 'placements.paperId': paperId })) {
      throw new BadRequestException('This paper is in a locked seat allotment and cannot be changed or deleted.');
    }
  }

  // ---------- shifts & time slots ----------

  private async seed(model: Model<any>, instituteId: Types.ObjectId, names: string[]) {
    if (await model.exists({ instituteId })) return;
    try {
      await model.insertMany(names.map((name) => ({ instituteId, name })), { ordered: false });
    } catch (err: any) {
      if (err?.code !== 11000 && !err?.writeErrors) throw err;
    }
  }

  async listShifts(user: AuthUser) {
    await this.seed(this.shifts, iid(user), DEFAULT_SHIFTS);
    return this.shifts.find({ instituteId: iid(user) }).sort({ createdAt: 1 }).select('name').lean();
  }

  async listTimeSlots(user: AuthUser) {
    await this.seed(this.timeSlots, iid(user), DEFAULT_TIME_SLOTS);
    return this.timeSlots.find({ instituteId: iid(user) }).sort({ createdAt: 1 }).select('name').lean();
  }

  private async addLookup(model: Model<any>, user: AuthUser, body: { name?: string }, label: string) {
    requireDealing(user);
    const name = text(body?.name, label === 'Shift Name' ? 200 : 100);
    if (!name) throw new BadRequestException(`${label} is required`);
    const instituteId = iid(user);
    const clash = await model.findOne({ instituteId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).select('name').lean();
    if (clash) return clash;
    const row = await model.create({ instituteId, name });
    return { _id: row._id, name: row.name };
  }

  /** "+" next to Shift in Add Venue (old StaffDuty/AddShiftStaff). */
  addShift(user: AuthUser, body: { name?: string }) {
    return this.addLookup(this.shifts, user, body, 'Shift Name');
  }

  /** "+" next to Time in Add Venue (old StaffDuty/AddTimeSlot). */
  addTimeSlot(user: AuthUser, body: { name?: string }) {
    return this.addLookup(this.timeSlots, user, body, 'Time Name');
  }

  // ---------- papers (Add Venue) ----------

  /** Papers of a session with display names; used by the venue table and the candidate × paper view. */
  async papersFor(instituteId: Types.ObjectId, sessionId: Types.ObjectId, filter: Record<string, unknown> = {}): Promise<PaperRow[]> {
    const rows = await this.papers.find({ instituteId, sessionId, ...filter }).lean();
    const ids = (key: keyof ExamPaper) => [...new Set(rows.map((r) => String(r[key])))];
    const [courses, specs, shifts, slots] = await Promise.all([
      this.courses.find({ _id: { $in: ids('courseId') } }).select('name').lean(),
      this.specialities.find({ _id: { $in: ids('specialityId') } }).select('name').lean(),
      this.shifts.find({ _id: { $in: ids('shiftId') } }).select('name').lean(),
      this.timeSlots.find({ _id: { $in: ids('timeSlotId') } }).select('name').lean(),
    ]);
    const names = (list: { _id: unknown; name?: string }[]) => new Map(list.map((x) => [String(x._id), x.name || '']));
    const cm = names(courses);
    const sm = names(specs);
    const shm = names(shifts);
    const tm = names(slots);
    return rows
      .map((r) => ({
        _id: r._id as Types.ObjectId,
        sessionId: r.sessionId,
        courseId: r.courseId,
        specialityId: r.specialityId,
        paper: r.paper,
        examDate: r.examDate,
        shiftId: r.shiftId,
        timeSlotId: r.timeSlotId,
        venue: r.venue,
        fees: r.fees,
        courseName: cm.get(String(r.courseId)) || '',
        specialityName: sm.get(String(r.specialityId)) || '',
        shiftName: shm.get(String(r.shiftId)) || '',
        timeName: tm.get(String(r.timeSlotId)) || '',
      }))
      .sort(
        (a, b) =>
          a.courseName.localeCompare(b.courseName) ||
          a.specialityName.localeCompare(b.specialityName) ||
          a.examDate.localeCompare(b.examDate) ||
          a.paper.localeCompare(b.paper, undefined, { numeric: true }),
      );
  }

  async list(user: AuthUser, q: { sessionId?: string; courseId?: string; specialityId?: string }) {
    const sessionId = await resolveSessionId(this.sessions, user, q.sessionId);
    const filter: Record<string, unknown> = {};
    const scope = courseScope(user);
    if (scope) filter.courseId = { $in: scope };
    if (q.courseId && Types.ObjectId.isValid(q.courseId)) {
      if (!inCourseScope(user, q.courseId)) return [];
      filter.courseId = new Types.ObjectId(q.courseId);
    }
    if (q.specialityId && Types.ObjectId.isValid(q.specialityId)) filter.specialityId = new Types.ObjectId(q.specialityId);
    return this.papersFor(iid(user), sessionId, filter);
  }

  private async paperFields(user: AuthUser, body: Record<string, unknown>) {
    const instituteId = iid(user);
    const paper = text(body.paper, 200);
    const venue = text(body.venue, 300);
    const examDate = text(body.examDate, 10);
    const feesRaw = String(body.fees ?? '').trim();
    const fees = Number(feesRaw);
    const errors: string[] = [];
    if (!body.courseId) errors.push('Course is required');
    if (!body.specialityId) errors.push('Speciality is required');
    if (!paper) errors.push('Paper is required');
    if (!body.shiftId) errors.push('Shift is required');
    if (!feesRaw) errors.push('Fees is required');
    else if (!Number.isFinite(fees) || fees < 0 || feesRaw.replace(/\D/g, '').length > 7) errors.push('Fees must be a number of up to 7 digits');
    if (!examDate) errors.push('Date is required');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || Number.isNaN(new Date(examDate).getTime())) errors.push('Date is invalid');
    if (!body.timeSlotId) errors.push('Time is required');
    if (!venue) errors.push('Venue is required');
    if (errors.length) throw new BadRequestException(errors.join('. '));

    const courseId = oid(body.courseId, 'Course');
    const specialityId = oid(body.specialityId, 'Speciality');
    const shiftId = oid(body.shiftId, 'Shift');
    const timeSlotId = oid(body.timeSlotId, 'Time');
    const [course, speciality, shift, slot] = await Promise.all([
      this.courses.exists({ _id: courseId, instituteId }),
      this.specialities.findOne({ _id: specialityId, instituteId }).lean(),
      this.shifts.exists({ _id: shiftId, instituteId }),
      this.timeSlots.exists({ _id: timeSlotId, instituteId }),
    ]);
    if (!course) throw new BadRequestException('Course not found');
    assertCourseInScope(user, courseId);
    if (!speciality) throw new BadRequestException('Speciality not found');
    if (speciality.courseId && String(speciality.courseId) !== String(courseId)) {
      throw new BadRequestException('Speciality does not belong to the selected course');
    }
    if (!shift) throw new BadRequestException('Shift not found');
    if (!slot) throw new BadRequestException('Time not found');
    return { courseId, specialityId, paper, examDate, shiftId, timeSlotId, venue, fees };
  }

  /**
   * Old rule kept: one paper name per speciality per session (InsertVenue returned 2).
   * Dropped: the old "venue name already used" block (return 3), which stopped two papers of a
   * speciality from sharing a hall (plan §6 item 2).
   */
  private async assertPaperFree(instituteId: Types.ObjectId, sessionId: Types.ObjectId, specialityId: Types.ObjectId, paper: string, exceptId?: unknown) {
    const clash = await this.papers.exists({
      instituteId,
      sessionId,
      specialityId,
      paper: new RegExp(`^${escapeRegex(paper)}$`, 'i'),
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
    if (clash) throw new BadRequestException('This paper already exists for the speciality in this session');
  }

  private async one(user: AuthUser, id: Types.ObjectId) {
    const row = await this.papers.findById(id).lean();
    if (!row || String(row.instituteId) !== String(user.instituteId)) throw new NotFoundException('Paper not found');
    return row;
  }

  async create(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const instituteId = iid(user);
    const sessionId = await resolveSessionId(this.sessions, user, body.sessionId as string);
    const fields = await this.paperFields(user, body);
    await this.assertPaperFree(instituteId, sessionId, fields.specialityId, fields.paper);
    try {
      const row = await this.papers.create({ ...fields, instituteId, sessionId, createdBy: new Types.ObjectId(user.userId) });
      return (await this.papersFor(instituteId, sessionId, { _id: row._id }))[0];
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException('This paper already exists for the speciality in this session');
      throw err;
    }
  }

  /** Edits one paper by id (the old update matched speciality + session and overwrote every paper). */
  async update(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const row = await this.one(user, oid(id, 'Paper'));
    assertCourseInScope(user, row.courseId);
    await this.assertNotLocked(row._id);
    const fields = await this.paperFields(user, body);
    await this.assertPaperFree(row.instituteId, row.sessionId, fields.specialityId, fields.paper, row._id);
    await this.papers.updateOne({ _id: row._id }, { $set: fields });
    return (await this.papersFor(row.instituteId, row.sessionId, { _id: row._id }))[0];
  }

  async remove(user: AuthUser, id: string) {
    requireDealing(user);
    const row = await this.one(user, oid(id, 'Paper'));
    assertCourseInScope(user, row.courseId);
    await this.assertNotLocked(row._id);
    await this.papers.deleteOne({ _id: row._id });
    return { deleted: true };
  }

  /** Specialities of the session that have at least one paper (for the "awaiting paper" count). */
  async specialitiesWithPapers(instituteId: Types.ObjectId, sessionId: Types.ObjectId): Promise<Types.ObjectId[]> {
    return this.papers.distinct('specialityId', { instituteId, sessionId });
  }
}
