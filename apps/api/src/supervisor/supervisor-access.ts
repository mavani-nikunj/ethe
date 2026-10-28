import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';
import { normalizeAuthoritySlot } from '../common/authority-slot';

/** Role rules of the Supervisor menu (docs/supervisor-plan.md §2). */

export function iid(user: AuthUser) {
  return new Types.ObjectId(user.instituteId as string);
}

/** Dealing enters supervisors, sends to ACE, sends offers. */
export function canEdit(user: AuthUser) {
  return user.role === UserRole.DEALING;
}

/** Only the Asstt. Controller (ACE) approves (old RoleId 4). */
export function canApprove(user: AuthUser) {
  return user.role === UserRole.AUTHORITY && normalizeAuthoritySlot(user.authoritySlot) === 'ACE';
}

export function requireDealing(user: AuthUser) {
  if (!canEdit(user)) throw new ForbiddenException('Only the Dealing Assistant can do this');
}

export function requireAce(user: AuthUser) {
  if (!canApprove(user)) throw new ForbiddenException('Only the Asstt. Controller (Exams) can approve supervisors');
}

export function text(v: unknown, max = 300): string {
  return String(v ?? '').trim().slice(0, max);
}

export function oid(v: unknown, label: string): Types.ObjectId {
  const s = String(v ?? '');
  if (!Types.ObjectId.isValid(s)) throw new BadRequestException(`${label} is required`);
  return new Types.ObjectId(s);
}

export function oids(v: unknown): Types.ObjectId[] {
  const list = Array.isArray(v) ? v : [];
  return list.filter((x) => Types.ObjectId.isValid(String(x))).map((x) => new Types.ObjectId(String(x)));
}

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Accepts YYYY-MM-DD or DD/MM/YYYY; returns YYYY-MM-DD or ''. */
export function isoDate(v: unknown): string {
  const s = String(v ?? '').trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function dayName(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

export type BulkResult = { updated: number; skipped: { id: string; name: string; reason: string }[] };
