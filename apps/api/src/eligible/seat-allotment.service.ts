import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/current-user';
import { ExamCandidate } from '../database/exam-candidate.schema';
import { ExamHall } from '../database/exam-hall.schema';
import { ExamShift } from '../database/exam-paper.schema';
import { AcademicSession } from '../database/masters.schema';
import { AllotmentPlacement, AllotmentSeat, SeatAllotment, SeatingMode } from '../database/seat-allotment.schema';
import { EligibleService } from './eligible.service';
import { ExamPapersService, PaperRow } from './exam-papers.service';
import { canEdit, iid, oid, requireDealing, resolveSessionId, text } from './eligible-access';

const MODES = new Set<string>(Object.values(SeatingMode));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const seatKey = (s: { hallId: unknown; seatNo: number }) => `${s.hallId}:${s.seatNo}`;

/**
 * Seat Allotment (menu item 7) and Seat Allotment Reports (item 8). The whole institute shares one
 * allotment per exam date + shift; candidates of every course sitting a paper then are placed.
 * Replaces the old LockSeatDetails procedure, which was never in source control (plan §7.4).
 */
@Injectable()
export class SeatAllotmentService {
  constructor(
    @InjectModel(SeatAllotment.name) private allotments: Model<SeatAllotment>,
    @InjectModel(ExamCandidate.name) private candidates: Model<ExamCandidate>,
    @InjectModel(ExamHall.name) private halls: Model<ExamHall>,
    @InjectModel(ExamShift.name) private shifts: Model<ExamShift>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    private papers: ExamPapersService,
    private eligible: EligibleService,
  ) {}

  /** Exam Date + Shift choices: the dates and shifts of the papers entered in Add Venue (plan §8 Q4). */
  async dates(user: AuthUser, q: { sessionId?: string }) {
    const instituteId = iid(user);
    const sessionId = await resolveSessionId(this.sessions, user, q.sessionId);
    const papers = await this.papers.papersFor(instituteId, sessionId);
    const locked = await this.allotments.find({ instituteId, locked: true }).select('examDate shiftId').lean();
    const lockedKeys = new Set(locked.map((a) => `${a.examDate}|${a.shiftId}`));
    const map = new Map<string, { examDate: string; shiftId: string; shiftName: string; papers: number; locked: boolean }>();
    for (const p of papers) {
      const key = `${p.examDate}|${p.shiftId}`;
      const row = map.get(key) || { examDate: p.examDate, shiftId: String(p.shiftId), shiftName: p.shiftName, papers: 0, locked: lockedKeys.has(key) };
      row.papers += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.examDate.localeCompare(b.examDate) || byName(a.shiftName, b.shiftName));
  }

  private async papersOn(instituteId: Types.ObjectId, sessionId: Types.ObjectId, examDate: string, shiftId: Types.ObjectId) {
    return this.papers.papersFor(instituteId, sessionId, { examDate, shiftId });
  }

  /** Eligible candidates sitting each paper on that date + shift, one entry per candidate per paper. */
  private async sittings(instituteId: Types.ObjectId, sessionId: Types.ObjectId, papers: PaperRow[]) {
    await this.eligible.syncThesis(instituteId, sessionId);
    const specIds = [...new Set(papers.map((p) => String(p.specialityId)))].map((id) => new Types.ObjectId(id));
    const rows = await this.candidates
      .find({ instituteId, sessionId, eligible: { $ne: false }, specialityId: { $in: specIds } })
      .select('enrollmentNo name specialityId courseId')
      .lean();
    return papers.map((paper) => ({
      paper,
      candidates: rows
        .filter((c) => String(c.specialityId) === String(paper.specialityId))
        .sort((a, b) => a.enrollmentNo.localeCompare(b.enrollmentNo, undefined, { numeric: true })),
    }));
  }

  private async view(a: SeatAllotment & { _id: unknown }) {
    const instituteId = a.instituteId;
    const [shift, papers] = await Promise.all([
      this.shifts.findById(a.shiftId).select('name').lean(),
      this.papersOn(instituteId, a.sessionId, a.examDate, a.shiftId),
    ]);
    const groups = await this.sittings(instituteId, a.sessionId, papers);
    const seats = [...(a.seats || [])].sort((x, y) => byName(x.hallName, y.hallName) || x.row - y.row || x.seatNo - y.seatNo);
    const placements = [...(a.placements || [])].sort(
      (x, y) => byName(x.hallName, y.hallName) || x.row - y.row || x.seatNo - y.seatNo,
    );
    return {
      _id: a._id,
      sessionId: a.sessionId,
      examDate: a.examDate,
      shiftId: a.shiftId,
      shiftName: shift?.name || '',
      mode: a.mode || '',
      startSeat: a.startSeat || null,
      locked: !!a.locked,
      lockedBy: a.lockedBy || null,
      processedAt: a.processedAt || null,
      papers: groups.map((g) => ({
        paperId: g.paper._id,
        courseName: g.paper.courseName,
        specialityName: g.paper.specialityName,
        paper: g.paper.paper,
        count: g.candidates.length,
      })),
      totalCandidates: groups.reduce((n, g) => n + g.candidates.length, 0),
      seats,
      activeSeats: seats.filter((s) => s.active).length,
      placements,
    };
  }

