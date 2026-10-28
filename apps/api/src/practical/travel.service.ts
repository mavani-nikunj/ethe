import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PRACTICAL_AIR_STATUS_LABELS,
  PracticalAirStatus,
  cleanMobile,
  isValidEmail,
  isValidMobile,
  normalizeEmail,
  practicalTypeLabel,
} from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { webUrl } from '../common/web-origin';
import { PracticalExaminer, TravelAgent } from '../database/practical.schema';
import { AcademicSession, Course, Speciality } from '../database/masters.schema';
import { PracticalMail, PracticalMailService } from './practical-mail.service';
import { removeUpload } from './practical-files';

const A = PracticalAirStatus;
const text = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);

/** Lists on the Travel Manager menu (old TravalManager: tickets, uploaded, canceled). */
const TRAVEL_VIEWS: Record<string, string[]> = {
  requests: [A.SENT_TO_TM, A.SENT_TO_AGENT],
  uploaded: [A.TICKET_UPLOADED, A.TICKET_SENT],
  cancelled: [A.CANCELLED],
};

@Injectable()
export class TravelService {
  constructor(
    @InjectModel(PracticalExaminer.name) private examiners: Model<PracticalExaminer>,
    @InjectModel(TravelAgent.name) private agents: Model<TravelAgent>,
    @InjectModel(Course.name) private courses: Model<Course>,
    @InjectModel(Speciality.name) private specialities: Model<Speciality>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
    private mail: PracticalMailService,
  ) {}

  private iid(user: AuthUser) {
    return new Types.ObjectId(user.instituteId as string);
  }

  // ----- agents (old "Person Manager") -----

  listAgents(user: AuthUser) {
    return this.agents.find({ instituteId: this.iid(user) }).sort({ name: 1 }).lean();
  }

  private agentFields(body: Record<string, unknown>) {
    const name = text(body.name, 160);
    const email = normalizeEmail(body.email);
    const mobile = cleanMobile(body.mobile as string);
    if (!name) throw new BadRequestException('Agent name is required');
    if (!isValidEmail(email)) throw new BadRequestException('Enter a valid email');
    if (mobile && !isValidMobile(mobile)) throw new BadRequestException('Enter a valid 10-digit mobile');
    return { name, email, mobile, active: body.active === undefined ? true : Boolean(body.active) };
  }

  createAgent(user: AuthUser, body: Record<string, unknown>) {
    return this.agents.create({ ...this.agentFields(body), instituteId: this.iid(user) });
  }

  async updateAgent(user: AuthUser, id: string, body: Record<string, unknown>) {
    const row = await this.agents.findOneAndUpdate({ _id: id, instituteId: this.iid(user) }, { $set: this.agentFields(body) }, { new: true });
    if (!row) throw new NotFoundException('Agent not found');
    return row;
  }

  async removeAgent(user: AuthUser, id: string) {
    const res = await this.agents.deleteOne({ _id: id, instituteId: this.iid(user) });
    if (!res.deletedCount) throw new NotFoundException('Agent not found');
    return { ok: true };
  }

  // ----- ticket requests -----

  async list(user: AuthUser, view: string) {
    const statuses = TRAVEL_VIEWS[view] || TRAVEL_VIEWS.requests;
    const rows = await this.examiners
      .find({ instituteId: this.iid(user), 'airBooking.status': { $in: statuses } })
      .sort({ 'airBooking.sentToTmAt': -1 })
      .lean();
    const ids = (k: string) => [...new Set(rows.map((r: any) => String(r[k])))];
    const [courses, specs, sessions, agents] = await Promise.all([
      this.courses.find({ _id: { $in: ids('courseId') } }).select('name').lean(),
      this.specialities.find({ _id: { $in: ids('specialityId') } }).select('name').lean(),
      this.sessions.find({ _id: { $in: ids('sessionId') } }).select('month year').lean(),
      this.agents.find({ instituteId: this.iid(user) }).select('name').lean(),
    ]);
    const name = (list: any[], id: unknown, f = (x: any) => x.name) => {
      const hit = list.find((x) => String(x._id) === String(id));
      return hit ? f(hit) : '';
    };
    return rows.map((r) => {
      const b = (r.airBooking || {}) as Record<string, any>;
      return {
        _id: r._id,
        name: r.name,
        type: practicalTypeLabel(r.type),
        mobile: r.mobile,
        email: r.email,
        city: r.city,
        instituteName: r.instituteName,
        courseName: name(courses, r.courseId),
        specialityName: name(specs, r.specialityId),
        sessionLabel: name(sessions, r.sessionId, (s) => `${s.month} ${s.year}`),
        booking: { ...b, ticketPath: undefined, hasTicket: Boolean(b.ticketPath) },
        statusLabel: PRACTICAL_AIR_STATUS_LABELS[b.status] || b.status,
        agentName: b.agentId ? name(agents, b.agentId) : '',
      };
    });
  }

