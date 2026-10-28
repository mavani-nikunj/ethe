import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import {
  PRACTICAL_DOC_TYPES,
  PRACTICAL_EXAMINER_TYPES,
  PRACTICAL_QUESTION_PAPER,
  PRACTICAL_STATUS_LABELS,
  PracticalAirStatus,
  PracticalStatus,
  cleanMobile,
  isPracticalChair,
  isValidEmail,
  isValidMobile,
  normalizeEmail,
  practicalTypeLabel,
} from '@ethesis/shared';
import { PracticalDocument, PracticalExaminer, PracticalLookup, PracticalSchedule, PracticalToken } from '../database/practical.schema';
import { AcademicSession, Course, Department, Speciality } from '../database/masters.schema';
import { Institute } from '../database/institute.schema';
import { webUrl } from '../common/web-origin';
import { AIR_FIELDS, PracticalMail, PracticalMailService } from './practical-mail.service';

export const PracticalTokenPurpose = { OFFER: 'PRACTICAL_OFFER', PORTAL: 'PRACTICAL_PORTAL' } as const;

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const PORTAL_OTP_TTL_MS = 30 * 60 * 1000;
const PORTAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);

function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

@Injectable()
export class PracticalTaskService {
  constructor(
    @InjectModel(PracticalToken.name) private tokens: Model<PracticalToken>,
    @InjectModel(PracticalExaminer.name) private examiners: Model<PracticalExaminer>,
    @InjectModel(PracticalSchedule.name) private schedules: Model<PracticalSchedule>,
    @InjectModel(PracticalLookup.name) private lookups: Model<PracticalLookup>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(PracticalDocument.name) private documents: Model<PracticalDocument>,
    private mail: PracticalMailService,
  ) {}

  /** One link per examiner and purpose; re-sending reuses it. Email changes re-key the link. */
  async ensureToken(ex: { _id: unknown; instituteId: unknown; email: string }, purpose: string) {
    const existing = await this.tokens.findOne({ examinerId: ex._id, purpose });
    if (existing) {
      if (existing.email !== ex.email) {
        existing.email = ex.email;
        existing.otpHash = undefined;
        existing.sessionHash = undefined;
        await existing.save();
      }
      return existing.token;
    }
    const token = randomBytes(24).toString('base64url');
    await this.tokens.create({ token, instituteId: ex.instituteId, examinerId: ex._id, purpose, email: ex.email });
    return token;
  }

  linkFor(token: string) {
    return webUrl(`/practical-task/${token}`);
  }

  portalLinkFor(token: string) {
    return webUrl(`/practical-portal/${token}`);
  }

  private async load(token: string) {
    const row = await this.tokens.findOne({ token: text(token, 100) });
    if (!row) throw new NotFoundException('This link is not valid. Please use the latest email from the Examination Section.');
    const ex = await this.examiners.findById(row.examinerId);
    if (!ex) throw new NotFoundException('This offer has been withdrawn by the Examination Section.');
    return { row, ex };
  }

  private async context(ex: PracticalExaminer) {
    const [session, course, spec, inst, schedule] = await Promise.all([
      this.sessions.findById(ex.sessionId).lean(),
      this.courses.findById(ex.courseId).lean(),
      this.specialities.findById(ex.specialityId).lean(),
      this.institutes.findById(ex.instituteId).select('name displayName logoUrl').lean(),
      this.schedules.findById(ex.scheduleId).lean(),
    ]);
    return {
      institute: inst ? { name: inst.displayName || inst.name, logoUrl: inst.logoUrl ? `/api/uploads/${inst.logoUrl}` : undefined } : null,
      course: course?.name || '',
      speciality: spec?.name || '',
      session: session ? `${session.month} ${session.year}` : '',
      examinerType: practicalTypeLabel(ex.type),
      tentativeSchedule: schedule?.tentativeSchedule || '',
      examName: schedule?.examName || '',
    };
  }

  private responded(ex: PracticalExaminer) {
    if (ex.status === PracticalStatus.OFFER_SENT) return null;
    if (ex.status === PracticalStatus.ACCEPTED || ex.status === PracticalStatus.APPOINTED) return 'ACCEPTED';
    if (ex.status === PracticalStatus.REGRETTED) return 'REGRETTED';
    return 'WITHDRAWN';
  }

  private isPortal(row: { purpose: string }) {
    return row.purpose === PracticalTokenPurpose.PORTAL;
  }