  private async load(user: AuthUser, id: string) {
    const a = await this.allotments.findOne({ _id: oid(id, 'Allotment'), instituteId: iid(user) });
    if (!a) throw new NotFoundException('Seat allotment not found');
    return a;
  }

  private assertOpen(a: { locked?: boolean }) {
    if (a.locked) throw new BadRequestException('Already Locked. This exam date and shift can no longer be re-allotted.');
  }

  /** Step 1, Exam Date + Shift → Search: find or create the allotment and show candidate counts per paper. */
  async open(user: AuthUser, body: { sessionId?: string; examDate?: string; shiftId?: string }) {
    const instituteId = iid(user);
    const sessionId = await resolveSessionId(this.sessions, user, body?.sessionId);
    const examDate = text(body?.examDate, 10);
    if (!DATE.test(examDate)) throw new BadRequestException('Please Select Date.');
    if (!body?.shiftId) throw new BadRequestException('Please Select Shift');
    const shiftId = oid(body.shiftId, 'Shift');
    const existing = await this.allotments.findOne({ instituteId, examDate, shiftId }).lean();
    if (existing) return this.view(existing as any);
    const papers = await this.papersOn(instituteId, sessionId, examDate, shiftId);
    if (!papers.length) throw new BadRequestException('No paper is scheduled on this date and shift. Add it in Add Venue first.');
    if (!canEdit(user)) throw new BadRequestException('No seat allotment has been made for this date and shift yet.');
    try {
      const created = await this.allotments.create({ instituteId, sessionId, examDate, shiftId, createdBy: new Types.ObjectId(user.userId) });
      return this.view(created.toObject() as any);
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      return this.view((await this.allotments.findOne({ instituteId, examDate, shiftId }).lean()) as any);
    }
  }

  async getOne(user: AuthUser, id: string) {
    return this.view((await this.load(user, id)).toObject() as any);
  }

  /**
   * Step 2, Seats (Continuously / Odd / Even) + Start Seat No → Search. Copies every active hall seat.
   * Start Seat No applies to the first hall only (old bug: it dropped the low seats of every hall).
   * Manual switches survive a repeat search with the same settings.
   */
  async seating(user: AuthUser, id: string, body: { mode?: string; startSeat?: unknown }) {
    requireDealing(user);
    const a = await this.load(user, id);
    this.assertOpen(a);
    const mode = text(body?.mode, 20).toUpperCase();
    if (!MODES.has(mode)) throw new BadRequestException('Please select Seats: Continuously, Odd or Even.');
    const startRaw = body?.startSeat;
    const startSeat = startRaw === undefined || startRaw === null || startRaw === '' ? 1 : Number(startRaw);
    if (!Number.isInteger(startSeat) || startSeat < 1) throw new BadRequestException('Please Enter Start Seat');
    if (a.mode !== mode || (a.startSeat || 1) !== startSeat) a.overrides = {};
    const halls = (await this.halls.find({ instituteId: a.instituteId }).lean()).sort((x, y) => byName(x.name, y.name));
    if (!halls.length) throw new BadRequestException('No halls yet. Add halls and seats in Hall Master first.');
    const seats: AllotmentSeat[] = [];
    halls.forEach((h, hallIndex) => {
      for (const s of [...(h.seats || [])].sort((x, y) => x.row - y.row || x.seatNo - y.seatNo)) {
        if (s.active === false) continue;
        let active = true;
        if (mode === SeatingMode.ODD) active = s.seatNo % 2 === 1;
        if (mode === SeatingMode.EVEN) active = s.seatNo % 2 === 0;
        if (hallIndex === 0 && s.seatNo < startSeat) active = false;
        const seat = { hallId: h._id as Types.ObjectId, hallName: h.name, row: s.row, seatNo: s.seatNo, active };
        const forced = (a.overrides || {})[seatKey(seat)];
        if (typeof forced === 'boolean') seat.active = forced;
        seats.push(seat);
      }
    });
    a.mode = mode;
    a.startSeat = startSeat;
    a.seats = seats;
    a.placements = [];
    a.processedAt = undefined;
    a.markModified('overrides');
    await a.save();
    return this.getOne(user, id);
  }

