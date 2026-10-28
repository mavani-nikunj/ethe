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
import { SUPERVISOR_STATUS_LABELS, SupervisorStatus, cleanMobile, isValidEmail, isValidMobile, normalizeEmail } from '@ethesis/shared';
import { Institute } from '../database/institute.schema';
import { Department } from '../database/masters.schema';
import {
  SupervisorAppointment,
  SupervisorLookup,
  SupervisorSchedule,
  SupervisorSession,
  SupervisorToken,
} from '../database/supervisor.schema';
import { webUrl } from '../common/web-origin';
import { SupervisorMail, SupervisorMailService, dmy } from './supervisor-mail.service';
import { bankFieldsChecked } from './supervisor-bank';

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);

function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

type Appt = SupervisorAppointment & { _id: Types.ObjectId };

/**
 * Public supervisor link (old SupervisorAcceptance/Index?Id=…). Access = link token + email OTP
 * (Decision 6). Open only while the offer is pending.
 */
@Injectable()
export class SupervisorTaskService {
  constructor(
    @InjectModel(SupervisorToken.name) private tokens: Model<SupervisorToken>,
    @InjectModel(SupervisorAppointment.name) private appts: Model<SupervisorAppointment>,
    @InjectModel(SupervisorSchedule.name) private schedules: Model<SupervisorSchedule>,
    @InjectModel(SupervisorSession.name) private sessions: Model<SupervisorSession>,
    @InjectModel(SupervisorLookup.name) private lookups: Model<SupervisorLookup>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    private mail: SupervisorMailService,
  ) {}

  /** One link per appointment; re-sending reuses it. */
  async ensureToken(a: { _id: unknown; instituteId: unknown; email: string }) {
    const existing = await this.tokens.findOne({ appointmentId: a._id });
    if (existing) {
      if (existing.email !== a.email) await this.rekey(a._id, a.email);
      return existing.token;
    }
    const token = randomBytes(24).toString('base64url');
    await this.tokens.create({ token, instituteId: a.instituteId, appointmentId: a._id, email: a.email });
    return token;
  }

  /** Email changed: the passcode goes to the new address and old sessions end. */
  async rekey(appointmentId: unknown, email: string) {
    await this.tokens.updateOne(
      { appointmentId },
      { $set: { email }, $unset: { otpHash: 1, otpExpiresAt: 1, sessionHash: 1, sessionExpiresAt: 1 } },
    );
  }

  linkFor(token: string) {
    return webUrl(`/supervisor-task/${token}`);
  }

  private async load(token: string) {
    const row = await this.tokens.findOne({ token: text(token, 100) });
    if (!row) throw new NotFoundException('This link is not valid. Please use the latest email from the Examination Section.');
    const a = (await this.appts.findById(row.appointmentId).lean()) as Appt | null;
    if (!a) throw new NotFoundException('This offer has been withdrawn by the Examination Section.');
    return { row, a };
  }

  private responded(a: Appt) {
    if (a.status === SupervisorStatus.OFFER_SENT) return null;
    if (a.status === SupervisorStatus.ACCEPTED) return 'ACCEPTED';
    if (a.status === SupervisorStatus.REGRETTED) return 'REGRETTED';
    return 'WITHDRAWN';
  }

  private async examNames(a: Appt) {
    const rows = await this.schedules.find({ sessionId: a.sessionId }).select('examName').lean();
    return new Map(rows.map((r) => [String(r._id), r.examName]));
  }

  private async context(a: Appt) {
    const [session, inst, names] = await Promise.all([
      this.sessions.findById(a.sessionId).lean(),
      this.institutes.findById(a.instituteId).select('name displayName logoUrl').lean(),
      this.examNames(a),
    ]);
    return {
      institute: inst ? { name: inst.displayName || inst.name, logoUrl: inst.logoUrl ? `/api/uploads/${inst.logoUrl}` : undefined } : null,
      session: session ? `${session.month} ${session.year}` : '',
      duties: [...(a.duties || [])]
        .sort((x, y) => x.examDate.localeCompare(y.examDate) || y.shift.localeCompare(x.shift))
        .map((d) => ({ examName: names.get(String(d.scheduleId)) || '', date: dmy(d.examDate), reportingTime: d.reportingTime, shift: d.shift })),
    };
  }