  /** Portal stays open only for appointed examiners (old login: status not held / regretted). */
  private portalBlocked(ex: PracticalExaminer) {
    if (ex.status === PracticalStatus.APPOINTED) return null;
    return 'The examiner portal is not available for this appointment. Please contact the Examination Section.';
  }

  async peek(token: string) {
    const { row, ex } = await this.load(token);
    return {
      purpose: row.purpose,
      name: ex.name,
      email: maskEmail(row.email),
      passcodeRequested: Boolean(row.otpRequestedAt && row.otpExpiresAt && row.otpExpiresAt > new Date()),
      responded: this.isPortal(row) ? undefined : this.responded(ex),
      portalBlocked: this.isPortal(row) ? this.portalBlocked(ex) : undefined,
      examinerCode: ex.status === PracticalStatus.ACCEPTED || ex.status === PracticalStatus.APPOINTED ? ex.examinerCode : undefined,
      ...(await this.context(ex)),
    };
  }

  async sendOtp(token: string) {
    const { row, ex } = await this.load(token);
    const portal = this.isPortal(row);
    if (portal) {
      const blocked = this.portalBlocked(ex);
      if (blocked) throw new ForbiddenException(blocked);
    }
    if (row.otpRequestedAt && Date.now() - row.otpRequestedAt.getTime() < OTP_RESEND_MS) {
      throw new HttpException('Please wait a minute before requesting another passcode.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    row.otpHash = await bcrypt.hash(otp, 8);
    row.otpExpiresAt = new Date(Date.now() + (portal ? PORTAL_OTP_TTL_MS : OTP_TTL_MS));
    row.otpRequestedAt = new Date();
    row.otpAttempts = 0;
    await row.save();
    await this.mail.send(ex as any, portal ? PracticalMail.PORTAL_PASSCODE : PracticalMail.OTP, { otp });
    if (portal && !ex.portal?.generatedAt) {
      await this.examiners.updateOne({ _id: ex._id }, { $set: { 'portal.generatedAt': new Date() } });
    }
    return { ok: true, message: `Passcode sent to ${maskEmail(row.email)}` };
  }

  async verify(token: string, otp: string) {
    const { row, ex } = await this.load(token);
    if (this.isPortal(row)) {
      const blocked = this.portalBlocked(ex);
      if (blocked) throw new ForbiddenException(blocked);
    }
    if (!row.otpHash || !row.otpExpiresAt) throw new UnauthorizedException('Request a passcode first');
    if (row.otpExpiresAt < new Date()) throw new UnauthorizedException('Passcode expired. Request a new one.');
    if (row.otpAttempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Too many wrong attempts. Request a new passcode.');
    const ok = await bcrypt.compare(text(otp, 10), row.otpHash);
    if (!ok) {
      row.otpAttempts += 1;
      await row.save();
      throw new UnauthorizedException(`Invalid passcode (${OTP_MAX_ATTEMPTS - row.otpAttempts} attempts left)`);
    }
    const session = randomBytes(24).toString('base64url');
    row.otpHash = undefined;
    row.otpAttempts = 0;
    row.sessionHash = sha(session);
    row.sessionExpiresAt = new Date(Date.now() + (this.isPortal(row) ? PORTAL_SESSION_TTL_MS : SESSION_TTL_MS));
    row.verifiedAt = new Date();
    await row.save();
    if (this.isPortal(row)) await this.examiners.updateOne({ _id: ex._id }, { $set: { 'portal.lastLoginAt': new Date() } });
    return { session };
  }

  private async requireSession(token: string, session: string | undefined, purpose: string) {
    const { row, ex } = await this.load(token);
    if (row.purpose !== purpose) throw new NotFoundException('This link cannot be used here.');
    if (!session || !row.sessionHash || row.sessionHash !== sha(session) || !row.sessionExpiresAt || row.sessionExpiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired. Verify the passcode again.');
    }
    if (purpose === PracticalTokenPurpose.PORTAL) {
      const blocked = this.portalBlocked(ex);
      if (blocked) throw new ForbiddenException(blocked);
    }
    return { row, ex };
  }

  async detail(token: string, session?: string) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.OFFER);
    const [lk, depts] = await Promise.all([
      this.lookups.find({ instituteId: ex.instituteId }).lean(),
      this.departments.find({ instituteId: ex.instituteId }).select('name').lean(),
    ]);
    return {
      ...(await this.context(ex)),
      name: ex.name,
      responded: this.responded(ex),
      examiner: {
        name: ex.name,
        designation: ex.designation,
        department: ex.department,
        instituteName: ex.instituteName,
        instituteAddress: ex.instituteAddress,
        city: ex.city,
        mobile: ex.mobile,
        email: ex.email,
        alternateMobile: ex.alternateMobile,
        alternateEmail: ex.alternateEmail,
        salaryCode: ex.salaryCode,
        bank: ex.bank ? { ...ex.bank, chequePath: undefined, hasCheque: Boolean(ex.bank.chequePath) } : null,
      },
      designations: lk.filter((l) => l.kind === 'DESIGNATION').map((l) => l.name).sort(),
      departments: [...new Set([...lk.filter((l) => l.kind === 'DEPARTMENT').map((l) => l.name), ...depts.map((d) => d.name)])].sort(),
    };
  }

  private assertOpen(ex: PracticalExaminer) {
    if (ex.status !== PracticalStatus.OFFER_SENT) {
      const state = this.responded(ex);
      if (state === 'ACCEPTED') throw new BadRequestException('You have already accepted this offer.');
      if (state === 'REGRETTED') throw new BadRequestException('You have already declined this offer.');
      throw new ForbiddenException(`This offer is no longer open (${PRACTICAL_STATUS_LABELS[ex.status] || ex.status}).`);
    }
  }

  /** SubjectCode + type letter + running number for that type on the board (old UpdatedExaminer). */
  private async examinerCode(ex: PracticalExaminer & { _id: unknown }) {
    const schedule = await this.schedules.findById(ex.scheduleId).lean();
    const letter = PRACTICAL_EXAMINER_TYPES.find((t) => t.code === ex.type)?.letter || 'A';
    const prefix = `${schedule?.subjectCode || ''}${letter}`;
    const taken = await this.examiners
      .find({ scheduleId: ex.scheduleId, _id: { $ne: ex._id }, examinerCode: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+$` } })
      .select('examinerCode')
      .lean();
    const used = new Set(taken.map((t) => Number(String(t.examinerCode).slice(prefix.length))));
    let n = 1;
    while (used.has(n)) n += 1;
    return `${prefix}${n}`;
  }

  async accept(token: string, session: string | undefined, body: Record<string, unknown>, chequePath?: string) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.OFFER);
    this.assertOpen(ex);
    const f = {
      name: text(body.name, 160),
      designation: text(body.designation, 160),
      department: text(body.department, 160),
      instituteName: text(body.instituteName, 200),
      instituteAddress: text(body.instituteAddress, 300),
      city: text(body.city, 80),
      salaryCode: text(body.salaryCode, 40),
      mobile: cleanMobile(body.mobile as string),
      email: normalizeEmail(body.email),
      alternateMobile: cleanMobile(body.alternateMobile as string),
      alternateEmail: normalizeEmail(body.alternateEmail),
    };
    const bank = {
      holderName: text(body.holderName, 160),
      bankName: text(body.bankName, 160),
      branch: text(body.branch, 200),
      ifsc: text(body.ifsc, 20).toUpperCase(),
      accountType: text(body.accountType, 40),
      account: text(body.account, 40).replace(/\s/g, ''),
      pan: text(body.pan, 20).toUpperCase(),
    };
    for (const [k, label] of [
      ['name', 'Name'],
      ['designation', 'Designation'],
      ['department', 'Department'],
      ['instituteName', 'Institute Name'],
      ['instituteAddress', 'Institute Address'],
    ] as const) {
      if (!f[k]) throw new BadRequestException(`${label} is required`);
    }
    if (!isValidMobile(f.mobile)) throw new BadRequestException('Enter a valid 10-digit mobile number');
    if (!isValidEmail(f.email)) throw new BadRequestException('Enter a valid email address');
    if (f.alternateMobile && !isValidMobile(f.alternateMobile)) throw new BadRequestException('Alternate mobile is not valid');
    if (f.alternateEmail && !isValidEmail(f.alternateEmail)) throw new BadRequestException('Alternate email is not valid');
    if (!bank.holderName) throw new BadRequestException('Account holder name is required');
    if (!bank.bankName) throw new BadRequestException('Bank name is required');
    if (!bank.branch) throw new BadRequestException('Branch address is required');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc)) throw new BadRequestException('IFSC code is not valid (e.g. SBIN0001234)');
    if (!bank.accountType) throw new BadRequestException('Select the account type');
    if (!/^\d{6,20}$/.test(bank.account)) throw new BadRequestException('Account number must be 6 to 20 digits');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(bank.pan)) throw new BadRequestException('PAN is not valid (e.g. ABCDE1234F)');
    if (!chequePath && !ex.bank?.chequePath) throw new BadRequestException('Upload a scan of a cancelled cheque');

    const code = await this.examinerCode(ex as any);
    const res = await this.examiners.updateOne(
      { _id: ex._id, status: PracticalStatus.OFFER_SENT },
      {
        $set: {
          ...f,
          bank: { ...bank, chequePath: chequePath || ex.bank?.chequePath },
          examinerCode: code,
          acceptedAt: new Date(),
          status: PracticalStatus.ACCEPTED,
        },
        $push: {
          history: { status: PracticalStatus.ACCEPTED, at: new Date(), byName: f.name, role: 'EXAMINER', remark: `Accepted offer; code ${code}` },
        },
      },
    );
    if (!res.modifiedCount) throw new BadRequestException('This offer was already answered. Refresh the page.');
    const fresh = await this.examiners.findById(ex._id).lean();
    try {
      await this.mail.send(fresh as any, PracticalMail.ACCEPTED);
    } catch {
      // Acceptance is saved; the acknowledgement mail failing must not undo it.
    }
    return { ok: true, examinerCode: code };
  }

  async regret(token: string, session: string | undefined, body: { reasonType?: string; reason?: string }) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.OFFER);
    this.assertOpen(ex);
    const type = text(body.reasonType, 40) === 'PRIOR_COMMITMENT' ? 'Prior commitment' : 'Other';
    const reason = text(body.reason, 500);
    if (type === 'Other' && !reason) throw new BadRequestException('Please give the reason');
    const full = reason ? `${type}: ${reason}` : type;
    const res = await this.examiners.updateOne(
      { _id: ex._id, status: PracticalStatus.OFFER_SENT },
      {
        $set: { status: PracticalStatus.REGRETTED, regretReason: full },
        $push: { history: { status: PracticalStatus.REGRETTED, at: new Date(), byName: ex.name, role: 'EXAMINER', remark: `Regretted: ${full}` } },
      },
    );
    if (!res.modifiedCount) throw new BadRequestException('This offer was already answered. Refresh the page.');
    try {
      await this.mail.send(ex as any, PracticalMail.REGRETTED);
    } catch {
      // Regret is saved even if the acknowledgement mail fails.
    }
    return { ok: true };
  }

  // ---------- examiner portal (P4/P5/P7) ----------

  private async portalDocs(ex: PracticalExaminer) {
    const docs = await this.documents
      .find({
        instituteId: ex.instituteId,
        $or: [
          { kind: PRACTICAL_QUESTION_PAPER, specialityId: ex.specialityId, sessionId: ex.sessionId },
          { kind: 'DOC', courseId: ex.courseId },
          { kind: 'DOC', courseId: { $exists: false } },
          { kind: 'DOC', courseId: null },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => ({
      _id: d._id,
      kind: d.kind,
      uploadType: d.uploadType,
      label:
        d.kind === PRACTICAL_QUESTION_PAPER
          ? 'Previous Question Paper'
          : PRACTICAL_DOC_TYPES.find((t) => t.code === d.uploadType)?.label || 'Document',
      originalName: d.originalName,
    }));
  }

  async portal(token: string, session?: string) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.PORTAL);
    const [schedule, board] = await Promise.all([
      this.schedules.findById(ex.scheduleId).lean(),
      this.examiners
        .find({ scheduleId: ex.scheduleId, status: { $in: [PracticalStatus.APPOINTED, PracticalStatus.ACCEPTED, PracticalStatus.OFFER_SENT, PracticalStatus.DEAN_APPROVED] } })
        .lean(),
    ]);
    const order = new Map<string, number>(PRACTICAL_EXAMINER_TYPES.map((t) => [t.code, t.order]));
    return {
      ...(await this.context(ex)),
      name: ex.name,
      examinerCode: ex.examinerCode,
      isChair: isPracticalChair(ex.type),
      examiner: {
        name: ex.name,
        designation: ex.designation,
        department: ex.department,
        instituteName: ex.instituteName,
        instituteAddress: ex.instituteAddress,
        city: ex.city,
        mobile: ex.mobile,
        email: ex.email,
      },
      practicalDate: schedule?.practicalDate || '',
      practicalDateBy: schedule?.practicalDateBy || '',
      totalMarks: schedule?.totalMarks || null,
      board: board
        .sort((a, b) => (order.get(a.type) || 9) - (order.get(b.type) || 9) || a.name.localeCompare(b.name))
        .map((m) => ({
          type: practicalTypeLabel(m.type),
          name: m.name,
          designation: m.designation,
          instituteName: m.instituteName,
          city: m.city,
          mobile: m.mobile,
          email: m.email,
        })),
      documents: await this.portalDocs(ex),
      airBooking: ex.airBooking || null,
      airFields: AIR_FIELDS,
    };
  }

  /** Chairperson / Exam Coordinator fixes the practical date for the speciality (old portal Dashboard). */
  async setPracticalDate(token: string, session: string | undefined, body: { practicalDate?: string }) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.PORTAL);
    if (!isPracticalChair(ex.type)) throw new ForbiddenException('Only the Chairperson or Exam Coordinator can fix the practical date');
    const value = text(body?.practicalDate, 120);
    if (!value) throw new BadRequestException('Enter the practical date(s)');
    await this.schedules.updateOne(
      { _id: ex.scheduleId },
      { $set: { practicalDate: value, practicalDateBy: `${ex.name} (${practicalTypeLabel(ex.type)})`, practicalDateAt: new Date() } },
    );
    await this.examiners.updateOne(
      { _id: ex._id },
      { $push: { history: { status: ex.status, at: new Date(), byName: ex.name, role: 'EXAMINER', remark: `Practical date fixed: ${value}` } } },
    );
    return { ok: true, practicalDate: value };
  }

  /** Stream a portal document; only documents visible to this examiner. */
  async portalDocument(token: string, session: string | undefined, docId: string) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.PORTAL);
    const visible = await this.portalDocs(ex);
    const doc = visible.find((d) => String(d._id) === String(docId));
    if (!doc) throw new NotFoundException('Document not found');
    return this.documents.findById(doc._id).lean();
  }

  async saveAirBooking(token: string, session: string | undefined, body: Record<string, unknown>) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.PORTAL);
    const current = (ex.airBooking || {}) as Record<string, unknown>;
    if (current.status && current.status !== PracticalAirStatus.REQUESTED && current.status !== PracticalAirStatus.CANCELLED) {
      throw new BadRequestException('Your booking has already been forwarded for ticketing. Please contact the Examination Section to change it.');
    }
    const booking: Record<string, unknown> = {};
    for (const [k] of AIR_FIELDS) {
      if (k === 'hotelNeeded') booking[k] = body[k] === true || body[k] === 'true' || body[k] === 'Yes';
      else booking[k] = text(body[k], 200);
    }
    for (const [k, label] of [
      ['passengerName', 'Passenger name'],
      ['gender', 'Gender'],
      ['fromPlace', 'From'],
      ['toPlace', 'To'],
      ['onwardDate', 'Onward date'],
      ['returnDate', 'Return date'],
    ] as const) {
      if (!booking[k]) throw new BadRequestException(`${label} is required`);
    }
    const now = new Date();
    await this.examiners.updateOne(
      { _id: ex._id },
      {
        $set: { airBooking: { ...booking, status: PracticalAirStatus.REQUESTED, requestedAt: now, remarks: current.remarks || '' } },
        $push: { history: { status: ex.status, at: now, byName: ex.name, role: 'EXAMINER', remark: 'Air booking requested on portal' } },
      },
    );
    return { ok: true };
  }

  /** Ticket file for the examiner once it has been sent to them. */
  async portalTicket(token: string, session: string | undefined) {
    const { ex } = await this.requireSession(token, session, PracticalTokenPurpose.PORTAL);
    const b = (ex.airBooking || {}) as Record<string, any>;
    if (b.status !== PracticalAirStatus.TICKET_SENT || !b.ticketPath) throw new NotFoundException('No ticket yet');
    return { path: b.ticketPath as string, originalName: (b.ticketName as string) || 'ticket.pdf' };
  }

  /** Drop links when an examiner record is deleted. */
  async removeFor(examinerId: unknown) {
    await this.tokens.deleteMany({ examinerId: new Types.ObjectId(String(examinerId)) });
  }
}
