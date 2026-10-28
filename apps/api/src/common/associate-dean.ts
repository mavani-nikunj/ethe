import { Model, Types } from 'mongoose';
import { UserStatus } from '@ethesis/shared';
import { User } from '../database/user.schema';
import { normalizeAuthoritySlot } from './authority-slot';

/**
 * The institute's Associate Dean (Exams) for the mail letterhead ({{adName}} / {{adEmail}}):
 * an enabled user whose authority slot is ASSOC_DEAN, preferring ACTIVE over INVITED, then the latest updated.
 */
export async function associateDean(users: Model<User>, instituteId: Types.ObjectId | string) {
  const rows = await users
    .find({
      instituteId: new Types.ObjectId(String(instituteId)),
      authoritySlot: { $exists: true, $ne: '' },
      status: { $ne: UserStatus.DISABLED },
    })
    .select('name email status authoritySlot updatedAt')
    .sort({ updatedAt: -1 })
    .lean();
  const deans = rows.filter((u) => normalizeAuthoritySlot(u.authoritySlot) === 'ASSOC_DEAN');
  const ad = deans.find((u) => u.status === UserStatus.ACTIVE) || deans[0];
  return { adName: ad?.name || '', adEmail: ad?.email || '' };
}
