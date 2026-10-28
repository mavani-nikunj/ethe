import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DUTY_ROLES, DUTY_ROLE_LABELS, DUTY_SHIFT_PREFERENCES, DutyRole } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { SupervisorSchedule, SupervisorSession } from '../database/supervisor.schema';
import {
  DutyAllotment,
  DutyNeed,
  DutyRun,
  DutySettings,
  DutySitting,
  DutyStaff,
  DutyStaffMember,
} from '../database/staff-duty.schema';
import { SupervisorService } from '../supervisor/supervisor.service';
import { BulkResult, dayName, escapeRegex, iid, isoDate, oid, oids, text } from '../supervisor/supervisor-access';
import { DutyKind, EngineAllotment, EngineMember, EngineSitting, allot, compareSittings, rankReplacements } from './allotment-engine';
import {
  DEFAULT_SETTINGS,
  canEdit,
  canLock,
  canSeeBank,
  canUnlock,
  requireDealing,
  requireView,
  staffFields,
} from './staff-duty-access';

const ROLE_KEYS = DUTY_ROLES.map((r) => r.key) as string[];
/** DutyNeed field of each role. */
const NEED_FIELD: Record<string, keyof DutyNeed> = {
  ALL_DUTY: 'allDuty',
  SUPERVISOR: 'supervisor',
  INVIGILATOR: 'invigilator',
  SUPPORTING: 'supporting',
};
/** Old duty-list order: Supervisor, Invigilator, Supporting, then All Duty. */
const ROLE_ORDER: Record<string, number> = { SUPERVISOR: 0, INVIGILATOR: 1, SUPPORTING: 2, ALL_DUTY: 3 };
const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

type Lean<T> = T & { _id: Types.ObjectId; createdAt?: Date };
type Session = Lean<SupervisorSession>;

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

@Injectable()
export class StaffDutyService {
  constructor(
    @InjectModel(DutyStaff.name) private staff: Model<DutyStaff>,
    @InjectModel(DutyStaffMember.name) private members: Model<DutyStaffMember>,
    @InjectModel(DutySitting.name) private sittings: Model<DutySitting>,
    @InjectModel(DutyAllotment.name) private allotments: Model<DutyAllotment>,
    @InjectModel(DutyRun.name) private runs: Model<DutyRun>,
    @InjectModel(SupervisorSession.name) private sessions: Model<SupervisorSession>,
    @InjectModel(SupervisorSchedule.name) private schedules: Model<SupervisorSchedule>,
    private supervisor: SupervisorService,
  ) {}

  // ---------------------------------------------------------------- meta, session, run

  async meta(user: AuthUser) {
    requireView(user);
    const m = await this.supervisor.meta(user);
    return {
      sessions: m.sessions,
      activeSessionId: m.activeSessionId,
      months: m.months,
      years: m.years,
      designations: m.designations,
      departments: m.departments,
      shifts: m.shifts.map((s) => s.name),
      roles: DUTY_ROLES,
      shiftPreferences: DUTY_SHIFT_PREFERENCES,
      can: { edit: canEdit(user), lock: canLock(user), unlock: canUnlock(user), seeBank: canSeeBank(user) },
    };
  }

  private async session(user: AuthUser, sessionId: unknown): Promise<Session> {
    requireView(user);
    return (await this.supervisor.resolveSession(user, sessionId)) as Session;
  }

  private async run(session: Session) {
    return this.runs.findOne({ sessionId: session._id }).lean();
  }

  /** Writes that change the allotment are refused while it is locked. */
  private async requireOpen(session: Session) {
    const run = await this.run(session);
    if (run?.status === 'LOCKED') {
      throw new ConflictException('Duty allotment of this session is locked. Ask the Asstt. Controller (Exams) to unlock it first.');
    }
    return run;
  }

  private runView(run: Lean<DutyRun> | null) {
    return {
      status: run?.status || 'OPEN',
      generated: run?.generated || null,
      locked: run?.status === 'LOCKED' ? run.locked || null : null,
      unlocks: run?.unlocks || [],
      settings: { ...DEFAULT_SETTINGS, ...(run?.settings || {}) } as DutySettings,
    };
  }

  // ---------------------------------------------------------------- staff (Add Staff / Duty Assigned)

  /** Session staff with register details; Duty Assigned passes withRole=1. */
  async listMembers(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.session(user, q.sessionId);
    const filter: Record<string, unknown> = { sessionId: session._id };
    if (String(q.withRole) === '1') filter.role = { $in: ROLE_KEYS };
    const rows = await this.members.find(filter).lean();
    const staff = await this.staff.find({ _id: { $in: rows.map((r) => r.staffId) } }).lean();
    const byId = new Map(staff.map((s) => [String(s._id), s]));
    const duties = await this.dutyCounts(session._id);
    const bank = canSeeBank(user);
    return rows
      .map((m) => {
        const s = byId.get(String(m.staffId));
        return {
          _id: m._id,
          staffId: m.staffId,
          code: s?.code || '',
          name: s?.name || '',
          designation: s?.designation || '',
          department: s?.department || '',
          salaryCode: s?.salaryCode || '',
          bankName: bank ? s?.bank?.bankName || '' : '',
          ifsc: bank ? s?.bank?.ifsc || '' : '',
          account: bank ? s?.bank?.account || '' : '',
          accountType: bank ? s?.bank?.accountType || '' : '',
          role: m.role || null,
          roleLabel: m.role ? DUTY_ROLE_LABELS[m.role] : '',
          shiftPreference: m.shiftPreference,
          allot: m.allot,
          unavailable: m.unavailable || [],
          duties: duties.get(String(m.staffId)) || 0,
        };
      })
      .sort(byCode);
  }

