import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommTemplate, OutboundMessage, Reminder } from '../database/comms.schema';
import { ThesisFile } from '../database/thesis-file.schema';
import { Institute } from '../database/institute.schema';
import { User } from '../database/user.schema';
import { associateDean } from '../common/associate-dean';
import { AcademicSession, Course, CourseType, Department, Speciality } from '../database/masters.schema';
import { LETTERHEAD_LOGO_SRC, PLACEHOLDERS, PRODUCT_NAME } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { MailerService } from '../common/mailer.service';
import { rewriteLocalOrigins, webUrl } from '../common/web-origin';
import { catalogEntry, catalogFor } from './catalog';
import { SystemMail } from './catalog/system-defaults';
import { activeTemplate, renderTemplate, seedMissingTemplates } from './template-store';

const CHANNELS = ['EMAIL', 'LETTER'] as const;
/** These mails carry the examiner's evaluation report, which is confidential: never copied to MAIL_CC. */
const NO_CC_MAILS = new Set<string>([SystemMail.EVALUATION_RECEIVED, SystemMail.EVALUATION_RECEIVED_OFFICE]);

@Injectable()
export class CommsService {
  constructor(
    @InjectModel(CommTemplate.name) private templates: Model<CommTemplate>,
    @InjectModel(OutboundMessage.name) private outbound: Model<OutboundMessage>,
    @InjectModel(Reminder.name) private reminders: Model<Reminder>,
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(Institute.name) private institutes: Model<Institute>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(CourseType.name) private courseTypes: Model<CourseType>,
    @InjectModel(Department.name) private departments: Model<Department>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    @InjectModel(User.name) private users: Model<User>,
    private mailer: MailerService,
  ) {}

  iid(user: AuthUser) {
    return new Types.ObjectId(user.instituteId as string);
  }

  placeholders() {
    return PLACEHOLDERS;
  }

  async listTemplates(user: AuthUser, channel?: string) {
    await seedMissingTemplates(this.templates, this.iid(user), channel);
    const filter: Record<string, unknown> = { instituteId: this.iid(user) };
    const ch = String(channel || '').toUpperCase();
    if (CHANNELS.includes(ch as (typeof CHANNELS)[number])) filter.channel = ch;
    return this.templates.find(filter).sort({ name: 1 }).lean();
  }