  private async load(user: AuthUser, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid request');
    const row = await this.examiners.findOne({ _id: id, instituteId: this.iid(user) });
    if (!row?.airBooking) throw new NotFoundException('Ticket request not found');
    return row;
  }

  private async setBooking(row: { _id: unknown }, set: Record<string, unknown>, user: AuthUser, remark: string, status: string) {
    const $set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(set)) $set[`airBooking.${k}`] = v;
    await this.examiners.updateOne(
      { _id: row._id },
      { $set, $push: { history: { status, at: new Date(), by: user.userId, byName: user.name, role: 'TRAVEL', remark } } },
    );
  }

  /** Mail the booking details to the chosen travel agent (old Process status 1). */
  async sendToAgent(user: AuthUser, id: string, body: { agentId?: string }) {
    const row = await this.load(user, id);
    const b = row.airBooking as Record<string, any>;
    if (![A.SENT_TO_TM, A.SENT_TO_AGENT].includes(b.status)) throw new BadRequestException(`Request is "${PRACTICAL_AIR_STATUS_LABELS[b.status]}"`);
    const agent = await this.agents.findOne({ _id: body?.agentId, instituteId: this.iid(user), active: true }).lean();
    if (!agent) throw new BadRequestException('Select a travel agent');
    await this.mail.send(row as any, PracticalMail.TRAVEL_BOOKING, { agentName: agent.name, senderName: user.name }, { email: agent.email, name: agent.name });
    await this.setBooking(row, { status: A.SENT_TO_AGENT, agentId: agent._id, sentToAgentAt: new Date() }, user, `Booking sent to agent ${agent.name}`, row.status);
    return { ok: true };
  }

  async uploadTicket(user: AuthUser, id: string, file?: { path: string; originalName: string }) {
    try {
      if (!file) throw new BadRequestException('Choose the ticket file (PDF or image)');
      const row = await this.load(user, id);
      const b = row.airBooking as Record<string, any>;
      if (![A.SENT_TO_TM, A.SENT_TO_AGENT, A.TICKET_UPLOADED].includes(b.status)) {
        throw new BadRequestException(`Request is "${PRACTICAL_AIR_STATUS_LABELS[b.status]}"`);
      }
      const old = b.ticketPath as string | undefined;
      await this.setBooking(
        row,
        { status: A.TICKET_UPLOADED, ticketPath: file.path, ticketName: file.originalName, ticketUploadedAt: new Date() },
        user,
        'Ticket uploaded',
        row.status,
      );
      if (old && old !== file.path) await removeUpload(old);
      return { ok: true };
    } catch (err) {
      await removeUpload(file?.path);
      throw err;
    }
  }

  async sendTicket(user: AuthUser, id: string) {
    const row = await this.load(user, id);
    const b = row.airBooking as Record<string, any>;
    if (![A.TICKET_UPLOADED, A.TICKET_SENT].includes(b.status) || !b.ticketPath) throw new BadRequestException('Upload the ticket first');
    await this.mail.send(row as any, PracticalMail.TRAVEL_TICKET, { ticketLink: webUrl(`/api/uploads/${b.ticketPath}`) });
    await this.setBooking(row, { status: A.TICKET_SENT, ticketSentAt: new Date() }, user, 'Ticket sent to examiner', row.status);
    return { ok: true };
  }

  async cancel(user: AuthUser, id: string, body: { reason?: string }) {
    const row = await this.load(user, id);
    const b = row.airBooking as Record<string, any>;
    const reason = text(body?.reason, 500);
    if (!reason) throw new BadRequestException('Give the reason for cancellation');
    if (b.status === A.CANCELLED) throw new BadRequestException('Already cancelled');
    if (b.agentId) {
      const agent = await this.agents.findById(b.agentId).lean();
      if (agent) {
        await this.mail.send(row as any, PracticalMail.TRAVEL_CANCEL, { agentName: agent.name, senderName: user.name, cancelReason: reason }, {
          email: agent.email,
          name: agent.name,
        });
      }
    }
    await this.setBooking(row, { status: A.CANCELLED, cancelReason: reason, cancelledAt: new Date() }, user, `Ticket cancelled: ${reason}`, row.status);
    return { ok: true };
  }

  async ticketFile(user: AuthUser, id: string) {
    const row = await this.load(user, id);
    const b = row.airBooking as Record<string, any>;
    if (!b.ticketPath) throw new NotFoundException('No ticket uploaded');
    return { path: b.ticketPath as string, originalName: (b.ticketName as string) || 'ticket.pdf' };
  }
}
