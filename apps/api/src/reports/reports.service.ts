import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '@ethesis/shared';
import { ThesisFile } from '../database/thesis-file.schema';
import { AcademicSession } from '../database/masters.schema';
import { AuthUser } from '../common/current-user';

export const REPORT_COLUMNS = [
  { key: 'thesisNumber', label: 'Thesis No.' },
  { key: 'candidate.name', label: 'Candidate' },
  { key: 'candidate.enrollmentNo', label: 'Enrollment' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'currentStageCode', label: 'Stage' },
  { key: 'chiefGuideName', label: 'Chief Guide' },
  { key: 'resultStatus', label: 'Result' },
  { key: 'evaluationRound', label: 'Eval round' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
];

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(ThesisFile.name) private fileModel: Model<ThesisFile>,
    @InjectModel(AcademicSession.name) private sessions: Model<AcademicSession>,
  ) {}

  columns() {
    return REPORT_COLUMNS;
  }

  private scope(user: AuthUser) {
    const filter: Record<string, unknown> = { instituteId: new Types.ObjectId(user.instituteId as string) };
    if (user.role === UserRole.COURSE) {
      filter.courseId = { $in: (user.courseIds || []).map((id) => new Types.ObjectId(id)) };
    }
    return filter;
  }

  private async withSessionFilter(
    user: AuthUser,
    filter: Record<string, unknown>,
    month?: string,
    year?: string,
    session?: string,
  ) {
    if (String(session || '').toLowerCase() === 'all') return filter;
    const iid = new Types.ObjectId(user.instituteId as string);
    const monthName = String(month || '').trim();
    const yearNum = Number(year);
    const hasYear = Number.isFinite(yearNum) && yearNum > 1900;
    if (monthName || hasYear) {
      const sessionFilter: Record<string, unknown> = { instituteId: iid };
      if (monthName) sessionFilter.month = monthName;
      if (hasYear) sessionFilter.year = yearNum;
      const sessionRows = await this.sessions.find(sessionFilter).select('_id').lean();
      filter.sessionId = { $in: sessionRows.map((s) => s._id) };
      return filter;
    }
    const current = await this.sessions.find({ instituteId: iid, current: true }).select('_id').lean();
    filter.sessionId = { $in: current.map((s) => s._id) };
    return filter;
  }

  async fileReport(user: AuthUser, columns?: string[], month?: string, year?: string, session?: string) {
    const rows = await this.fileModel
      .find(await this.withSessionFilter(user, this.scope(user), month, year, session))
      .sort({ updatedAt: -1 })
      .lean();
    const keys = columns?.length ? columns : REPORT_COLUMNS.map((c) => c.key);
    return {
      columns: REPORT_COLUMNS.filter((c) => keys.includes(c.key)),
      rows: rows.map((r) => {
        const out: Record<string, unknown> = { id: r._id.toString() };
        for (const k of keys) {
          out[k] = k.split('.').reduce((acc: any, p) => acc?.[p], r);
        }
        out.assignedExaminers = (r.panel || []).filter((p) => p.assigned).length;
        out.acceptedConsents = (r.panel || []).filter((p) => p.consentStatus === 'ACCEPTED').length;
        return out;
      }),
    };
  }

  async examinerTracking(user: AuthUser, month?: string, year?: string, session?: string): Promise<any[]> {
    const rows = await this.fileModel
      .find(await this.withSessionFilter(user, this.scope(user), month, year, session))
      .select('thesisNumber candidate title panel currentStageCode status reminderLevel vivaDate resultStatus')
      .lean();
    const out: any[] = [];
    for (const r of rows) {
      const examiners = r.panel || [];
      if (!examiners.length) {
        out.push({
          id: r._id.toString(),
          fileId: r._id.toString(),
          thesisNumber: r.thesisNumber,
          candidate: r.candidate?.name,
          title: r.title,
          status: r.status,
          stage: r.currentStageCode,
          examiner: '—',
          email: '',
          bucket: '',
          assigned: false,
          vetStatus: '',
          consentStatus: '',
          verdict: '',
          grade: '',
          travel: '',
        });
        continue;
      }
      for (let i = 0; i < examiners.length; i++) {
        const p = examiners[i];
        out.push({
          id: `${r._id}-${i}`,
          fileId: r._id.toString(),
          thesisNumber: r.thesisNumber,
          candidate: r.candidate?.name,
          title: r.title,
          status: r.status,
          stage: r.currentStageCode,
          examiner: p.name,
          email: p.email,
          bucket: p.bucketCode,
          assigned: p.assigned,
          vetStatus: p.vetStatus,
          consentStatus: p.consentStatus,
          verdict: p.evaluation?.verdict || '',
          grade: p.evaluation?.grade || '',
          travel: p.travel ? [p.travel.fromCity, p.travel.toCity, p.travel.pnr].filter(Boolean).join(' → ') : '',
        });
      }
    }
    return out;
  }
}