  private async dutyCounts(sessionId: Types.ObjectId) {
    const rows = await this.allotments.aggregate([{ $match: { sessionId } }, { $group: { _id: '$staffId', n: { $sum: 1 } } }]).exec();
    return new Map<string, number>(rows.map((r) => [String(r._id), r.n]));
  }

  /** Register search for the "Existing staff" picker. */
  async searchStaff(user: AuthUser, q: Record<string, unknown>) {
    requireView(user);
    const filter: Record<string, unknown> = { instituteId: iid(user), deleted: false };
    const term = text(q.q, 80);
    if (term) {
      const rx = { $regex: escapeRegex(term), $options: 'i' };
      filter.$or = [{ name: rx }, { code: rx }, { salaryCode: rx }];
    }
    const rows = await this.staff.find(filter).limit(50).lean();
    let inSession = new Set<string>();
    if (Types.ObjectId.isValid(String(q.sessionId ?? ''))) {
      const ms = await this.members.find({ sessionId: new Types.ObjectId(String(q.sessionId)) }).select('staffId').lean();
      inSession = new Set(ms.map((m) => String(m.staffId)));
    }
    const bank = canSeeBank(user);
    return rows.sort(byCode).map((s) => ({
      _id: s._id,
      code: s.code,
      name: s.name,
      designation: s.designation || '',
      department: s.department || '',
      salaryCode: s.salaryCode || '',
      bankName: bank ? s.bank?.bankName || '' : '',
      ifsc: bank ? s.bank?.ifsc || '' : '',
      account: bank ? s.bank?.account || '' : '',
      accountType: bank ? s.bank?.accountType || '' : '',
      inSession: inSession.has(String(s._id)),
    }));
  }

  private roleOf(v: unknown): DutyRole | null {
    const r = text(v, 20).toUpperCase().replace(/\s+/g, '_');
    if (!r || r === '0') return null;
    if (!ROLE_KEYS.includes(r)) throw new BadRequestException('Unknown role');
    return r as DutyRole;
  }

