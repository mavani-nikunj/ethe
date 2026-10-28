import { Model, Types } from 'mongoose';
import { UserRole, isCourseRole } from '@ethesis/shared';
import { Course } from '../database/masters.schema';
import { AuthUser } from './current-user';

export function asIdStrings(raw?: unknown[]): string[] {
  return (raw || [])
    .map((id) => String(id || '').trim())
    .filter((id) => Types.ObjectId.isValid(id));
}

export function asObjectIds(raw?: unknown[]): Types.ObjectId[] {
  return asIdStrings(raw).map((id) => new Types.ObjectId(id));
}

export async function resolveMappedCourseIds(
  courses: Model<Course>,
  user: {
    role: string;
    instituteId?: unknown;
    courseIds?: unknown[];
    departmentIds?: unknown[];
  },
): Promise<string[]> {
  const direct = [...new Set(asIdStrings(user.courseIds))];
  if (!isCourseRole(user.role)) return direct;
  const deptIds = asObjectIds(user.departmentIds);
  const instituteId = user.instituteId ? String(user.instituteId) : '';
  if (!deptIds.length || !Types.ObjectId.isValid(instituteId)) return direct;
  const rows = await courses
    .find({ instituteId: new Types.ObjectId(instituteId), departmentId: { $in: deptIds } })
    .select('_id')
    .lean();
  return [...new Set([...direct, ...rows.map((r) => String(r._id))])];
}

/** Staff logins limited to the courses ticked in Staff mapping (none ticked = every course). */
const OPTIONAL_SCOPE_ROLES: string[] = [UserRole.DEALING, UserRole.AUTHORITY];

function optionalScope(user: AuthUser): boolean {
  return OPTIONAL_SCOPE_ROLES.includes(user.role) && asIdStrings(user.courseIds).length > 0;
}

export function inMappedCourse(user: AuthUser, courseId: unknown): boolean {
  if (!isCourseRole(user.role) && !optionalScope(user)) return true;
  const allowed = user.courseIds || [];
  if (!allowed.length) return false;
  return allowed.includes(String(courseId || ''));
}

export function mappedCourseFilter(user: AuthUser): Record<string, unknown> | null {
  if (!isCourseRole(user.role) && !optionalScope(user)) return null;
  return { courseId: { $in: asObjectIds(user.courseIds) } };
}