  async peek(token: string) {
    const { row, a } = await this.load(token);
    return {
      name: a.name,
      email: maskEmail(row.email),
      passcodeRequested: Boolean(row.otpRequestedAt && row.otpExpiresAt && row.otpExpiresAt > new Date()),
      responded: this.responded(a),
      ...(await this.context(a)),
    };
  }

  async sendOtp(token: string) {
    const { row, a } = await this.load(token);
    if (this.responded(a) === 'WITHDRAWN') throw new ForbiddenException('This offer is no longer open.');
    if (row.otpRequestedAt && Date.now() - row.otpRequestedAt.getTime() < OTP_RESEND_MS) {
      throw new HttpException('Please wait a minute before requesting another passcode.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    row.otpHash = await bcrypt.hash(otp, 8);
    row.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    row.otpRequestedAt = new Date();
    row.otpAttempts = 0;
    await row.save();
    await this.mail.send(a, SupervisorMail.OTP, new Map(), { otp });
    return { ok: true, message: `Passcode sent to ${maskEmail(row.email)}` };
  }

  async verify(token: string, otp: string) {
    const { row } = await this.load(token);
    if (!row.otpHash || !row.otpExpiresAt) throw new UnauthorizedException('Request a passcode first');
    if (row.otpExpiresAt < new Date()) throw new UnauthorizedException('Passcode expired. Request a new one.');
    if (row.otpAttempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Too many wrong attempts. Request a new passcode.');
    if (!(await bcrypt.compare(text(otp, 10), row.otpHash))) {
      row.otpAttempts += 1;
      await row.save();
      throw new UnauthorizedException(`Invalid passcode (${OTP_MAX_ATTEMPTS - row.otpAttempts} attempts left)`);
    }
    const session = randomBytes(24).toString('base64url');
    row.otpHash = undefined;
    row.otpAttempts = 0;
    row.sessionHash = sha(session);
    row.sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    row.verifiedAt = new Date();
    await row.save();
    return { session };
  }

  private async requireSession(token: string, session?: string) {
    const { row, a } = await this.load(token);
    if (!session || !row.sessionHash || row.sessionHash !== sha(session) || !row.sessionExpiresAt || row.sessionExpiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired. Verify the passcode again.');
    }
    return { row, a };
  }

  async detail(token: string, session?: string) {
    const { a } = await this.requireSession(token, session);
    const [lk, depts] = await Promise.all([
      this.lookups.find({ instituteId: a.instituteId, kind: 'DESIGNATION' }).lean(),
      this.departments.find({ instituteId: a.instituteId }).select('name').lean(),
    ]);
    let letter: { subject: string; body: string } | null = null;
    const state = this.responded(a);
    if (state === 'ACCEPTED' || state === 'REGRETTED') {
      letter = await this.mail.preview(a, state === 'ACCEPTED' ? SupervisorMail.ACCEPTED : SupervisorMail.REGRETTED, await this.examNames(a));
    }
    return {
      ...(await this.context(a)),
      responded: state,
      letter,
      supervisor: {
        name: a.name,
        designation: a.designation,
        department: a.department,
        instituteName: a.instituteName,
        address: a.address,
        mobile: a.mobile,
        email: a.email,
        salaryCode: a.salaryCode,
      },
      designations: [...new Set([...lk.map((l) => l.name), a.designation || ''].filter(Boolean))].sort(),
      departments: [...new Set([...depts.map((d) => d.name), a.department || ''].filter(Boolean))].sort(),
    };
  }

  private assertOpen(a: Appt) {
    const state = this.responded(a);
    if (state === 'ACCEPTED') throw new BadRequestException('You have already accepted this offer.');
    if (state === 'REGRETTED') throw new BadRequestException('You have already declined this offer.');
    if (state) throw new ForbiddenException(`This offer is no longer open (${SUPERVISOR_STATUS_LABELS[a.status] || a.status}).`);
  }

  async accept(token: string, session: string | undefined, body: Record<string, unknown>, chequePath?: string) {
    const { a } = await this.requireSession(token, session);
    this.assertOpen(a);
    if (!truthy(body.noRelative) || !truthy(body.available)) {
      throw new BadRequestException('Please tick both declarations to accept the duty.');
    }
    const f = {
      name: text(body.name, 200),
      designation: text(body.designation, 160),
      department: text(body.department, 160),
      instituteName: text(body.instituteName, 250),
      address: text(body.address, 500),
      mobile: cleanMobile(body.mobile as string),
      email: normalizeEmail(body.email),
    };
    const salaryCode = text(body.salaryCode, 100);
    for (const [k, label] of [
      ['name', 'Name'],
      ['designation', 'Designation Name'],
      ['department', 'Department Name'],
      ['instituteName', 'Institute Name'],
      ['address', 'Address'],
    ] as const) {
      if (!f[k]) throw new BadRequestException(`Please Enter ${label}`);
    }
    if (!salaryCode) throw new BadRequestException('Please Enter Salary Code');
    if (!isValidMobile(f.mobile)) throw new BadRequestException('Please Enter Mobile No. (10 digits)');
    if (!isValidEmail(f.email)) throw new BadRequestException('Please Enter Email Id.');
    const bank = bankFieldsChecked(body);
    if (!chequePath) throw new BadRequestException('Please upload cancelled cheque in JPEG, JPG, PNG or PDF file.');

    const res = await this.appts.updateOne(
      { _id: a._id, status: SupervisorStatus.OFFER_SENT },
      {
        $set: {
          ...f,
          salaryCode,
          bank: { ...bank, chequePath },
          declarations: { noRelative: true, available: true, at: new Date() },
          acceptedAt: new Date(),
          status: SupervisorStatus.ACCEPTED,
        },
        $push: { history: { status: SupervisorStatus.ACCEPTED, at: new Date(), byName: f.name, role: 'SUPERVISOR', remark: 'Accepted supervisory duty' } },
      },
    );
    if (!res.modifiedCount) throw new BadRequestException('This offer was already answered. Refresh the page.');
    if (f.email !== a.email) await this.rekey(a._id, f.email);
    const fresh = (await this.appts.findById(a._id).lean()) as Appt;
    await this.mail.send(fresh, SupervisorMail.ACCEPTED, await this.examNames(fresh)).catch(() => undefined);
    return { ok: true, message: 'Submitted successfully and confirmation sent to your Email.' };
  }

  async regret(token: string, session: string | undefined, body: Record<string, unknown>) {
    const { a } = await this.requireSession(token, session);
    this.assertOpen(a);
    const reason = text(body.reason, 500);
    if (!reason) throw new BadRequestException('Please Enter Reason');
    const res = await this.appts.updateOne(
      { _id: a._id, status: SupervisorStatus.OFFER_SENT },
      {
        $set: { status: SupervisorStatus.REGRETTED, regretReason: reason },
        $push: { history: { status: SupervisorStatus.REGRETTED, at: new Date(), byName: a.name, role: 'SUPERVISOR', remark: reason } },
      },
    );
    if (!res.modifiedCount) throw new BadRequestException('This offer was already answered. Refresh the page.');
    const fresh = (await this.appts.findById(a._id).lean()) as Appt;
    await this.mail.send(fresh, SupervisorMail.REGRETTED, await this.examNames(fresh)).catch(() => undefined);
    return { ok: true, message: 'Submitted successfully.' };
  }
}

function truthy(v: unknown) {
  return v === true || v === 'true' || v === '1' || v === 1 || v === 'on';
}