  /** Status switch on one seat of this allotment. */
  async toggleSeat(user: AuthUser, id: string, body: { hallId?: string; seatNo?: unknown; active?: unknown }) {
    requireDealing(user);
    const a = await this.load(user, id);
    this.assertOpen(a);
    const seatNo = Number(body?.seatNo);
    const seat = (a.seats || []).find((s) => String(s.hallId) === String(body?.hallId) && s.seatNo === seatNo);
    if (!seat) throw new NotFoundException('Seat not found');
    seat.active = typeof body?.active === 'boolean' ? body.active : !seat.active;
    a.overrides = { ...(a.overrides || {}), [seatKey(seat)]: seat.active };
    a.placements = [];
    a.processedAt = undefined;
    a.markModified('seats');
    a.markModified('overrides');
    await a.save();
    return this.getOne(user, id);
  }

  /**
   * Step 3, Process. Active seats are taken in order hall → row → seat. Candidates are mixed by paper
   * (plan §8 Q2): one from each paper in turn, so neighbours sit different papers where possible.
   * Roll No is the Enrollment No (plan §8 Q7).
   */
  async process(user: AuthUser, id: string) {
    requireDealing(user);
    const a = await this.load(user, id);
    this.assertOpen(a);
    if (!(a.seats || []).length) throw new BadRequestException('Choose the seating (Continuously / Odd / Even) first.');
    const papers = await this.papersOn(a.instituteId, a.sessionId, a.examDate, a.shiftId);
    const groups = (await this.sittings(a.instituteId, a.sessionId, papers))
      .filter((g) => g.candidates.length)
      .sort(
        (x, y) =>
          byName(x.paper.courseName, y.paper.courseName) ||
          byName(x.paper.specialityName, y.paper.specialityName) ||
          byName(x.paper.paper, y.paper.paper),
      );
    const queue: { paper: PaperRow; candidate: (typeof groups)[number]['candidates'][number] }[] = [];
    for (let i = 0; groups.some((g) => i < g.candidates.length); i++) {
      for (const g of groups) if (i < g.candidates.length) queue.push({ paper: g.paper, candidate: g.candidates[i] });
    }
    if (!queue.length) throw new BadRequestException('No eligible candidate sits a paper on this date and shift.');
    const seats = (a.seats || [])
      .filter((s) => s.active)
      .sort((x, y) => byName(x.hallName, y.hallName) || x.row - y.row || x.seatNo - y.seatNo);
    if (seats.length < queue.length) {
      throw new BadRequestException(
        `Only ${seats.length} active seat(s) for ${queue.length} candidate(s). Switch more seats on, choose Continuously, or add seats in Hall Master.`,
      );
    }
    a.placements = queue.map(({ paper, candidate }, i): AllotmentPlacement => ({
      hallId: seats[i].hallId,
      hallName: seats[i].hallName,
      row: seats[i].row,
      seatNo: seats[i].seatNo,
      examCandidateId: candidate._id as Types.ObjectId,
      paperId: paper._id,
      enrollmentNo: candidate.enrollmentNo,
      name: candidate.name,
      courseName: paper.courseName,
      specialityName: paper.specialityName,
      paper: paper.paper,
    }));
    a.processedAt = new Date();
    await a.save();
    return this.getOne(user, id);
  }

  /** Step 4, Allotment Lock. */
  async lock(user: AuthUser, id: string) {
    requireDealing(user);
    const a = await this.load(user, id);
    this.assertOpen(a);
    if (!(a.placements || []).length) throw new BadRequestException('Process the allotment before locking it.');
    a.locked = true;
    a.lockedBy = { userId: user.userId, name: user.name, at: new Date() };
    await a.save();
    return this.getOne(user, id);
  }

  /** Seat Allotment Reports: locked allotments between two dates, by hall then seat. */
  async report(user: AuthUser, q: { from?: string; to?: string }) {
    const from = text(q?.from, 10);
    const to = text(q?.to, 10);
    if (!DATE.test(from) || !DATE.test(to)) throw new BadRequestException('From Date and To Date are required');
    if (to < from) throw new BadRequestException('To Date must be on or after From Date');
    const rows = await this.allotments.find({ instituteId: iid(user), locked: true, examDate: { $gte: from, $lte: to } }).lean();
    const shifts = await this.shifts.find({ _id: { $in: rows.map((r) => r.shiftId) } }).select('name').lean();
    const shiftName = new Map(shifts.map((s) => [String(s._id), s.name]));
    return rows
      .flatMap((r) =>
        (r.placements || []).map((p) => ({
          examDate: r.examDate,
          shiftName: shiftName.get(String(r.shiftId)) || '',
          hallName: p.hallName,
          row: p.row,
          seatNo: p.seatNo,
          name: p.name,
          rollNo: p.enrollmentNo,
          specialityName: p.specialityName,
          courseName: p.courseName,
          paper: p.paper,
        })),
      )
      .sort(
        (x, y) =>
          x.examDate.localeCompare(y.examDate) ||
          byName(x.shiftName, y.shiftName) ||
          byName(x.hallName, y.hallName) ||
          x.row - y.row ||
          x.seatNo - y.seatNo,
      );
  }
}
