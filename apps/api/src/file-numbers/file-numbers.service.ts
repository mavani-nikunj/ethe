import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FileNumberPrefix } from '../database/file-number.schema';
import { ThesisFile } from '../database/thesis-file.schema';
import { AcademicSession } from '../database/masters.schema';
import { AuthUser } from '../common/current-user';

export const FILE_NUMBER_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Trimmed, required, at most 160 characters; shared with the per-thesis file no. edit. */
export function cleanFileNumber(value: unknown) {
  const fileNumber = String(value ?? '').trim();
  if (!fileNumber) throw new BadRequestException('File number is required');
  if (fileNumber.length > 160) throw new BadRequestException('File number is too long');
  return fileNumber;
}

const MONTH_RANK = new Map<string, number>(FILE_NUMBER_MONTHS.map((m, i) => [m, i]));

@Injectable()
export class FileNumbersService {
  constructor(
    @InjectModel(FileNumberPrefix.name) private prefixes: Model<FileNumberPrefix>,
    @InjectModel(ThesisFile.name) private files: Model<ThesisFile>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
  ) {}

  iid(user: AuthUser) {
    return new Types.ObjectId(user.instituteId as string);
  }

  async list(user: AuthUser) {
    const rows = await this.prefixes.find({ instituteId: this.iid(user) }).lean();
    return rows.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return (MONTH_RANK.get(b.month) ?? 0) - (MONTH_RANK.get(a.month) ?? 0);
    });
  }

  async create(user: AuthUser, body: { month?: string; year?: string | number; fileNumber?: string }) {
    const month = String(body?.month || '').trim();
    if (!FILE_NUMBER_MONTHS.includes(month as (typeof FILE_NUMBER_MONTHS)[number])) {
      throw new BadRequestException('Select a valid session month');
    }
    const year = Number(body?.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Select a valid session year');
    }
    const fileNumber = cleanFileNumber(body?.fileNumber);

    const clash = await this.prefixes.findOne({ instituteId: this.iid(user), month, year }).lean();
    if (clash) throw new BadRequestException(`A file number already exists for ${month} ${year}`);

    try {
      return await this.prefixes.create({
        instituteId: this.iid(user),
        month,
        year,
        fileNumber,
      });
    } catch (err: any) {
      if (err?.code === 11000) throw new BadRequestException(`A file number already exists for ${month} ${year}`);
      throw err;
    }
  }

  /**
   * Change a session's file number. Thesis files copy the prefix when they are numbered, so files of that
   * session still carrying the old prefix are moved to the new one; files given their own number keep it.
   */
  async update(user: AuthUser, id: string, body: { fileNumber?: string }) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('File number not found');
    const fileNumber = cleanFileNumber(body?.fileNumber);
    const row = await this.prefixes.findOne({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('File number not found');
    const previous = String(row.fileNumber || '').trim();
    if (previous === fileNumber) return { ok: true, fileNumber, updatedFiles: 0 };

    row.fileNumber = fileNumber;
    await row.save();

    const sessionIds = await this.sessions
      .find({ instituteId: this.iid(user), month: row.month, year: row.year })
      .distinct('_id');
    let updatedFiles = 0;
    if (sessionIds.length && previous) {
      const res = await this.files.updateMany(
        { instituteId: this.iid(user), sessionId: { $in: sessionIds }, fileNo: previous },
        { $set: { fileNo: fileNumber } },
      );
      updatedFiles = res.modifiedCount;
    }
    return { ok: true, fileNumber, updatedFiles };
  }

  async findForSession(
    instituteId: Types.ObjectId | string,
    month?: string,
    year?: string | number,
  ): Promise<string | null> {
    const monthName = String(month || '').trim();
    const yearNum = Number(year);
    if (!monthName || !Number.isInteger(yearNum)) return null;
    const row = await this.prefixes
      .findOne({
        instituteId: new Types.ObjectId(String(instituteId)),
        month: monthName,
        year: yearNum,
      })
      .lean();
    const prefix = String(row?.fileNumber || '').trim();
    return prefix || null;
  }

  async remove(user: AuthUser, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('File number not found');
    const row = await this.prefixes.findOneAndDelete({ _id: id, instituteId: this.iid(user) });
    if (!row) throw new NotFoundException('File number not found');
    return { ok: true };
  }
}
