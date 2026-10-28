import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileStatus, cleanMobile, isValidEmail, isValidMobile, normalizeEmail } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { ExamCandidate, ExamCandidateSource } from '../database/exam-candidate.schema';
import { ThesisFile } from '../database/thesis-file.schema';
import { AcademicSession, Course, Department, Speciality } from '../database/masters.schema';
import { ExamPapersService } from './exam-papers.service';
import {
  BulkResult,
  assertCourseInScope,
  canEdit,
  courseScope,
  escapeRegex,
  iid as instituteOf,
  inCourseScope,
  isDean,
  oid,
  requireDealing,
  resolveSessionId,
  text,
} from './eligible-access';

const SRC = ExamCandidateSource;

/** List pages of the menu; keys match the web routes. */
const VIEWS: Record<string, { eligible?: boolean; withPaper?: boolean }> = {
  eligible: { eligible: true },
  'not-eligible': { eligible: false },
  // Eligible Candidate Seat Allotment: eligible candidates × the papers of their speciality.
  'with-paper': { eligible: true, withPaper: true },
};

@Injectable()
export class EligibleService {
  constructor(
    @InjectModel(ExamCandidate.name) private candidates: Model<ExamCandidate>,
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(Department.name) private departments: Model<Department>,
    private papers: ExamPapersService,
  ) {}

  // ---------- roles & scope ----------

  private assertInScope(user: AuthUser, row: { instituteId: unknown; courseId?: unknown }) {
    if (String(row.instituteId) !== String(user.instituteId)) throw new NotFoundException('Candidate not found');
    assertCourseInScope(user, row.courseId);
  }

  private event(user: AuthUser, action: string, reason?: string) {
    return { action, at: new Date(), by: user.userId, byName: user.name, ...(reason ? { reason } : {}) };
  }

  resolveSessionId(user: AuthUser, sessionId?: string) {
    return resolveSessionId(this.sessions, user, sessionId);
  }

  // ---------- meta & masters ----------

  async meta(user: AuthUser) {
    const iid = instituteOf(user);
    const scope = courseScope(user);
    const courseFilter: Record<string, unknown> = { instituteId: iid, active: { $ne: false } };
    if (scope) courseFilter._id = { $in: scope };
    const [sessions, courses, departments] = await Promise.all([
      this.sessions.find({ instituteId: iid }).sort({ year: -1, createdAt: -1 }).lean(),
      this.courses.find(courseFilter).sort({ name: 1 }).lean(),
      this.departments.find({ instituteId: iid, active: { $ne: false } }).sort({ name: 1 }).lean(),
    ]);
    const specialities = await this.specialities
      .find({ instituteId: iid, courseId: { $in: courses.map((c) => c._id) } })
      .sort({ name: 1 })
      .lean();
    const current = sessions.find((s) => s.current);
    return {
      sessions: sessions.map((s) => ({ _id: s._id, month: s.month, year: s.year, current: !!s.current })),
      currentSessionId: current?._id || null,
      courses: courses.map((c) => ({ _id: c._id, name: c.name, departmentId: c.departmentId || null })),
      specialities: specialities.map((s) => ({ _id: s._id, name: s.name, courseId: s.courseId })),
      departments: departments.map((d) => ({ _id: d._id, name: d.name })),
      can: { edit: canEdit(user) },
      scopeNote:
        isDean(user) && !courses.length
          ? 'No courses are mapped to your login. Ask the Institute Admin to tick your courses under Masters → Staff.'
          : null,
    };
  }

