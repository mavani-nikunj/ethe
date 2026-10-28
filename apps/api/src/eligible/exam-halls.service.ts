import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/current-user';
import { ExamHall, ExamHallSeat } from '../database/exam-hall.schema';
import { SeatAllotment } from '../database/seat-allotment.schema';
import { escapeRegex, iid, oid, requireDealing, text } from './eligible-access';

/** Largest row the "Start Seat No → End Seat No" form may add at once. */
const MAX_SEATS_PER_ROW = 500;

function positiveInt(v: unknown, message: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(message);
  return n;
}

function sortSeats(seats: ExamHallSeat[]) {
  return [...seats].sort((a, b) => a.row - b.row || a.seatNo - b.seatNo);
}

@Injectable()
export class ExamHallsService {
  constructor(
    @InjectModel(ExamHall.name) private halls: Model<ExamHall>,
    @InjectModel(SeatAllotment.name) private allotments: Model<SeatAllotment>,
  ) {}

  /** A hall used by a locked seat allotment must stay, or the locked report would point at nothing. */
  private async assertNotLocked(hallId: unknown) {
    if (await this.allotments.exists({ locked: true, 'placements.hallId': hallId })) {
      throw new BadRequestException('This hall is used by a locked seat allotment and cannot be removed.');
    }
  }

  private summary(h: { _id: unknown; name: string; seats?: ExamHallSeat[] }) {
    const seats = h.seats || [];
    return {
      _id: h._id,
      name: h.name,
      totalSeats: seats.length,
      activeSeats: seats.filter((s) => s.active !== false).length,
      rows: new Set(seats.map((s) => s.row)).size,
    };
  }

  /** Hall Master list: Hall Name · Total Seat. */
  async list(user: AuthUser) {
    const rows = await this.halls.find({ instituteId: iid(user) }).lean();
    return rows.map((h) => this.summary(h)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  private async load(user: AuthUser, id: string) {
    const hall = await this.halls.findOne({ _id: oid(id, 'Hall'), instituteId: iid(user) });
    if (!hall) throw new NotFoundException('Hall not found');
    return hall;
  }

  /** "Show": the hall with its Seat Structure. */
  async getOne(user: AuthUser, id: string) {
    const hall = await this.load(user, id);
    return { ...this.summary(hall), seats: sortSeats(hall.seats || []) };
  }

  private nameFilter(user: AuthUser, name: string) {
    return { instituteId: iid(user), name: new RegExp(`^${escapeRegex(name)}$`, 'i') };
  }

  /** Add Hall → Process. As in the old screen, an existing name opens that hall instead of failing. */
  async create(user: AuthUser, body: { name?: string }) {
    requireDealing(user);
    const name = text(body?.name, 120);
    if (!name) throw new BadRequestException('Please Enter Hall Name.');
    const existing = await this.halls.findOne(this.nameFilter(user, name)).lean();
    if (existing) return { ...this.summary(existing), seats: sortSeats(existing.seats || []), existing: true };
    const hall = await this.halls.create({ instituteId: iid(user), name, seats: [], createdBy: new Types.ObjectId(user.userId) });
    return { ...this.summary(hall), seats: [], existing: false };
  }

  async rename(user: AuthUser, id: string, body: { name?: string }) {
    requireDealing(user);
    const hall = await this.load(user, id);
    const name = text(body?.name, 120);
    if (!name) throw new BadRequestException('Please Enter Hall Name.');
    const clash = await this.halls.exists({ ...this.nameFilter(user, name), _id: { $ne: hall._id } });
    if (clash) throw new BadRequestException('Another hall already has this name');
    hall.name = name;
    await hall.save();
    return this.getOne(user, id);
  }

  async remove(user: AuthUser, id: string) {
    requireDealing(user);
    const hall = await this.load(user, id);
    await this.assertNotLocked(hall._id);
    await this.halls.deleteOne({ _id: hall._id });
    return { deleted: true };
  }

  /** Row No + Start Seat No + End Seat No → one seat per number; numbers already in the hall are skipped. */
  async addRow(user: AuthUser, id: string, body: { row?: unknown; startSeat?: unknown; endSeat?: unknown }) {
    requireDealing(user);
    const hall = await this.load(user, id);
    const row = positiveInt(body?.row, 'Please Enter Row No and greater Than Zero.');
    const start = positiveInt(body?.startSeat, 'Please Enter Start Seat Number and greater Than Zero.');
    const end = positiveInt(body?.endSeat, 'Please Enter End Seat Number and greater Than Zero.');
    if (end < start) throw new BadRequestException('End Seat No must be greater than or equal to Start Seat No.');
    if (end - start + 1 > MAX_SEATS_PER_ROW) throw new BadRequestException(`A row can add at most ${MAX_SEATS_PER_ROW} seats at once.`);
    const taken = new Set((hall.seats || []).map((s) => s.seatNo));
    const added: number[] = [];
    const skipped: number[] = [];
    for (let n = start; n <= end; n++) {
      if (taken.has(n)) skipped.push(n);
      else added.push(n);
    }
    hall.seats = sortSeats([...(hall.seats || []), ...added.map((seatNo) => ({ row, seatNo, active: true }))]);
    await hall.save();
    return { ...(await this.getOne(user, id)), added: added.length, skipped };
  }

  /** Active / Deactive switch on one seat (old DeleteSeat toggled IsActive). */
  async setSeat(user: AuthUser, id: string, seatNo: string, body: { active?: unknown }) {
    requireDealing(user);
    const hall = await this.load(user, id);
    const n = positiveInt(seatNo, 'Seat No is required');
    const seat = (hall.seats || []).find((s) => s.seatNo === n);
    if (!seat) throw new NotFoundException('Seat not found');
    seat.active = typeof body?.active === 'boolean' ? body.active : !seat.active;
    hall.markModified('seats');
    await hall.save();
    return this.getOne(user, id);
  }

  /** Removes a seat entered by mistake (the old screen could only switch it off). */
  async removeSeat(user: AuthUser, id: string, seatNo: string) {
    requireDealing(user);
    const hall = await this.load(user, id);
    const n = positiveInt(seatNo, 'Seat No is required');
    const before = (hall.seats || []).length;
    hall.seats = (hall.seats || []).filter((s) => s.seatNo !== n);
    if (hall.seats.length === before) throw new NotFoundException('Seat not found');
    await hall.save();
    return this.getOne(user, id);
  }
}