  private async codeFree(user: AuthUser, code: string, exceptId?: Types.ObjectId) {
    const dup = await this.staff
      .findOne({ instituteId: iid(user), deleted: false, code: { $regex: `^${escapeRegex(code)}$`, $options: 'i' }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
      .lean();
    if (dup) throw new ConflictException(`Code No. ${code} already belongs to ${dup.name}. Pick them from "Existing staff" instead.`);
  }

  /** Add Examination Staff: a new register entry, or an existing one (staffId), into the session. */
  async addMember(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    const role = this.roleOf(body.role);
    let staffId: Types.ObjectId;
    if (Types.ObjectId.isValid(String(body.staffId ?? ''))) {
      const s = await this.staff.findOne({ _id: String(body.staffId), instituteId: iid(user), deleted: false }).lean();
      if (!s) throw new NotFoundException('Staff not found');
      staffId = s._id;
    } else {
      const f = staffFields(body);
      await this.codeFree(user, f.code);
      const s = await this.staff.create({
        instituteId: iid(user),
        code: f.code,
        name: f.name,
        designation: f.designation,
        department: f.department,
        salaryCode: f.salaryCode,
        bank: { bankName: f.bankName, ifsc: f.ifsc, account: f.account, accountType: f.accountType },
      });
      staffId = s._id;
    }
    if (await this.members.exists({ sessionId: session._id, staffId })) throw new ConflictException('This staff is already added in this session.');
    const m = await this.members.create({ instituteId: iid(user), sessionId: session._id, staffId, role });
    return { _id: m._id, staffId };
  }

  /** Edit: register details and the session role. Preferences are never touched here (old bug 1). */
  async updateMember(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const m = await this.members.findOne({ _id: oid(id, 'Staff'), instituteId: iid(user) });
    if (!m) throw new NotFoundException('Staff not found');
    const f = staffFields(body);
    await this.codeFree(user, f.code, m.staffId);
    const role = this.roleOf(body.role);
    if (role !== (m.role || null)) {
      const n = await this.allotments.countDocuments({ sessionId: m.sessionId, staffId: m.staffId });
      if (n) throw new ConflictException(`This staff has ${n} duties in this session. Remove the duties before changing the role.`);
      m.role = role;
      await m.save();
    }
    await this.staff.updateOne(
      { _id: m.staffId },
      {
        $set: {
          code: f.code,
          name: f.name,
          designation: f.designation,
          department: f.department,
          salaryCode: f.salaryCode,
          bank: { bankName: f.bankName, ifsc: f.ifsc, account: f.account, accountType: f.accountType },
        },
      },
    );
    return { ok: true };
  }

  /** Remove from the session (the register entry stays). Refused for anyone on duty (old bug 15). */
  async removeMembers(user: AuthUser, body: Record<string, unknown>): Promise<BulkResult> {
    requireDealing(user);
    const ids = oids(body.ids);
    const rows = await this.members.find({ _id: { $in: ids }, instituteId: iid(user) }).lean();
    const staff = await this.staff.find({ _id: { $in: rows.map((r) => r.staffId) } }).select('name').lean();
    const name = new Map(staff.map((s) => [String(s._id), s.name]));
    const out: BulkResult = { updated: 0, skipped: [] };
    for (const m of rows) {
      const n = await this.allotments.countDocuments({ sessionId: m.sessionId, staffId: m.staffId });
      if (n) {
        out.skipped.push({ id: String(m._id), name: name.get(String(m.staffId)) || '', reason: `has ${n} duties; remove them on Duty Allotment first` });
        continue;
      }
      await this.members.deleteOne({ _id: m._id });
      out.updated++;
    }
    return out;
  }

  /** New session: bring the staff list (with roles) from another session; preferences start fresh. */
  async copyFrom(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    const from = await this.session(user, body.fromSessionId);
    if (String(from._id) === String(session._id)) throw new BadRequestException('Choose another session to copy from');
    const [source, existing, live] = await Promise.all([
      this.members.find({ sessionId: from._id }).lean(),
      this.members.find({ sessionId: session._id }).select('staffId').lean(),
      this.staff.find({ instituteId: iid(user), deleted: false }).select('_id').lean(),
    ]);
    const have = new Set(existing.map((m) => String(m.staffId)));
    const ok = new Set(live.map((s) => String(s._id)));
    const add = source.filter((m) => !have.has(String(m.staffId)) && ok.has(String(m.staffId)));
    if (add.length) {
      await this.members.insertMany(
        add.map((m) => ({ instituteId: iid(user), sessionId: session._id, staffId: m.staffId, role: m.role || null })),
      );
    }
    return { added: add.length, alreadyThere: source.length - add.length };
  }

  // ---------------------------------------------------------------- exam duty (sittings)

  /** Staff of each role who may be allotted (old "Available (n)"). */
  private async available(sessionId: Types.ObjectId) {
    const rows = await this.members.aggregate([{ $match: { sessionId, role: { $in: ROLE_KEYS } } }, { $group: { _id: '$role', n: { $sum: 1 } } }]).exec();
    const out: Record<string, number> = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0]));
    for (const r of rows) out[r._id] = r.n;
    return out;
  }

  async listSittings(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.session(user, q.sessionId);
    const [rows, schedule, filled, available, run] = await Promise.all([
      this.sittings.find({ sessionId: session._id }).lean(),
      this.schedules.find({ sessionId: session._id }).lean(),
      this.allotments.aggregate([{ $match: { sessionId: session._id } }, { $group: { _id: { s: '$sittingId', d: '$dutyAs' }, n: { $sum: 1 } } }]).exec(),
      this.available(session._id),
      this.run(session),
    ]);
    const fill = new Map<string, number>(filled.map((f) => [`${f._id.s}|${f._id.d}`, f.n]));
    const sched = new Map(schedule.map((s) => [String(s._id), s]));
    const added = new Set(rows.map((r) => String(r.scheduleId)));
    const sittings = rows
      .sort(compareSittings)
      .map((r) => {
        const allotted = Object.fromEntries(ROLE_KEYS.map((k) => [NEED_FIELD[k], fill.get(`${r._id}|${k}`) || 0])) as unknown as DutyNeed;
        const needTotal = ROLE_KEYS.reduce((n, k) => n + (r.need[NEED_FIELD[k]] || 0), 0);
        const shortTotal = ROLE_KEYS.reduce((n, k) => n + Math.max(0, (r.need[NEED_FIELD[k]] || 0) - allotted[NEED_FIELD[k]]), 0);
        const s = sched.get(String(r.scheduleId));
        return {
          _id: r._id,
          scheduleId: r.scheduleId,
          examDate: r.examDate,
          day: dayName(r.examDate),
          shift: r.shift,
          examName: s?.examName || '',
          studentCount: s?.studentCount ?? null,
          need: r.need,
          allotted,
          needTotal,
          allottedTotal: ROLE_KEYS.reduce((n, k) => n + allotted[NEED_FIELD[k]], 0),
          short: shortTotal,
        };
      });
    return {
      sittings,
      schedule: schedule
        .sort(compareSittings)
        .map((s) => ({ _id: s._id, examDate: s.examDate, day: dayName(s.examDate), shift: s.shift, examName: s.examName, studentCount: s.studentCount, added: added.has(String(s._id)) })),
      available,
      run: this.runView(run as Lean<DutyRun> | null),
      session: { _id: session._id, month: session.month, year: session.year },
    };
  }

  /** Old AddStaffforDuty checks: each count ≤ Available, wording kept (typo fixed). */
  private needOf(body: Record<string, unknown>, available: Record<string, number>): DutyNeed {
    const src = (body.need && typeof body.need === 'object' ? body.need : body) as Record<string, unknown>;
    const need = {} as DutyNeed;
    for (const r of DUTY_ROLES) {
      const raw = src[NEED_FIELD[r.key]];
      const n = raw === '' || raw === undefined || raw === null ? 0 : Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`Enter a whole number for ${r.need} Duty.`);
      if (n > available[r.key]) throw new BadRequestException(`Please enter less than Available ${r.need} Duty (${available[r.key]}).`);
      need[NEED_FIELD[r.key]] = n;
    }
    if (!Object.values(need).some((n) => n > 0)) throw new BadRequestException('Please enter atleast 1 Duty.');
    return need;
  }

  async createSitting(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    await this.requireOpen(session);
    if (!Types.ObjectId.isValid(String(body.scheduleId ?? ''))) throw new BadRequestException('Please select Exam Date and Exam Shift.');
    const sched = await this.schedules.findOne({ _id: String(body.scheduleId), sessionId: session._id }).lean();
    if (!sched) throw new BadRequestException('This exam date and shift is not in the Supervisor schedule of the session.');
    if (await this.sittings.exists({ sessionId: session._id, examDate: sched.examDate, shift: sched.shift })) {
      throw new ConflictException('Already added this exam date/Shift!');
    }
    const need = this.needOf(body, await this.available(session._id));
    const row = await this.sittings.create({
      instituteId: iid(user),
      sessionId: session._id,
      scheduleId: sched._id,
      examDate: sched.examDate,
      shift: sched.shift,
      need,
    });
    return { _id: row._id };
  }

  async updateSitting(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const row = await this.sittings.findOne({ _id: oid(id, 'Exam duty'), instituteId: iid(user) });
    if (!row) throw new NotFoundException('Exam duty not found');
    const session = await this.session(user, row.sessionId);
    await this.requireOpen(session);
    row.need = this.needOf(body, await this.available(session._id));
    row.markModified('need');
    await row.save();
    return { ok: true };
  }

  /** Delete / Delete Selected: the sitting and everyone on it. */
  async deleteSittings(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const rows = await this.sittings.find({ _id: { $in: oids(body.ids) }, instituteId: iid(user) }).lean();
    if (!rows.length) throw new BadRequestException('Please select atleast 1 data to delete.');
    for (const sid of new Set(rows.map((r) => String(r.sessionId)))) await this.requireOpen(await this.session(user, sid));
    const ids = rows.map((r) => r._id);
    const dropped = await this.allotments.deleteMany({ sittingId: { $in: ids } });
    await this.sittings.deleteMany({ _id: { $in: ids } });
    return { deleted: ids.length, dutiesRemoved: dropped.deletedCount || 0 };
  }

  // ---------------------------------------------------------------- staff preference

  async listPreferences(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.session(user, q.sessionId);
    const examDate = isoDate(q.examDate);
    const shift = text(q.shift, 20);
    const rows = await this.listMembers(user, { sessionId: session._id, withRole: '1' });
    return rows.map((r) => ({
      _id: r._id,
      code: r.code,
      name: r.name,
      designation: r.designation,
      role: r.role,
      roleLabel: r.roleLabel,
      shiftPreference: r.shiftPreference,
      allot: r.allot,
      /** For one sitting: may this person be put on it? */
      availableOnSitting: examDate && shift ? !r.unavailable.some((u) => u.examDate === examDate && u.shift === shift) : null,
      unavailableCount: r.unavailable.length,
      duties: r.duties,
    }));
  }

  /** Save Preferences: only rows that changed. With a date + shift the tick means "available on that sitting". */
  async savePreferences(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    await this.requireOpen(session);
    const changes = Array.isArray(body.changes) ? (body.changes as Record<string, unknown>[]) : [];
    if (!changes.length) throw new BadRequestException('Please change atleast 1 Staff.');
    let updated = 0;
    for (const c of changes) {
      const id = oid(c.memberId, 'Staff');
      const examDate = isoDate(c.examDate);
      const shift = text(c.shift, 20);
      if (examDate && shift) {
        const entry = { examDate, shift };
        const res =
          c.available === false
            ? await this.members.updateOne({ _id: id, sessionId: session._id }, { $addToSet: { unavailable: entry } })
            : await this.members.updateOne({ _id: id, sessionId: session._id }, { $pull: { unavailable: entry } });
        updated += res.matchedCount;
        continue;
      }
      const set: Record<string, unknown> = {};
      if (c.shiftPreference !== undefined) {
        const p = text(c.shiftPreference, 20);
        if (!(DUTY_SHIFT_PREFERENCES as readonly string[]).includes(p)) throw new BadRequestException('Unknown shift preference');
        set.shiftPreference = p;
      }
      if (c.allot !== undefined) set.allot = Boolean(c.allot);
      if (!Object.keys(set).length) continue;
      const res = await this.members.updateOne({ _id: id, sessionId: session._id }, { $set: set });
      updated += res.matchedCount;
    }
    return { updated };
  }

  /** Clear Preferences (old): drops the allotment and resets every preference to All + allotted. */
  async clearPreferences(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    await this.requireOpen(session);
    const dropped = await this.allotments.deleteMany({ sessionId: session._id });
    await this.members.updateMany({ sessionId: session._id }, { $set: { shiftPreference: 'ANY', allot: true, unavailable: [] } });
    await this.runs.updateOne({ sessionId: session._id }, { $unset: { generated: 1 }, $set: { shortfalls: [] } });
    return { dutiesRemoved: dropped.deletedCount || 0 };
  }

  // ---------------------------------------------------------------- allotment

  private engineMembers(rows: Lean<DutyStaffMember>[], staff: Map<string, Lean<DutyStaff>>, previous: Map<string, number>): EngineMember[] {
    return rows
      .filter((m) => m.role && staff.has(String(m.staffId)))
      .map((m) => ({
        staffId: String(m.staffId),
        code: staff.get(String(m.staffId))!.code,
        role: m.role as DutyKind,
        shiftPreference: m.shiftPreference || 'ANY',
        allot: m.allot !== false,
        unavailable: m.unavailable || [],
        previousLoad: previous.get(String(m.staffId)) || 0,
      }));
  }

  private engineSitting(s: Lean<DutySitting>): EngineSitting {
    return {
      id: String(s._id),
      examDate: s.examDate,
      shift: s.shift,
      need: Object.fromEntries(ROLE_KEYS.map((k) => [k, s.need[NEED_FIELD[k]] || 0])),
    };
  }

  private engineRow(a: Lean<DutyAllotment>): EngineAllotment {
    return { sittingId: String(a.sittingId), staffId: String(a.staffId), memberRole: a.memberRole as DutyKind, dutyAs: a.dutyAs as DutyKind, source: a.source };
  }

  /** Duties per staff in the latest earlier session that has an allotment (carry-over, Decision 3). */
  private async previousLoad(user: AuthUser, session: Session) {
    const earlier = await this.sessions
      .find({ instituteId: iid(user), _id: { $ne: session._id }, createdAt: { $lt: session.createdAt || new Date() } })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean();
    for (const s of earlier) {
      const rows = await this.allotments.aggregate([{ $match: { sessionId: s._id } }, { $group: { _id: '$staffId', n: { $sum: 1 } } }]).exec();
      if (rows.length) return new Map<string, number>(rows.map((r) => [String(r._id), r.n]));
    }
    return new Map<string, number>();
  }

  private async engineInput(user: AuthUser, session: Session) {
    const [sittings, memberRows, existing, previous] = await Promise.all([
      this.sittings.find({ sessionId: session._id }).lean(),
      this.members.find({ sessionId: session._id }).lean(),
      this.allotments.find({ sessionId: session._id }).lean(),
      this.previousLoad(user, session),
    ]);
    const staff = await this.staff.find({ _id: { $in: memberRows.map((m) => m.staffId) }, deleted: false }).lean();
    const staffMap = new Map(staff.map((s) => [String(s._id), s as Lean<DutyStaff>]));
    return {
      sittings: sittings as Lean<DutySitting>[],
      members: this.engineMembers(memberRows as Lean<DutyStaffMember>[], staffMap, previous),
      existing: existing as Lean<DutyAllotment>[],
      staffMap,
    };
  }

  /**
   * Lock Preferences (old name kept): allot every sitting.
   * mode: keep-manual (default) rebuilds the automatic rows around manual changes; rebuild starts again;
   * fill-gaps keeps everything and only tops up short sittings.
   */
  async allot(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    await this.requireOpen(session);
    const mode = ['rebuild', 'keep-manual', 'fill-gaps'].includes(String(body.mode)) ? String(body.mode) : 'keep-manual';
    const input = await this.engineInput(user, session);
    if (!input.sittings.length) throw new BadRequestException('Add Exam Duty first.');
    if (!input.members.length) throw new BadRequestException('No staff has a role in this session. Set the role on Add Staff first.');
    let fixed: Lean<DutyAllotment>[] = [];
    if (mode === 'rebuild') {
      await this.allotments.deleteMany({ sessionId: session._id });
    } else if (mode === 'keep-manual') {
      await this.allotments.deleteMany({ sessionId: session._id, source: 'AUTO' });
      fixed = input.existing.filter((a) => a.source !== 'AUTO');
    } else {
      fixed = input.existing;
    }
    const result = allot({ sittings: input.sittings.map((s) => this.engineSitting(s)), members: input.members, fixed: fixed.map((a) => this.engineRow(a)) });
    const sittingById = new Map(input.sittings.map((s) => [String(s._id), s]));
    if (result.allotments.length) {
      await this.allotments.insertMany(
        result.allotments.map((a) => {
          const s = sittingById.get(a.sittingId)!;
          return {
            instituteId: iid(user),
            sessionId: session._id,
            sittingId: s._id,
            examDate: s.examDate,
            shift: s.shift,
            staffId: new Types.ObjectId(a.staffId),
            memberRole: a.memberRole,
            dutyAs: a.dutyAs,
            source: 'AUTO',
            by: new Types.ObjectId(user.userId),
          };
        }),
      );
    }
    await this.runs.updateOne(
      { sessionId: session._id },
      {
        $set: { instituteId: iid(user), generated: { at: new Date(), by: String(user.userId), byName: user.name || user.email, mode }, shortfalls: result.shortfalls },
        $setOnInsert: { status: 'OPEN' },
      },
      { upsert: true },
    );
    return { mode, added: result.allotments.length, kept: fixed.length, shortfalls: result.shortfalls, total: result.allotments.length + fixed.length };
  }

  /** View And Lock list: who is on which sitting, with the duty count of each person. */
  async listAllotments(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.session(user, q.sessionId);
    const filter: Record<string, unknown> = { sessionId: session._id };
    const examDate = isoDate(q.examDate);
    const shift = text(q.shift, 20);
    if (examDate) filter.examDate = examDate;
    if (shift) filter.shift = shift;
    const [rows, all, run, sittingsView] = await Promise.all([
      this.allotments.find(filter).lean(),
      this.allotments.find({ sessionId: session._id }).select('staffId').lean(),
      this.run(session),
      this.listSittings(user, { sessionId: session._id }),
    ]);
    const staffIds = [...new Set(all.map((a) => String(a.staffId)))];
    const staff = await this.staff.find({ _id: { $in: staffIds } }).lean();
    const byId = new Map(staff.map((s) => [String(s._id), s]));
    const load = new Map<string, number>();
    for (const a of all) load.set(String(a.staffId), (load.get(String(a.staffId)) || 0) + 1);
    const members = await this.members.find({ sessionId: session._id, staffId: { $in: staffIds } }).select('staffId role').lean();
    const roleOf = new Map(members.map((m) => [String(m.staffId), m.role || '']));
    const view = rows
      .map((a) => {
        const s = byId.get(String(a.staffId));
        return {
          _id: a._id,
          sittingId: a.sittingId,
          examDate: a.examDate,
          day: dayName(a.examDate),
          shift: a.shift,
          staffId: a.staffId,
          code: s?.code || '',
          name: s?.name || '',
          designation: s?.designation || '',
          department: s?.department || '',
          memberRole: a.memberRole,
          roleLabel: DUTY_ROLE_LABELS[a.memberRole] || a.memberRole,
          dutyAs: a.dutyAs,
          dutyAsLabel: DUTY_ROLE_LABELS[a.dutyAs] || a.dutyAs,
          source: a.source,
          duties: load.get(String(a.staffId)) || 0,
        };
      })
      .sort((a, b) => compareSittings(a, b) || (ROLE_ORDER[a.memberRole] ?? 9) - (ROLE_ORDER[b.memberRole] ?? 9) || byCode(a, b));
    const loadView = staffIds
      .map((id) => ({ staffId: id, code: byId.get(id)?.code || '', name: byId.get(id)?.name || '', role: roleOf.get(id) || '', duties: load.get(id) || 0 }))
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || byCode(a, b));
    const shortfalls = sittingsView.sittings.flatMap((s) =>
      DUTY_ROLES.filter((r) => s.need[NEED_FIELD[r.key]] > s.allotted[NEED_FIELD[r.key]]).map((r) => ({
        sittingId: s._id,
        examDate: s.examDate,
        shift: s.shift,
        dutyAs: r.key,
        dutyAsLabel: r.label,
        missing: s.need[NEED_FIELD[r.key]] - s.allotted[NEED_FIELD[r.key]],
      })),
    );
    return { rows: view, load: loadView, shortfalls, run: this.runView(run as Lean<DutyRun> | null), totalDuties: all.length };
  }

  private async openAllotment(user: AuthUser, id: string) {
    const a = await this.allotments.findOne({ _id: oid(id, 'Duty'), instituteId: iid(user) }).lean();
    if (!a) throw new NotFoundException('Duty not found');
    const session = await this.session(user, a.sessionId);
    return { a: a as Lean<DutyAllotment>, session };
  }

  private async named(user: AuthUser, list: { staffId: string; load: number }[], staffMap: Map<string, Lean<DutyStaff>>, roles: Map<string, string>) {
    return list.map((c) => {
      const s = staffMap.get(c.staffId);
      const role = roles.get(c.staffId) || '';
      return { staffId: c.staffId, code: s?.code || '', name: s?.name || '', designation: s?.designation || '', role, roleLabel: DUTY_ROLE_LABELS[role] || '', duties: c.load };
    });
  }

  /** Change Staff Duty: same role, available for the sitting, not on it; lowest load first (old bug 10). */
  async replacements(user: AuthUser, id: string) {
    const { a, session } = await this.openAllotment(user, id);
    const input = await this.engineInput(user, session);
    const sitting = input.sittings.find((s) => String(s._id) === String(a.sittingId));
    if (!sitting) throw new NotFoundException('Exam duty not found');
    const list = rankReplacements({
      sitting: this.engineSitting(sitting),
      sittings: input.sittings.map((s) => this.engineSitting(s)),
      members: input.members,
      allotments: input.existing.map((x) => this.engineRow(x)),
      role: a.memberRole as DutyKind,
    });
    const roles = new Map(input.members.map((m) => [m.staffId, m.role || '']));
    const current = input.staffMap.get(String(a.staffId));
    return {
      current: { _id: a._id, name: current?.name || '', code: current?.code || '', examDate: a.examDate, day: dayName(a.examDate), shift: a.shift, role: a.memberRole, roleLabel: DUTY_ROLE_LABELS[a.memberRole] || '' },
      candidates: await this.named(user, list, input.staffMap, roles),
    };
  }

  async replace(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const { a, session } = await this.openAllotment(user, id);
    await this.requireOpen(session);
    const pickId = String(body.staffId ?? '');
    const { candidates } = await this.replacements(user, id);
    if (!candidates.some((c) => c.staffId === pickId)) throw new BadRequestException('Please select an available staff to replace by.');
    await this.allotments.updateOne(
      { _id: a._id },
      { $set: { staffId: new Types.ObjectId(pickId), source: 'REPLACEMENT', replacedStaffId: a.staffId, by: new Types.ObjectId(user.userId) } },
    );
    return { ok: true };
  }

  async deleteAllotments(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const rows = await this.allotments.find({ _id: { $in: oids(body.ids) }, instituteId: iid(user) }).lean();
    if (!rows.length) throw new BadRequestException('Select the duty to remove');
    for (const sid of new Set(rows.map((r) => String(r.sessionId)))) await this.requireOpen(await this.session(user, sid));
    await this.allotments.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
    return { deleted: rows.length };
  }

  /** Add Staff to Sitting: candidates for one requirement of a sitting (supervisors may cover Invigilator / Supporting). */
  async sittingCandidates(user: AuthUser, sittingId: string, q: Record<string, unknown>) {
    const sitting = await this.sittings.findOne({ _id: oid(sittingId, 'Exam duty'), instituteId: iid(user) }).lean();
    if (!sitting) throw new NotFoundException('Exam duty not found');
    const session = await this.session(user, sitting.sessionId);
    const dutyAs = this.roleOf(q.dutyAs);
    if (!dutyAs) throw new BadRequestException('Select the duty');
    const input = await this.engineInput(user, session);
    const base = {
      sitting: this.engineSitting(sitting as Lean<DutySitting>),
      sittings: input.sittings.map((s) => this.engineSitting(s)),
      members: input.members,
      allotments: input.existing.map((x) => this.engineRow(x)),
    };
    let list = rankReplacements({ ...base, role: dutyAs as DutyKind });
    if (dutyAs === 'INVIGILATOR' || dutyAs === 'SUPPORTING') list = [...list, ...rankReplacements({ ...base, role: 'SUPERVISOR' })];
    const roles = new Map(input.members.map((m) => [m.staffId, m.role || '']));
    return this.named(user, list, input.staffMap, roles);
  }

  async addAllotment(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const sitting = await this.sittings.findOne({ _id: oid(body.sittingId, 'Exam duty'), instituteId: iid(user) }).lean();
    if (!sitting) throw new NotFoundException('Exam duty not found');
    const session = await this.session(user, sitting.sessionId);
    await this.requireOpen(session);
    const dutyAs = this.roleOf(body.dutyAs);
    if (!dutyAs) throw new BadRequestException('Select the duty');
    const candidates = await this.sittingCandidates(user, String(sitting._id), { dutyAs });
    const pick = candidates.find((c) => c.staffId === String(body.staffId ?? ''));
    if (!pick) throw new BadRequestException('Please select an available staff.');
    await this.allotments.create({
      instituteId: iid(user),
      sessionId: session._id,
      sittingId: sitting._id,
      examDate: sitting.examDate,
      shift: sitting.shift,
      staffId: new Types.ObjectId(pick.staffId),
      memberRole: pick.role,
      dutyAs,
      source: 'MANUAL',
      by: new Types.ObjectId(user.userId),
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- lock

  async lock(user: AuthUser, body: Record<string, unknown>) {
    if (!canLock(user)) throw new ForbiddenException('Only the Dealing Assistant or the Asstt. Controller (Exams) can lock');
    const session = await this.session(user, body.sessionId);
    const run = await this.run(session);
    if (run?.status === 'LOCKED') throw new ConflictException('Already locked.');
    if (!(await this.allotments.exists({ sessionId: session._id }))) throw new BadRequestException('Nothing to lock: allot the duties first.');
    await this.runs.updateOne(
      { sessionId: session._id },
      { $set: { instituteId: iid(user), status: 'LOCKED', locked: { at: new Date(), by: String(user.userId), byName: user.name || user.email } } },
      { upsert: true },
    );
    return { ok: true };
  }

  async unlock(user: AuthUser, body: Record<string, unknown>) {
    if (!canUnlock(user)) throw new ForbiddenException('Only the Asstt. Controller (Exams) can unlock');
    const session = await this.session(user, body.sessionId);
    const reason = text(body.reason, 500);
    if (!reason) throw new BadRequestException('Please enter the reason to unlock.');
    const run = await this.run(session);
    if (run?.status !== 'LOCKED') throw new ConflictException('This session is not locked.');
    await this.runs.updateOne(
      { sessionId: session._id },
      { $set: { status: 'OPEN' }, $unset: { locked: 1 }, $push: { unlocks: { at: new Date(), by: String(user.userId), byName: user.name || user.email, reason } } },
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------- duty lists

  async updateSettings(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const session = await this.session(user, body.sessionId);
    const rt = (body.reportingTime || {}) as Record<string, unknown>;
    const notes = (Array.isArray(body.notes) ? body.notes : []).map((n) => text(n, 600)).filter(Boolean).slice(0, 10);
    const settings: DutySettings = {
      reportingTime: { Morning: text(rt.Morning, 20) || DEFAULT_SETTINGS.reportingTime.Morning, Evening: text(rt.Evening, 20) || DEFAULT_SETTINGS.reportingTime.Evening },
      notes: notes.length ? notes : DEFAULT_SETTINGS.notes,
      titlePeriod: text(body.titlePeriod, 80).toUpperCase(),
    };
    await this.runs.updateOne({ sessionId: session._id }, { $set: { instituteId: iid(user), settings }, $setOnInsert: { status: 'OPEN' } }, { upsert: true });
    return settings;
  }

  /**
   * Old StaffReport: kind=all-duty → "FACULTY / STAFF" list (All Duty staff);
   * kind=others → "STAFF" list (Supervisor, Invigilator, Supporting) with the IMPORTANT notes.
   * Rows: staff with at least one duty, by role then Code; cells D / X per date × M/E; Total Days.
   */
  async dutyList(user: AuthUser, q: Record<string, unknown>) {
    const session = await this.session(user, q.sessionId);
    const kind = String(q.kind) === 'all-duty' ? 'all-duty' : 'others';
    const [sittings, rows, run] = await Promise.all([
      this.sittings.find({ sessionId: session._id }).lean(),
      this.allotments.find({ sessionId: session._id }).lean(),
      this.run(session),
    ]);
    const { settings, status } = this.runView(run as Lean<DutyRun> | null);
    const dates = [...new Set(sittings.map((s) => s.examDate))].sort();
    const wanted = (role: string) => (kind === 'all-duty' ? role === 'ALL_DUTY' : role !== 'ALL_DUTY');
    const mine = rows.filter((r) => wanted(r.memberRole));
    const staff = await this.staff.find({ _id: { $in: [...new Set(mine.map((r) => String(r.staffId)))] } }).lean();
    const people = staff
      .map((s) => {
        const duties = mine.filter((r) => String(r.staffId) === String(s._id));
        const cells: Record<string, 'D' | 'X'> = {};
        for (const d of dates) for (const sh of ['Morning', 'Evening']) cells[`${d}|${sh}`] = duties.some((r) => r.examDate === d && r.shift === sh) ? 'D' : 'X';
        return { staffId: s._id, code: s.code, name: s.name, role: duties[0]?.memberRole || '', total: duties.length, cells };
      })
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || byCode(a, b));
    const groups = DUTY_ROLES.filter((r) => wanted(r.key))
      .sort((a, b) => ROLE_ORDER[a.key] - ROLE_ORDER[b.key])
      .map((r) => ({ role: r.key, heading: `${r.key === 'INVIGILATOR' ? 'INVIGILATION' : r.label.toUpperCase()} DUTY`, people: people.filter((p) => p.role === r.key) }))
      .filter((g) => g.people.length);
    const period = settings.titlePeriod || periodOf(dates);
    return {
      kind,
      title: `${kind === 'all-duty' ? 'DUTY LIST FOR FACULTY / STAFF' : 'DUTY LIST FOR STAFF'} OF EXAMINATION SECTION FOR PROFESSIONAL EXAMINATION${period ? ` ${period}` : ''}`,
      reportingTime: settings.reportingTime,
      notes: kind === 'others' ? settings.notes : [],
      dates: dates.map((d) => ({ examDate: d, day: dayName(d), shifts: sittings.filter((s) => s.examDate === d).map((s) => s.shift) })),
      groups,
      status,
      signatories: ['Asstt. Controller (Exams)', 'Associate Dean (Exams)'],
      session: { month: session.month, year: session.year },
      settings,
    };
  }
}

/** "MAY 2022 TO JUNE 2022" from the first and last exam date. */
function periodOf(dates: string[]) {
  if (!dates.length) return '';
  const label = (iso: string) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const a = label(dates[0]);
  const b = label(dates[dates.length - 1]);
  return a === b ? a : `${a} TO ${b}`;
}