  /** "+" next to Name of Speciality on Add Old Candidate. */
  async addSpeciality(user: AuthUser, body: { courseId?: string; name?: string }) {
    requireDealing(user);
    const iid = instituteOf(user);
    const courseId = oid(body?.courseId, 'Course');
    const name = text(body?.name, 160);
    if (!name) throw new BadRequestException('Speciality Name is required');
    if (!(await this.courses.exists({ _id: courseId, instituteId: iid }))) throw new BadRequestException('Course not found');
    assertCourseInScope(user, courseId);
    const clash = await this.specialities.findOne({ instituteId: iid, courseId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean();
    if (clash) throw new BadRequestException('This speciality already exists for the course');
    const row = await this.specialities.create({ instituteId: iid, courseId, name });
    return { _id: row._id, name: row.name, courseId: row.courseId };
  }

  /** "+" next to Name of Department on Add Old Candidate. */
  async addDepartment(user: AuthUser, body: { name?: string }) {
    requireDealing(user);
    const iid = instituteOf(user);
    const name = text(body?.name, 160);
    if (!name) throw new BadRequestException('Department Name is required');
    const clash = await this.departments.findOne({ instituteId: iid, name: new RegExp(`^${escapeRegex(name)}$`, 'i') }).lean();
    if (clash) throw new BadRequestException('This department already exists');
    const row = await this.departments.create({ instituteId: iid, name });
    return { _id: row._id, name: row.name };
  }

  // ---------- thesis sync ----------

  /**
   * Thesis candidates of the session become "New" exam candidates. Every thesis file sent to the
   * Examination Section counts (old behaviour, plan §8 Q1). Eligibility decisions are kept; Old rows
   * that share an enrollment no. are never overwritten.
   */
  async syncThesis(instituteId: Types.ObjectId, sessionId: Types.ObjectId) {
    const sessionIds: any[] = [sessionId, String(sessionId)];
    const [files, existing] = await Promise.all([
      this.files
        .find({ instituteId, sessionId: { $in: sessionIds }, status: { $ne: FileStatus.DRAFT } })
        .select('candidate courseId specialityId departmentId')
        .lean(),
      this.candidates.find({ instituteId, sessionId }).lean(),
    ]);
    const byFile = new Map(existing.filter((r) => r.thesisFileId).map((r) => [String(r.thesisFileId), r]));
    const byEnroll = new Map(existing.map((r) => [r.enrollmentNo.toLowerCase(), r]));
    const seen = new Set<string>();
    const ops: any[] = [];
    for (const f of files) {
      const c = (f as any).candidate || {};
      const enrollmentNo = text(c.enrollmentNo, 50);
      if (!enrollmentNo || !Types.ObjectId.isValid(String(f.courseId)) || !Types.ObjectId.isValid(String(f.specialityId))) continue;
      const fileId = String(f._id);
      seen.add(fileId);
      const fields = {
        enrollmentNo,
        name: text(c.name, 200),
        dob: text(c.dob, 10) || undefined,
        mobile: cleanMobile(c.mobile) || undefined,
        email: normalizeEmail(c.email) || undefined,
        // Thesis files may hold these ids as strings; store real ObjectIds so joins and $in work.
        courseId: new Types.ObjectId(String(f.courseId)),
        specialityId: new Types.ObjectId(String(f.specialityId)),
        departmentId: f.departmentId && Types.ObjectId.isValid(String(f.departmentId)) ? new Types.ObjectId(String(f.departmentId)) : undefined,
        thesisFileId: f._id,
      };
      const row = byFile.get(fileId) || byEnroll.get(enrollmentNo.toLowerCase());
      if (!row) {
        ops.push({
          insertOne: { document: { ...fields, instituteId, sessionId, source: SRC.THESIS, eligible: true, history: [] } },
        });
        continue;
      }
      if (row.source !== SRC.THESIS) continue;
      const clash = byEnroll.get(enrollmentNo.toLowerCase());
      if (clash && String(clash._id) !== String(row._id)) continue;
      ops.push({ updateOne: { filter: { _id: row._id }, update: { $set: fields } } });
    }
    const stale = existing.filter(
      (r) => r.source === SRC.THESIS && r.thesisFileId && !seen.has(String(r.thesisFileId)) && !(r.history || []).length,
    );
    if (stale.length) ops.push({ deleteMany: { filter: { _id: { $in: stale.map((r) => r._id) } } } });
    if (!ops.length) return;
    try {
      await this.candidates.bulkWrite(ops, { ordered: false });
    } catch (err: any) {
      // A duplicate enrollment no. inside the session is skipped; the other rows are still written.
      if (err?.code !== 11000 && !err?.writeErrors) throw err;
    }
  }

  // ---------- lists ----------

  private async decorate(rows: any[]) {
    const ids = (key: string) => [...new Set(rows.map((r) => String(r[key] || '')).filter(Boolean))];
    const [courses, specs, depts, sessions] = await Promise.all([
      this.courses.find({ _id: { $in: ids('courseId') } }).select('name').lean(),
      this.specialities.find({ _id: { $in: ids('specialityId') } }).select('name').lean(),
      this.departments.find({ _id: { $in: ids('departmentId') } }).select('name').lean(),
      this.sessions.find({ _id: { $in: [...ids('sessionId'), ...ids('carriedFromSessionId')] } }).select('month year').lean(),
    ]);
    const names = (list: { _id: unknown; name?: string }[]) => new Map(list.map((x) => [String(x._id), x.name || '']));
    const cm = names(courses);
    const sm = names(specs);
    const dm = names(depts);
    const ssm = new Map(sessions.map((s) => [String(s._id), `${s.month} ${s.year}`]));
    return rows.map((r) => {
      const lastNotEligible = [...(r.history || [])].reverse().find((h: any) => h.action === 'NOT_ELIGIBLE');
      return {
        _id: r._id,
        sessionId: r.sessionId,
        courseId: r.courseId,
        specialityId: r.specialityId,
        departmentId: r.departmentId,
        enrollmentNo: r.enrollmentNo,
        name: r.name,
        dob: r.dob || '',
        mobile: r.mobile || '',
        email: r.email || '',
        source: r.source,
        status: r.source === SRC.THESIS ? 'New' : 'Old',
        eligible: r.eligible !== false,
        notEligibleReason: r.notEligibleReason || '',
        notEligibleBy: lastNotEligible?.byName || '',
        notEligibleAt: lastNotEligible?.at || null,
        courseName: cm.get(String(r.courseId)) || '',
        specialityName: sm.get(String(r.specialityId)) || '',
        departmentName: dm.get(String(r.departmentId)) || '',
        sessionLabel: ssm.get(String(r.sessionId)) || '',
        carriedFrom: r.carriedFromSessionId ? ssm.get(String(r.carriedFromSessionId)) || '' : '',
        history: r.history || [],
      };
    });
  }

  /** Old order: course → speciality → enrollment no. */
  private sortRows<T extends { courseName: string; specialityName: string; enrollmentNo: string }>(rows: T[]) {
    return rows.sort(
      (a, b) =>
        a.courseName.localeCompare(b.courseName) ||
        a.specialityName.localeCompare(b.specialityName) ||
        a.enrollmentNo.localeCompare(b.enrollmentNo, undefined, { numeric: true }),
    );
  }

  private async sessionRows(
    user: AuthUser,
    sessionId: Types.ObjectId,
    q: { courseId?: string; specialityId?: string },
    extra: Record<string, unknown> = {},
  ) {
    const iid = instituteOf(user);
    await this.syncThesis(iid, sessionId);
    const filter: Record<string, unknown> = { instituteId: iid, sessionId, ...extra };
    const scope = courseScope(user);
    if (scope) filter.courseId = { $in: scope };
    if (q.courseId && Types.ObjectId.isValid(q.courseId)) {
      if (!inCourseScope(user, q.courseId)) return [];
      filter.courseId = new Types.ObjectId(q.courseId);
    }
    if (q.specialityId && Types.ObjectId.isValid(q.specialityId)) filter.specialityId = new Types.ObjectId(q.specialityId);
    const rows = await this.candidates.find(filter).lean();
    return this.sortRows(await this.decorate(rows));
  }

  async list(user: AuthUser, q: { view?: string; sessionId?: string; courseId?: string; specialityId?: string }) {
    const view = VIEWS[q.view || 'eligible'];
    if (!view) throw new BadRequestException('Unknown list');
    const sessionId = await this.resolveSessionId(user, q.sessionId);
    // Not-eligible rows are filtered on the server (old screen hid them in the browser).
    const eligibleClause = view.eligible ? { eligible: { $ne: false } } : { eligible: false };
    const rows = await this.sessionRows(user, sessionId, q, eligibleClause);
    if (!view.withPaper) return rows;
    // One row per candidate per paper; a speciality with no paper drops out (old EligebleCandidateCourse).
    const papers = await this.papers.papersFor(instituteOf(user), sessionId);
    const bySpec = new Map<string, typeof papers>();
    for (const p of papers) bySpec.set(String(p.specialityId), [...(bySpec.get(String(p.specialityId)) || []), p]);
    return rows.flatMap((r) =>
      (bySpec.get(String(r.specialityId)) || []).map((p) => ({
        ...r,
        rowKey: `${r._id}-${p._id}`,
        paperId: p._id,
        paper: p.paper,
        examDate: p.examDate,
        shiftName: p.shiftName,
        timeName: p.timeName,
        venue: p.venue,
        fees: p.fees,
      })),
    );
  }

  /** Dashboard tile + menu badges. */
  async counts(user: AuthUser, q: { sessionId?: string }) {
    let sessionId: Types.ObjectId;
    try {
      sessionId = await this.resolveSessionId(user, q.sessionId);
    } catch {
      return { eligible: 0, 'not-eligible': 0, awaitingPaper: 0 };
    }
    const iid = instituteOf(user);
    await this.syncThesis(iid, sessionId);
    const filter: Record<string, unknown> = { instituteId: iid, sessionId };
    const scope = courseScope(user);
    if (scope) filter.courseId = { $in: scope };
    const withPapers = await this.papers.specialitiesWithPapers(iid, sessionId);
    const [eligible, notEligible, awaitingPaper] = await Promise.all([
      this.candidates.countDocuments({ ...filter, eligible: { $ne: false } }),
      this.candidates.countDocuments({ ...filter, eligible: false }),
      // Old Dealing tile: eligible candidates whose speciality has no paper yet (USPCandidate 'EligbleCount').
      this.candidates.countDocuments({ ...filter, eligible: { $ne: false }, specialityId: { $nin: withPapers } }),
    ]);
    return { eligible, 'not-eligible': notEligible, awaitingPaper };
  }

  async getOne(user: AuthUser, id: string) {
    const row = await this.candidates.findById(oid(id, 'Candidate')).lean();
    if (!row) throw new NotFoundException('Candidate not found');
    this.assertInScope(user, row);
    const [decorated] = await this.decorate([row]);
    return decorated;
  }

  // ---------- Add Old Candidate ----------

  private async candidateFields(user: AuthUser, body: Record<string, unknown>) {
    const iid = instituteOf(user);
    const enrollmentNo = text(body.enrollmentNo, 50);
    const name = text(body.name, 200);
    const dob = text(body.dob, 10);
    const mobile = cleanMobile(body.mobile as string);
    const email = normalizeEmail(body.email);
    const errors: string[] = [];
    if (!body.courseId) errors.push('Name of Course is required');
    if (!body.specialityId) errors.push('Name of Speciality is required');
    if (!body.departmentId) errors.push('Name of Department is required');
    if (!enrollmentNo) errors.push('Enrollment No. is required');
    if (!name || name.length < 3) errors.push('Name of Candidate must be at least 3 characters');
    else if (!/^[A-Za-z][A-Za-z .'-]{1,}$/.test(name)) errors.push('Name of Candidate may contain letters, spaces, apostrophes and hyphens only');
    if (!dob) errors.push('DOB of Candidate is required');
    else {
      const d = new Date(dob);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(d.getTime())) errors.push('DOB of Candidate is invalid');
      else if (d > new Date()) errors.push('DOB of Candidate cannot be in the future');
      else if (d < new Date('1920-01-01')) errors.push('DOB of Candidate cannot be before 1920');
    }
    if (!mobile) errors.push('Mobile No. of Candidate is required');
    else if (!isValidMobile(mobile)) errors.push('Mobile No. must be a 10-digit Indian number');
    if (!email) errors.push('Email Id of Candidate is required');
    else if (!isValidEmail(email)) errors.push('Email Id of Candidate is invalid');
    if (errors.length) throw new BadRequestException(errors.join('. '));

    const courseId = oid(body.courseId, 'Name of Course');
    const specialityId = oid(body.specialityId, 'Name of Speciality');
    const departmentId = oid(body.departmentId, 'Name of Department');
    const [course, speciality, department] = await Promise.all([
      this.courses.findOne({ _id: courseId, instituteId: iid }).lean(),
      this.specialities.findOne({ _id: specialityId, instituteId: iid }).lean(),
      this.departments.findOne({ _id: departmentId, instituteId: iid }).lean(),
    ]);
    if (!course) throw new BadRequestException('Course not found');
    if (!inCourseScope(user, courseId)) throw new ForbiddenException('This course is not mapped to your login');
    if (!speciality) throw new BadRequestException('Speciality not found');
    if (speciality.courseId && String(speciality.courseId) !== String(courseId)) {
      throw new BadRequestException('Speciality does not belong to the selected course');
    }
    if (!department) throw new BadRequestException('Department not found');
    return { enrollmentNo, name, dob, mobile, email, courseId, specialityId, departmentId };
  }

  /**
   * Old rule (USPCandidate Insert, returns 2/3/4): enrollment no., email and mobile must be new across
   * every candidate of every session, thesis or exam. The same person in another session is reached
   * through Previous Candidate. On edit, rows of the same person (same original enrollment no.) are ignored.
   */
  private async assertUnique(
    iid: Types.ObjectId,
    f: { enrollmentNo: string; email: string; mobile: string },
    self?: { id: unknown; enrollmentNo: string },
  ) {
    const same = self ? new RegExp(`^${escapeRegex(self.enrollmentNo)}$`, 'i') : null;
    const examNot: Record<string, unknown> = self ? { _id: { $ne: self.id }, enrollmentNo: { $not: same } } : {};
    const fileNot: Record<string, unknown> = self ? { 'candidate.enrollmentNo': { $not: same } } : {};
    const enroll = new RegExp(`^${escapeRegex(f.enrollmentNo)}$`, 'i');
    const hint = ' Use Previous Candidate to bring an earlier candidate into this session.';
    const enrollmentUnchanged = !!self && self.enrollmentNo.toLowerCase() === f.enrollmentNo.toLowerCase();
    const checks: [string, Record<string, unknown>, Record<string, unknown>][] = [
      ['Email Id already exists.', { email: f.email }, { 'candidate.email': f.email }],
      ['Mobile No. already exists.', { mobile: f.mobile }, { 'candidate.mobile': f.mobile }],
    ];
    // A changed enrollment no. can't match the same person, so its check needs no "same person" filter.
    if (!enrollmentUnchanged) {
      checks.unshift(['Enrollment No. already exists.', { enrollmentNo: enroll }, { 'candidate.enrollmentNo': enroll }]);
    }
    for (const [message, examQ, fileQ] of checks) {
      const [exam, file] = await Promise.all([
        this.candidates.exists({ instituteId: iid, ...examNot, ...examQ }),
        this.files.exists({ instituteId: iid, ...fileNot, ...fileQ }),
      ]);
      if (exam || file) throw new BadRequestException(message + (self ? '' : hint));
    }
  }

  async create(user: AuthUser, body: Record<string, unknown>) {
    requireDealing(user);
    const iid = instituteOf(user);
    const sessionId = await this.resolveSessionId(user, body.sessionId as string);
    const fields = await this.candidateFields(user, body);
    await this.assertUnique(iid, fields);
    try {
      const row = await this.candidates.create({
        ...fields,
        instituteId: iid,
        sessionId,
        source: SRC.MANUAL,
        eligible: true,
        history: [this.event(user, 'ADDED')],
        createdBy: new Types.ObjectId(user.userId),
      });
      return this.getOne(user, String(row._id));
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException('Enrollment No. already exists in this session.');
      throw err;
    }
  }

  /** Edit is for Old candidates only; New candidates are edited on their thesis file. */
  async update(user: AuthUser, id: string, body: Record<string, unknown>) {
    requireDealing(user);
    const row = await this.candidates.findById(oid(id, 'Candidate'));
    if (!row) throw new NotFoundException('Candidate not found');
    this.assertInScope(user, row);
    if (row.source === SRC.THESIS) throw new BadRequestException('New candidates come from the thesis file. Edit them on the thesis.');
    const fields = await this.candidateFields(user, body);
    await this.assertUnique(instituteOf(user), fields, { id: row._id, enrollmentNo: row.enrollmentNo });
    Object.assign(row, fields);
    row.history = [...(row.history || []), this.event(user, 'EDITED')];
    try {
      await row.save();
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException('Enrollment No. already exists in this session.');
      throw err;
    }
    return this.getOne(user, id);
  }

  // ---------- Eligible / Not Eligible ----------

  private idList(body: { ids?: unknown }) {
    const ids = (Array.isArray(body?.ids) ? body.ids : []).map(String).filter((id) => Types.ObjectId.isValid(id));
    if (!ids.length) throw new BadRequestException('Select at least one candidate');
    return ids;
  }

  private async setEligible(user: AuthUser, body: { ids?: unknown }, eligible: boolean, reason?: string): Promise<BulkResult> {
    requireDealing(user);
    const ids = this.idList(body);
    const rows = await this.candidates.find({ _id: { $in: ids }, instituteId: instituteOf(user) });
    const result: BulkResult = { updated: 0, skipped: [] };
    const found = new Set(rows.map((r) => String(r._id)));
    for (const id of ids) if (!found.has(id)) result.skipped.push({ id, name: '', reason: 'Candidate not found' });
    for (const row of rows) {
      if (!inCourseScope(user, row.courseId)) {
        result.skipped.push({ id: String(row._id), name: row.name, reason: 'This course is not mapped to your login' });
        continue;
      }
      if ((row.eligible !== false) === eligible) {
        result.skipped.push({ id: String(row._id), name: row.name, reason: eligible ? 'Already eligible' : 'Already not eligible' });
        continue;
      }
      row.eligible = eligible;
      row.notEligibleReason = eligible ? undefined : reason;
      row.history = [...(row.history || []), this.event(user, eligible ? 'ELIGIBLE' : 'NOT_ELIGIBLE', reason)];
      await row.save();
      result.updated += 1;
    }
    return result;
  }

  markNotEligible(user: AuthUser, body: { ids?: unknown; reason?: string }) {
    const reason = text(body?.reason, 500);
    if (!reason) throw new BadRequestException('Reason is required');
    return this.setEligible(user, body, false, reason);
  }

  markEligible(user: AuthUser, body: { ids?: unknown }) {
    return this.setEligible(user, body, true);
  }

  // ---------- Previous Candidate ----------

  /** Every candidate (Old and New) of a past session. */
  async previous(user: AuthUser, q: { sessionId?: string; courseId?: string; specialityId?: string }) {
    if (!q.sessionId || !Types.ObjectId.isValid(q.sessionId)) throw new BadRequestException('Session Month and Session Year are required');
    if (!q.courseId || !Types.ObjectId.isValid(q.courseId)) throw new BadRequestException('Name of Course is required');
    const sessionId = await this.resolveSessionId(user, q.sessionId);
    return this.sessionRows(user, sessionId, q);
  }

  /** Send in Current Session: copy into the target session as Old. Already there = skipped (old return 0). */
  async carry(user: AuthUser, body: { ids?: unknown; targetSessionId?: string }): Promise<BulkResult> {
    requireDealing(user);
    const iid = instituteOf(user);
    const target = await this.resolveSessionId(user, body?.targetSessionId);
    const ids = this.idList(body);
    const rows = await this.candidates.find({ _id: { $in: ids }, instituteId: iid }).lean();
    const result: BulkResult = { updated: 0, skipped: [] };
    const found = new Set(rows.map((r) => String(r._id)));
    for (const id of ids) if (!found.has(id)) result.skipped.push({ id, name: '', reason: 'Candidate not found' });
    for (const row of rows) {
      const skip = (reason: string) => result.skipped.push({ id: String(row._id), name: row.name, reason });
      if (!inCourseScope(user, row.courseId)) {
        skip('This course is not mapped to your login');
        continue;
      }
      if (String(row.sessionId) === String(target)) {
        skip('Already in this session');
        continue;
      }
      const there = await this.candidates.exists({
        instituteId: iid,
        sessionId: target,
        enrollmentNo: new RegExp(`^${escapeRegex(row.enrollmentNo)}$`, 'i'),
      });
      if (there) {
        skip('This candidate is already in the current session');
        continue;
      }
      try {
        await this.candidates.create({
          instituteId: iid,
          sessionId: target,
          courseId: row.courseId,
          specialityId: row.specialityId,
          departmentId: row.departmentId,
          enrollmentNo: row.enrollmentNo,
          name: row.name,
          dob: row.dob,
          mobile: row.mobile,
          email: row.email,
          source: SRC.CARRIED,
          carriedFromSessionId: row.sessionId,
          eligible: true,
          history: [this.event(user, 'CARRIED')],
          createdBy: new Types.ObjectId(user.userId),
        });
        result.updated += 1;
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        skip('This candidate is already in the current session');
      }
    }
    return result;
  }
}
