import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LETTERHEAD_LOGO_SRC, practicalTypeLabel, PRACTICAL_EXAMINER_TYPES } from '@ethesis/shared';
import { CommTemplate, OutboundMessage } from '../database/comms.schema';
import { AcademicSession, Course, Speciality } from '../database/masters.schema';
import { Institute } from '../database/institute.schema';
import { User } from '../database/user.schema';
import { PracticalExaminer, PracticalSchedule } from '../database/practical.schema';
import { MailerService } from '../common/mailer.service';
import { FileNumbersService } from '../file-numbers/file-numbers.service';
import { webUrl } from '../common/web-origin';
import { associateDean } from '../common/associate-dean';
import { fillTemplate, looksLikeHtml, resolveTemplate } from '../comms/template-store';

export { PracticalMail, SENDABLE_PRACTICAL_MAILS } from './practical-templates';

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Air booking form fields (old tblAir) with display labels; shared with the portal form. */
export const AIR_FIELDS: [string, string][] = [
  ['passengerName', 'Passenger name (as on ID)'],
  ['gender', 'Gender'],
  ['age', 'Age'],
  ['fromPlace', 'From'],
  ['toPlace', 'To'],
  ['onwardDate', 'Onward date'],
  ['onwardFlight', 'Onward flight no. / preferred time'],
  ['returnDate', 'Return date'],
  ['returnFlight', 'Return flight no. / preferred time'],
  ['payLevel', 'Pay level'],
  ['gradePay', 'Grade pay'],
  ['hotelNeeded', 'Hotel / guest house needed'],
  ['hotelArrival', 'Hotel arrival (date & time)'],
  ['hotelDeparture', 'Hotel departure (date & time)'],
  ['notes', 'Notes'],
];

const HTML_VARS =new Set(['boardTable', 'bookingTable', 'deanSignature', 'tentativeSentence']);

@Injectable()
export class PracticalMailService {
  constructor(
    @InjectModel(CommTemplate.name) private templates: Model<CommTemplate>,
    @InjectModel(OutboundMessage.name) private outbound: Model<OutboundMessage>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(User.name) private users: Model<User>,
    @InjectModel(PracticalSchedule.name) private schedules: Model<PracticalSchedule>,
    @InjectModel(PracticalExaminer.name) private examiners: Model<PracticalExaminer>,
    private mailer: MailerService,
    private fileNumbers: FileNumbersService,
  ) {}

