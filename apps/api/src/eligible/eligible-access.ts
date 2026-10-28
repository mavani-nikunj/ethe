import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { UserRole } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { asObjectIds } from '../common/course-scope';
import { normalizeAuthoritySlot } from '../common/authority-slot';
import { AcademicSession } from '../database/masters.schema';

/** Role and course-scope rules shared by the Eligible Candidate services. */

export function iid(user: AuthUser) {
  return new Types.ObjectId(user.instituteId as string);
}

/** Dealing acts on these pages; ACE, Assoc. Dean and Institute Admin only view (plan §10, Q5). */
export function canEdit(user: AuthUser) {
  return user.role === UserRole.DEALING;
}

export function requireDealing(user: AuthUser) {
  if (!canEdit(user)) throw new ForbiddenException('Only the Dealing Assistant can do this');
}

export function isDean(user: AuthUser) {
  return user.role === UserRole.AUTHORITY && normalizeAuthoritySlot(user.authoritySlot) === 'ASSOC_DEAN';
}

/** Same rule as the practical module: Assoc. Dean sees only mapped courses, others mapped-or-all. */
export function courseScope(user: AuthUser): Types.ObjectId[] | null {
  const mapped = asObjectIds(user.courseIds);
  if (isDean(user)) return mapped;
  return mapped.length ? mapped : null;
}

export function inCourseScope(user: AuthUser, courseId: unknown) {
  const scope = courseScope(user);
  return !scope || scope.some((id) => String(id) === String(courseId));
}

export function assertCourseInScope(user: AuthUser, courseId: unknown) {
  if (!inCourseScope(user, courseId)) throw new ForbiddenException('This course is not mapped to your login');
}

export function text(v: unknown, max = 300): string {
  return String(v ?? '').trim().slice(0, max);
}

export function oid(v: unknown, label: string): Types.ObjectId {
  const s = String(v ?? '');
  if (!Types.ObjectId.isValid(s)) throw new BadRequestException(`${label} is required`);
  return new Types.ObjectId(s);
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type BulkResult = { updated: number; skipped: { id: string; name: string; reason: string }[] };

/** The given session of the institute, or the current one. */
export async function resolveSessionId(
  sessions: Model<AcademicSession>,
  user: AuthUser,
  sessionId?: string,
): Promise<Types.ObjectId> {
  if (sessionId && Types.ObjectId.isValid(sessionId)) {
    const row = await sessions.findOne({ _id: sessionId, instituteId: iid(user) }).select('_id').lean();
    if (!row) throw new BadRequestException('Session not found');
    return row._id as Types.ObjectId;
  }
  const current = await sessions.findOne({ instituteId: iid(user), current: true }).select('_id').lean();
  if (!current) throw new BadRequestException('No academic session is active. Activate a session first.');
  return current._id as Types.ObjectId;
}
