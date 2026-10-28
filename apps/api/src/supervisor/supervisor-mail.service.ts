import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommTemplate, OutboundMessage } from '../database/comms.schema';
import { Institute } from '../database/institute.schema';
import { User } from '../database/user.schema';
import { SupervisorAppointment, SupervisorSession } from '../database/supervisor.schema';
import { MailerService } from '../common/mailer.service';
import { webUrl } from '../common/web-origin';
import { LETTERHEAD_LOGO_SRC } from '@ethesis/shared';
import { associateDean } from '../common/associate-dean';
import { fillTemplate, looksLikeHtml, resolveTemplate } from '../comms/template-store';

export { SupervisorMail, SUPERVISOR_LETTERS } from './supervisor-templates';

const HTML_VARS = new Set(['dutyTable', 'aceSignature']);

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** YYYY-MM-DD → DD/MM/YYYY. */
export function dmy(iso?: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

@Injectable()
export class SupervisorMailService {
  constructor(
    @InjectModel(CommTemplate.name) private templates: Model<CommTemplate>,
    @InjectModel(OutboundMessage.name) private outbound: Model<OutboundMessage>,
    @InjectModel(SupervisorSession.name) private sessions: Model<SupervisorSession>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(User.name) private users: Model<User>,
    private mailer: MailerService,
  ) {}

  /** Old offer-letter table: Sr. No. · Name of Examination · Date · Reporting Time · Examination Shift. */
  dutyTable(duties: SupervisorAppointment['duties'], examNames: Map<string, string>) {
    const cell = 'padding:6px 8px;border:1px solid #ccc';
    const rows = [...duties]
      .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.shift.localeCompare(b.shift) * -1)
      .map(
        (d, i) =>
          `<tr><td style="${cell};text-align:center">${i + 1}</td><td style="${cell}">${esc(examNames.get(String(d.scheduleId)) || 'UG/PG Professional Examination')}</td>` +
          `<td style="${cell};text-align:center">${esc(dmy(d.examDate))}</td><td style="${cell};text-align:center">${esc(d.reportingTime)}</td>` +
          `<td style="${cell};text-align:center">${esc(d.shift)}</td></tr>`,
      )
      .join('');
    const th = `${cell};background:#eef3fb`;
    return `<table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="${th}">Sr. No.</th><th style="${th}">Name of Examination</th><th style="${th}">Date</th><th style="${th}">Reporting Time</th><th style="${th}">Examination Shift</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async vars(a: SupervisorAppointment & { _id?: unknown }, examNames: Map<string, string>, extra: Record<string, string> = {}) {
    const [session, inst, dealing, ace] = await Promise.all([
      this.sessions.findById(a.sessionId).lean(),
      this.institutes.findById(a.instituteId).lean(),
      a.dealingUserId ? this.users.findById(a.dealingUserId).select('email name').lean() : null,
      a.approvedBy?.userId ? this.users.findById(a.approvedBy.userId).select('email name signaturePath').lean() : null,
    ]);
    const letterDate = a.approvedBy?.at ? new Date(a.approvedBy.at) : new Date();
    const ad = await associateDean(this.users, a.instituteId);
    return {
      instituteName: inst?.displayName || inst?.name || '',
      logoUrl: webUrl(LETTERHEAD_LOGO_SRC),
      ...ad,
      fileNo: session?.fileNumber || '',
      date: letterDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
      supervisorName: a.name,
      designation: a.designation || '',
      department: a.department || '',
      supervisorInstitute: a.instituteName || '',
      address: a.address || '',
      mobile: a.mobile || '',
      email: a.email || '',
      sessionMonth: session?.month || '',
      sessionYear: String(session?.year || ''),
      dutyTable: this.dutyTable(a.duties || [], examNames),
      aceName: ace?.name || a.approvedBy?.name || '',
      aceSignature: (ace as any)?.signaturePath
        ? `<img src="${webUrl(`/api/uploads/${(ace as any).signaturePath}`)}" alt="Signature" style="height:48px;display:block;margin:4px 0">`
        : '',
      dealingEmail: dealing?.email || '',
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

  /** Render, send and log one mail. */
  async send(a: SupervisorAppointment & { _id: unknown }, purpose: string, examNames: Map<string, string>, extra: Record<string, string> = {}) {
    const vars = await this.vars(a, examNames, extra);
    const { subject, body, templateId } = await this.render(a.instituteId, purpose, vars);
    const res = await this.mailer.send(a.email, subject, body);
    await this.outbound.create({
      instituteId: a.instituteId,
      supervisorAppointmentId: a._id,
      templateId,
      channel: 'EMAIL',
      to: a.email,
      toName: a.name,
      subject,
      body,
      purpose,
      status: res.status,
    });
    return res;
  }

  async preview(a: SupervisorAppointment, purpose: string, examNames: Map<string, string>) {
    return this.render(a.instituteId, purpose, await this.vars(a, examNames));
  }
}