  boardTable(board: { type: string; name: string; city?: string; instituteName?: string; mobile?: string; email?: string }[]) {
    const order = new Map<string, number>(PRACTICAL_EXAMINER_TYPES.map((t) => [t.code, t.order]));
    const rows = [...board]
      .sort((a, b) => (order.get(a.type) || 9) - (order.get(b.type) || 9))
      .map(
        (m) =>
          `<tr><th style="padding:6px 8px;text-align:left;border:1px solid #ccc">${esc(practicalTypeLabel(m.type))}</th>` +
          `<td style="padding:6px 8px;border:1px solid #ccc">${esc(m.name)}${m.city ? ` <b>${esc(m.city)}</b>` : ''}<br><small>${esc(m.instituteName)}</small></td>` +
          `<td style="padding:6px 8px;border:1px solid #ccc">${esc(m.mobile)}</td>` +
          `<td style="padding:6px 8px;border:1px solid #ccc">${esc(m.email)}</td></tr>`,
      )
      .join('');
    return `<table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="padding:6px 8px;border:1px solid #ccc">Board Members</th><th style="padding:6px 8px;border:1px solid #ccc">Name of Examiner</th><th style="padding:6px 8px;border:1px solid #ccc">Mobile No.</th><th style="padding:6px 8px;border:1px solid #ccc">Email id</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  bookingTable(b: Record<string, unknown>) {
    const rows = AIR_FIELDS.filter(([k]) => b[k] !== undefined && b[k] !== '' && b[k] !== null)
      .map(([k, label]) => {
        const v = typeof b[k] === 'boolean' ? (b[k] ? 'Yes' : 'No') : String(b[k]);
        return `<tr><th style="padding:5px 8px;text-align:left;border:1px solid #ccc">${esc(label)}</th><td style="padding:5px 8px;border:1px solid #ccc">${esc(v)}</td></tr>`;
      })
      .join('');
    return `<table style="border-collapse:collapse;font-size:13px">${rows}</table>`;
  }

  /** Letter variables for one examiner (old {ExaminerName}, {CourseName}, {AdName} ...). */
  async vars(ex: PracticalExaminer & { _id?: unknown }, extra: Record<string, string> = {}) {
    const [session, course, spec, inst, schedule, dealing, dean] = await Promise.all([
      this.sessions.findById(ex.sessionId).lean(),
      this.courses.findById(ex.courseId).lean(),
      this.specialities.findById(ex.specialityId).lean(),
      this.institutes.findById(ex.instituteId).lean(),
      this.schedules.findById(ex.scheduleId).lean(),
      this.users.findById(ex.dealingUserId).select('email name').lean(),
      ex.approvedBy?.userId ? this.users.findById(ex.approvedBy.userId).select('email name signaturePath').lean() : null,
    ]);
    const board = extra.boardTable
      ? null
      : await this.examiners
          // Board = Dean-approved members not held / rejected / regretted (same rule as the portal).
          .find({ scheduleId: ex.scheduleId, status: { $in: ['DEAN_APPROVED', 'OFFER_SENT', 'ACCEPTED', 'APPOINTED'] } })
          .lean();
    const fileNo = session ? await this.fileNumbers.findForSession(ex.instituteId, session.month, session.year) : null;
    const ad = await associateDean(this.users, ex.instituteId);
    const tentative = schedule?.tentativeSchedule
      ? `The Practical/Clinical Examination is tentatively scheduled to be held on <b>${esc(schedule.tentativeSchedule)}</b>. The practical examination has to be conducted in person (Physical) only.`
      : '';
    return {
      instituteName: inst?.displayName || inst?.name || '',
      logoUrl: webUrl(LETTERHEAD_LOGO_SRC),
      ...ad,
      fileNo: fileNo || '',
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
      examinerName: ex.name,
      examinerType: practicalTypeLabel(ex.type),
      designation: ex.designation || '',
      department: ex.department || '',
      examinerInstitute: ex.instituteName || '',
      examinerAddress: ex.instituteAddress || '',
      mobile: ex.mobile || '',
      email: ex.email || '',
      course: course?.name || '',
      speciality: spec?.name || '',
      sessionMonth: session?.month || '',
      sessionYear: String(session?.year || ''),
      examName: schedule?.examName || '',
      subjectCode: schedule?.subjectCode || '',
      tentativeSchedule: schedule?.tentativeSchedule || '',
      tentativeSentence: tentative,
      practicalDate: schedule?.practicalDate || '',
      examinerCode: ex.examinerCode || '',
      deanName: dean?.name || ex.approvedBy?.name || '',
      deanEmail: dean?.email || '',
      deanSignature: dean?.signaturePath
        ? `<img src="${webUrl(`/api/uploads/${dean.signaturePath}`)}" alt="Signature" style="height:48px;display:block;margin:4px 0">`
        : '',
      dealingEmail: dealing?.email || '',
      marks: schedule?.totalMarks ? String(schedule.totalMarks) : '',
      boardTable: board ? this.boardTable(board) : '',
      bookingTable: ex.airBooking ? this.bookingTable(ex.airBooking as Record<string, unknown>) : '',
      ...extra,
    } as Record<string, string>;
  }

  /** The Email master's template for this purpose (its starting copy is inserted on first use), filled in. */
  async render(instituteId: Types.ObjectId | string, purpose: string, vars: Record<string, string>) {
    const tpl = await resolveTemplate(this.templates, instituteId, purpose, 'EMAIL');
    if (!tpl) throw new BadRequestException(`No active mail template for ${purpose}. Activate one in Email master.`);
    return {
      subject: fillTemplate(tpl.subject, vars),
      body: fillTemplate(tpl.body, vars, looksLikeHtml(tpl.body), HTML_VARS),
      templateId: tpl.templateId,
    };
  }

  /** Render, send and log one mail. Throws if the mail could not be sent. */
  async send(
    ex: PracticalExaminer & { _id: unknown },
    purpose: string,
    extra: Record<string, string> = {},
    to?: { email: string; name: string },
  ) {
    const vars = await this.vars(ex, extra);
    const { subject, body, templateId } = await this.render(ex.instituteId, purpose, vars);
    const recipient = to || { email: ex.email, name: ex.name };
    const res = await this.mailer.send(recipient.email, subject, body);
    await this.outbound.create({
      instituteId: ex.instituteId,
      practicalExaminerId: ex._id,
      templateId,
      channel: 'EMAIL',
      to: recipient.email,
      toName: recipient.name,
      subject,
      body,
      purpose,
      status: res.status,
    });
    return res;
  }

  /** HTML preview of a letter for the Dealing / Dean screens. */
  async preview(ex: PracticalExaminer, purpose: string, extra: Record<string, string> = {}) {
    const vars = await this.vars(ex, extra);
    return this.render(ex.instituteId, purpose, vars);
  }
}