  createTemplate(user: AuthUser, body: any) {
    const channel = String(body.channel || 'EMAIL').toUpperCase();
    if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
      throw new BadRequestException('Channel must be EMAIL or LETTER');
    }
    return this.templates.create({
      name: body.name,
      channel,
      subject: body.subject,
      body: body.body,
      stageCode: body.stageCode,
      purpose: body.purpose,
      active: body.active !== false && body.status !== 'DRAFT',
      instituteId: this.iid(user),
    });
  }

  async updateTemplate(user: AuthUser, id: string, body: any) {
    const $set: Record<string, unknown> = { ...body };
    if (body.status === 'DRAFT') $set.active = false;
    if (body.status === 'ACTIVE' || body.active === true) $set.active = true;
    delete $set.status;
    delete $set.channel;
    const row = await this.templates.findOneAndUpdate(
      { _id: id, instituteId: this.iid(user) },
      { $set },
      { new: true },
    );
    if (!row) throw new NotFoundException('Template not found');
    return row;
  }

  async removeTemplate(user: AuthUser, id: string) {
    await this.templates.findOneAndDelete({ _id: id, instituteId: this.iid(user) });
    return { ok: true };
  }

  /** Every mail / letter the platform can send, with its group, placeholders and starting copy (Email / Letter master). */
  catalog(channel?: string) {
    return catalogFor(channel).map((e) => ({
      channel: e.channel,
      purpose: e.purpose,
      group: e.group,
      name: e.name,
      stageCode: e.stageCode,
      subject: e.subject,
      body: e.body,
      placeholders: e.placeholders.map((k) => `{{${k}}}`),
    }));
  }

  /** Insert the starting copy of every catalog purpose the institute does not have yet. Never overwrites an edited template. */
  async seedDefaults(user: AuthUser, channel?: string) {
    const created = await seedMissingTemplates(this.templates, this.iid(user), channel);
    return { ok: true, created };
  }

  listReminders(user: AuthUser) {
    return this.reminders.find({ instituteId: this.iid(user) }).lean();
  }

  createReminder(user: AuthUser, body: any) {
    return this.reminders.create({ ...body, instituteId: this.iid(user) });
  }

  listOutbound(user: AuthUser, fileId?: string, channel?: string) {
    const filter: any = { instituteId: this.iid(user) };
    if (fileId) {
      filter.fileId = Types.ObjectId.isValid(fileId) ? new Types.ObjectId(fileId) : fileId;
    }
    const ch = String(channel || '').toUpperCase();
    if (CHANNELS.includes(ch as (typeof CHANNELS)[number])) filter.channel = ch;
    return this.outbound.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async getOutbound(user: AuthUser, id: string) {
    const row = await this.outbound.findOne({ _id: id, instituteId: this.iid(user) }).lean();
    if (!row) throw new NotFoundException('Mail not found');
    return row;
  }

  looksLikeHtml(body: string) {
    return /<\/?(?:p|div|br|span|b|i|u|strong|em|ul|ol|li|h[1-6]|table|a|font|blockquote|hr|img)[\s>/]/i.test(body || '');
  }

  escapeHtml(s: string) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  interpolate(body: string, vars: Record<string, string>) {
    const html = this.looksLikeHtml(body);
    return body.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = vars[k] ?? '';
      if (!html) return v;
      return this.escapeHtml(v).replace(/\n/g, '<br>');
    });
  }

  async varsForFile(instituteId: string, file: ThesisFile, extra: Record<string, string> = {}) {
    const inst = await this.institutes.findById(instituteId);
    const course = file.courseId ? await this.courses.findById(file.courseId).select('name courseTypeId').lean() : null;
    const typeId = file.courseTypeId || course?.courseTypeId;
    const [courseType, department, speciality, session, ad] = await Promise.all([
      typeId ? this.courseTypes.findById(typeId).select('name').lean() : null,
      file.departmentId ? this.departments.findById(file.departmentId).select('name').lean() : null,
      file.specialityId ? this.specialities.findById(file.specialityId).select('name').lean() : null,
      file.sessionId ? this.sessions.findById(file.sessionId).select('month year').lean() : null,
      associateDean(this.users, instituteId),
    ]);
    const vars = {
      candidateName: file.candidate?.name || '',
      enrollmentNo: file.candidate?.enrollmentNo || '',
      thesisTitle: file.title || '',
      thesisNumber: file.thesisNumber || '',
      fileNo: file.fileNo || '',
      instituteName: inst?.displayName || inst?.name || '',
      logoUrl: webUrl(LETTERHEAD_LOGO_SRC),
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
      ...ad,
      chiefGuideName: file.chiefGuideName || extra.chiefGuideName || '',
      chiefGuideEmail: file.chiefGuideEmail || extra.chiefGuideEmail || '',
      stageName: file.currentStageCode || '',
      feeAmount: '4000',
      department: extra.department || department?.name || '',
      course: extra.course || course?.name || '',
      courseType: extra.courseType || courseType?.name || '',
      speciality: extra.speciality || speciality?.name || '',
      examinerName: extra.examinerName || '',
      examinerDesignation: extra.examinerDesignation || '',
      taskLink: extra.taskLink || '',
      otp: extra.otp || '',
      reminderLevel: extra.reminderLevel || '',
      panelList: extra.panelList || '',
      vivaDate: extra.vivaDate || file.vivaDate || '',
      vivaTime: extra.vivaTime || file.vivaTime || '',
      vivaVenue: extra.vivaVenue || file.vivaVenue || '',
      sessionMonth: extra.sessionMonth || session?.month || '',
      sessionYear: extra.sessionYear || (session?.year != null ? String(session.year) : ''),
      ...extra,
    };
    vars.taskLink = rewriteLocalOrigins(vars.taskLink || '');
    return vars;
  }

  async findActiveTemplate(instituteId: string, purpose: string, channel = 'EMAIL') {
    const iid = new Types.ObjectId(instituteId);
    const ch = String(channel || 'EMAIL').toUpperCase();
    const byPurpose = await this.templates.findOne({ instituteId: iid, purpose, active: true, channel: ch });
    if (byPurpose) return byPurpose;
    const stageMap: Record<string, string> = {
      PANEL_BUILD: 'panel_request',
      CONSENT: 'consent',
      EVALUATE: 'evaluate',
      DISPATCH: 'dispatch',
      OFFER: 'consent',
      THESIS: 'dispatch',
      REMINDER: 'evaluate',
      VIVA_DATE: 'viva_date',
      REVISION: 'revision_upload',
      CG_EVAL: 'cg_eval_send',
      VIVA: 'viva_send',
      BOARD: 'practical_date',
    };
    const stageCode = stageMap[purpose];
    if (stageCode) {
      const byStage = await this.templates.findOne({ instituteId: iid, stageCode, active: true, channel: ch });
      if (byStage) return byStage;
    }
    // First use of a catalog purpose: put its starting copy into the master and use that.
    return activeTemplate(this.templates, iid, purpose, ch);
  }

  async previewForFile(
    user: AuthUser,
    fileId: string,
    purpose: string,
    channel?: string,
    examinerName?: string,
  ) {
    if (!fileId) throw new BadRequestException('fileId is required');
    if (!purpose) throw new BadRequestException('purpose is required');
    const file = await this.files.findOne({ _id: fileId, instituteId: this.iid(user) });
    if (!file) throw new NotFoundException('File not found');
    const ch = String(channel || 'LETTER').toUpperCase();
    const extra: Record<string, string> = {};
    if (examinerName) extra.examinerName = examinerName;
    if (
      purpose === 'CONSENT' ||
      purpose === 'EVALUATE' ||
      purpose === 'OFFER' ||
      purpose === 'THESIS' ||
      purpose === 'PANEL_BUILD' ||
      purpose === 'VIVA_DATE' ||
      purpose === 'VIVA' ||
      purpose === 'REVISION' ||
      purpose === 'REVISION_EXAMINER'
    ) {
      extra.taskLink = extra.taskLink || '(generated when the mail is sent)';
    }
    if (purpose === 'REMINDER') extra.reminderLevel = String((file.reminderLevel || 0) + 1);
    if (purpose === 'PANEL_SUBMITTED') {
      extra.panelList = (file.panel || [])
        .filter((p) => Number(p.round || 1) === 1)
        .map((p, i) => {
          const location = [p.city, p.country].filter(Boolean).join(', ');
          return [
            `${i + 1}. ${p.name || 'Examiner'}`,
            p.email ? `   Email: ${p.email}` : '',
            `   Bucket: ${p.bucketCode || '—'}`,
            p.affiliation ? `   Affiliation: ${p.affiliation}` : '',
            p.designation ? `   Designation: ${p.designation}` : '',
            p.mobile ? `   Mobile: ${p.mobile}` : '',
            location ? `   Location: ${location}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n');
    }
    return this.renderChannel(user.instituteId as string, file, purpose, ch, extra);
  }

  async dispatchLetter(
    instituteId: string,
    file: ThesisFile,
    purpose: string,
    extraVars: Record<string, string> = {},
  ) {
    const rendered = await this.renderChannel(instituteId, file, purpose, 'LETTER', extraVars);
    let recipients = (file.panel || []).filter((p) => p.email && p.consentStatus === 'ACCEPTED');
    if (purpose === 'BOARD') {
      recipients = (file.panel || []).filter((p) => p.isPractical && p.email);
    }
    if (purpose === 'REVISION' || purpose === 'VIVA' || purpose === 'CG_EVAL') {
      recipients = [];
    }
    if (!recipients.length) {
      await this.outbound.create({
        instituteId: new Types.ObjectId(instituteId),
        fileId: (file as any)._id,
        templateId: rendered.templateId,
        channel: 'LETTER',
        subject: rendered.subject,
        body: rendered.body,
        purpose,
        status: 'SENT',
      });
      return { sent: 0, subject: rendered.subject, body: rendered.body, hasTemplate: rendered.hasTemplate };
    }
    let sent = 0;
    let last = { subject: rendered.subject, body: rendered.body };
    for (const p of recipients) {
      const vars = await this.varsForFile(instituteId, file, { ...extraVars, examinerName: p.name || '' });
      const subject = rendered.rawSubject ? this.interpolate(rendered.rawSubject, vars) : rendered.subject;
      const body = rendered.rawBody ? this.interpolate(rendered.rawBody, vars) : rendered.body;
      last = { subject, body };
      try {
        await this.mailer.send(p.email, subject, body);
      } catch {
        /* letter is still recorded for print / File 360 */
      }
      await this.outbound.create({
        instituteId: new Types.ObjectId(instituteId),
        fileId: (file as any)._id,
        templateId: rendered.templateId,
        channel: 'LETTER',
        to: p.email,
        toName: p.name,
        subject,
        body,
        purpose,
        status: 'SENT',
      });
      sent += 1;
    }
    return { sent, ...last, hasTemplate: rendered.hasTemplate };
  }

  private async renderChannel(
    instituteId: string,
    file: ThesisFile,
    purpose: string,
    channel: string,
    extraVars: Record<string, string> = {},
  ) {
    const vars = await this.varsForFile(instituteId, file, extraVars);
    const tpl = await this.findActiveTemplate(instituteId, purpose, channel);
    const fallback = this.fallbackBody(purpose, vars, channel);
    const rawSubject = tpl?.subject || '';
    const rawBody = tpl?.body || '';
    return {
      hasTemplate: !!tpl,
      templateId: tpl?._id,
      rawSubject: tpl?.subject,
      rawBody: tpl?.body,
      subject: rawSubject ? this.interpolate(rawSubject, vars) : fallback.subject,
      body: rawBody ? this.interpolate(rawBody, vars) : fallback.body,
    };
  }

  letterBodyHtml(body: string) {
    if (this.looksLikeHtml(body)) return body;
    return `<p>${this.escapeHtml(body).replace(/\n/g, '<br>')}</p>`;
  }

  async renderRevisionLetter(
    user: AuthUser,
    file: ThesisFile,
    kind: 'CG' | 'EXAMINER',
    member?: { name?: string; designation?: string; email?: string },
  ) {
    const instituteId = String(user.instituteId);
    const purpose = kind === 'EXAMINER' ? 'REVISION_EXAMINER' : 'REVISION';
    const extra: Record<string, string> = {
      examinerName: member?.name || '',
      examinerDesignation: member?.designation || '',
    };
    const rendered = await this.renderChannel(instituteId, file, purpose, 'LETTER', extra);
    const inst = await this.institutes.findById(instituteId).select('displayName name logoUrl').lean();
    return {
      kind,
      purpose,
      subject: rendered.subject,
      body: rendered.body,
      bodyHtml: this.letterBodyHtml(rendered.body),
      hasTemplate: rendered.hasTemplate,
      instituteName: inst?.displayName || inst?.name || '',
      logoUrl: LETTERHEAD_LOGO_SRC,
      fileNo: file.fileNo || '',
      thesisNumber: file.thesisNumber || '',
      thesisTitle: file.title || '',
      candidateName: file.candidate?.name || '',
      enrollmentNo: file.candidate?.enrollmentNo || '',
      chiefGuideName: file.chiefGuideName || '',
      examinerName: member?.name || '',
      examinerDesignation: member?.designation || '',
      examinerEmail: member?.email || '',
      printedAt: new Date().toISOString(),
    };
  }

  /** Used only when every template for the purpose is switched off: the catalog's starting copy. */
  fallbackBody(purpose: string, vars: Record<string, string>, channel?: string) {
    const entry = catalogEntry(purpose, channel || 'EMAIL') || catalogEntry(SystemMail.TASK_LINK)!;
    const all = { purpose, name: vars.examinerName || vars.chiefGuideName || '', ...vars };
    return { subject: this.interpolate(entry.subject, all), body: this.interpolate(entry.body, all) };
  }

  /** A mail that is not tied to one file (passcode, login invite, receipt), from the institute's Email master. */
  async sendSystemMail(
    instituteId: string,
    purpose: string,
    to: string,
    vars: Record<string, string>,
    toName?: string,
    fileId?: Types.ObjectId | string,
  ) {
    const { subject, body, templateId } = await renderTemplate(this.templates, instituteId, purpose, vars);
    const res = await this.mailer.send(to, subject, body, undefined, { noCc: NO_CC_MAILS.has(purpose) });
    await this.outbound.create({
      instituteId: new Types.ObjectId(instituteId),
      fileId: fileId ? new Types.ObjectId(String(fileId)) : undefined,
      templateId,
      channel: 'EMAIL',
      to,
      toName,
      subject,
      body,
      purpose,
      status: res.status,
    });
    return res;
  }

  async sendForPurpose(opts: {
    instituteId: string;
    purpose: string;
    file: ThesisFile;
    to: string;
    toName?: string;
    extraVars?: Record<string, string>;
  }) {
    const vars = await this.varsForFile(opts.instituteId, opts.file, opts.extraVars || {});
    const tpl = await this.findActiveTemplate(opts.instituteId, opts.purpose, 'EMAIL');
    const subject = rewriteLocalOrigins(
      tpl?.subject ? this.interpolate(tpl.subject, vars) : this.fallbackBody(opts.purpose, vars).subject,
    );
    const body = rewriteLocalOrigins(
      tpl?.body ? this.interpolate(tpl.body, vars) : this.fallbackBody(opts.purpose, vars).body,
    );
    await this.mailer.send(opts.to, subject, body);
    return this.outbound.create({
      instituteId: new Types.ObjectId(opts.instituteId),
      fileId: (opts.file as any)._id,
      templateId: tpl?._id,
      channel: tpl?.channel || 'EMAIL',
      to: opts.to,
      toName: opts.toName,
      subject,
      body,
      purpose: opts.purpose,
      status: 'SENT',
    });
  }

  async saveDraft(user: AuthUser, body: any) {
    if (!body.to || !body.body) throw new BadRequestException('To and body are required');
    return this.outbound.create({
      instituteId: this.iid(user),
      fileId: body.fileId || undefined,
      templateId: body.templateId || undefined,
      channel: body.channel || 'EMAIL',
      to: body.to,
      toName: body.toName,
      subject: body.subject || PRODUCT_NAME,
      body: body.body,
      purpose: body.purpose,
      status: 'DRAFT',
    });
  }

  async updateDraft(user: AuthUser, id: string, body: any) {
    const row = await this.outbound.findOne({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('Mail not found');
    if (row.status !== 'DRAFT') throw new BadRequestException('Only drafts can be edited');
    row.to = body.to ?? row.to;
    row.toName = body.toName ?? row.toName;
    row.subject = body.subject ?? row.subject;
    row.body = body.body ?? row.body;
    row.purpose = body.purpose ?? row.purpose;
    if (body.fileId) row.fileId = body.fileId;
    await row.save();
    return row;
  }

  async sendDraft(user: AuthUser, id: string) {
    const row = await this.outbound.findOne({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('Mail not found');
    if (row.status !== 'DRAFT') throw new BadRequestException('Already sent');
    if (!row.to) throw new BadRequestException('Recipient missing');
    await this.mailer.send(row.to, row.subject || PRODUCT_NAME, row.body);
    row.status = 'SENT';
    await row.save();
    return row;
  }

  async sendTemplate(user: AuthUser, templateId: string, fileId: string, to: string) {
    const tpl = await this.templates.findOne({ _id: templateId, instituteId: this.iid(user) });
    if (!tpl) throw new NotFoundException('Template not found');
    const file = await this.files.findOne({ _id: fileId, instituteId: this.iid(user) });
    if (!file) throw new NotFoundException('File not found');
    const vars = await this.varsForFile(user.instituteId as string, file);
    const subject = this.interpolate(tpl.subject || PRODUCT_NAME, vars);
    const body = this.interpolate(tpl.body, vars);
    await this.mailer.send(to, subject, body);
    return this.outbound.create({
      instituteId: this.iid(user),
      fileId: file._id,
      templateId: tpl._id,
      channel: tpl.channel,
      to,
      subject,
      body,
      purpose: tpl.purpose,
      status: 'SENT',
    });
  }

  /** Mails a Mail Master template to one examiner, with examiner placeholders filled from their panel entry. */
  async sendTemplateToExaminer(
    user: AuthUser,
    templateId: string,
    file: ThesisFile & { _id: unknown },
    member: { name?: string; email?: string },
    extra: Record<string, string> = {},
  ) {
    const tpl = await this.templates.findOne({ _id: templateId, instituteId: this.iid(user), channel: 'EMAIL' });
    if (!tpl) throw new NotFoundException('Mail template not found');
    const to = String(member.email || '').trim();
    if (!to) throw new BadRequestException('Examiner email is missing');
    const vars = await this.varsForFile(user.instituteId as string, file, {
      examinerName: member.name || '',
      examinerEmail: to,
      ...extra,
    });
    const subject = this.interpolate(tpl.subject || PRODUCT_NAME, vars);
    const body = this.interpolate(tpl.body, vars);
    const res = await this.mailer.send(to, subject, body);
    return this.outbound.create({
      instituteId: this.iid(user),
      fileId: file._id,
      templateId: tpl._id,
      channel: 'EMAIL',
      to,
      toName: member.name,
      subject,
      body,
      purpose: tpl.purpose,
      status: res.status,
    });
  }

  async sendTestMail(user: AuthUser, body: { to?: string; subject?: string; body?: string }) {
    const to = String(body.to || '').trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('Enter a valid email id');
    }
    const rawBody = String(body.body || '').trim();
    if (!rawBody) throw new BadRequestException('Mail body is required');
    const ad = await associateDean(this.users, String(user.instituteId));
    const vars: Record<string, string> = {
      logoUrl: webUrl(LETTERHEAD_LOGO_SRC),
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
      ...ad,
      candidateName: 'Sample Candidate',
      enrollmentNo: 'ENR0001',
      thesisTitle: 'Sample thesis title',
      thesisNumber: 'TH-1001',
      fileNo: 'EX-1001',
      instituteName: 'Sample Institute',
      chiefGuideName: 'Dr. Guide',
      chiefGuideEmail: 'guide@example.edu',
      stageName: 'evaluate',
      feeAmount: '4000',
      department: 'Sample Department',
      course: 'Sample Course',
      courseType: 'PhD',
      examinerName: 'Dr. Examiner',
      taskLink: 'https://example.edu/task/…',
      otp: '123456',
      reminderLevel: '1',
      panelList:
        '1. Dr. Sample Examiner\n   Email: examiner@example.edu\n   Bucket: Delhi\n   Affiliation: Sample Institute',
      vivaDate: '01 Jan 2026',
      vivaTime: '10:00 AM',
      vivaVenue: 'Seminar Hall',
    };
    const subject = this.interpolate(String(body.subject || '').trim() || `${PRODUCT_NAME} test mail`, vars);
    const html = this.interpolate(rawBody, vars);
    const res = await this.mailer.send(to, subject, html);
    if (res.status !== 'SENT') {
      throw new BadRequestException(
        'Mail was not sent: mail sending is disabled on this server (MAIL_DISABLED=1) or no mail settings are configured.',
      );
    }
    return { ok: true, to };
  }

  async remunerate(user: AuthUser, fileId: string) {
    const file = await this.files.findOne({ _id: fileId, instituteId: this.iid(user) });
    if (!file) throw new NotFoundException('File not found');
    const accepted = file.panel.filter((p) => (p.evaluation?.verdict === 'ACCEPT' || p.isChiefGuide || p.isPractical) && p.email);
    const unique = new Map<string, typeof accepted[number]>();
    for (const p of accepted) unique.set(String(p.email).toLowerCase(), p);
    const sent: unknown[] = [];
    for (const p of unique.values()) {
      const role = p.isChiefGuide
        ? 'Chief Guide'
        : Number(p.round) === 3
          ? '4th Indian examiner'
          : p.isPractical
            ? `Practical ${p.practicalRole || 'examiner'}`
            : p.bucketCode === 'FOREIGN'
              ? 'Foreign examiner'
              : 'Indian examiner';
      const vars = await this.varsForFile(String(user.instituteId), file, {
        examinerName: p.name || '',
        examinerRole: role,
        feeAmount: '4000',
        tadaAmount: p.travel?.tadaAmount ? String(p.travel.tadaAmount) : '',
        tadaNote: p.travel?.tadaAmount ? ` TADA ${p.travel.tadaAmount}.` : '',
        thesisNumber: file.thesisNumber || file.title || '',
      });
      const tpl = await this.findActiveTemplate(String(user.instituteId), SystemMail.REMUNERATE, 'EMAIL');
      const fallback = this.fallbackBody(SystemMail.REMUNERATE, vars);
      const subject = tpl?.subject ? this.interpolate(tpl.subject, vars) : fallback.subject;
      const body = tpl?.body ? this.interpolate(tpl.body, vars) : fallback.body;
      const res = await this.mailer.send(p.email, subject, body);
      sent.push(
        await this.outbound.create({
          instituteId: this.iid(user),
          fileId: file._id,
          templateId: tpl?._id,
          channel: 'EMAIL',
          to: p.email,
          toName: p.name,
          subject,
          body,
          purpose: SystemMail.REMUNERATE,
          status: res.status,
        }),
      );
    }
    return { sent: sent.length };
  }
}
