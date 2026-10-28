import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Staff Duty menu (examination staff invigilation duty). See docs/staff-duty-plan.md §8.1.
 * Old tables: tblStaff, tblAssignedStaff, tblStaffPreference, tblAllotedStaff, tblAllotedDuty.
 * The session is the Supervisor Session (Decision 1); sittings come from its Add Schedule.
 */

export type DutyBank = { bankName?: string; ifsc?: string; account?: string; accountType?: string };

/** Register of examination staff, institute-wide (old tblStaff). */
export type DutyStaffDocument = HydratedDocument<DutyStaff>;
@Schema({ timestamps: true, collection: 'duty_staff' })
export class DutyStaff {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  /** Code No (seniority / employee code). */
  @Prop({ required: true, trim: true }) code: string;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ trim: true }) designation?: string;
  @Prop({ trim: true }) department?: string;
  @Prop({ trim: true }) salaryCode?: string;
  @Prop({ type: Object }) bank?: DutyBank;
  @Prop({ default: false }) deleted: boolean;
}
export const DutyStaffSchema = SchemaFactory.createForClass(DutyStaff);
DutyStaffSchema.index({ instituteId: 1, code: 1 }, { unique: true, partialFilterExpression: { deleted: false } });
DutyStaffSchema.plugin(auditPlugin);

export type DutyUnavailable = { examDate: string; shift: string };

/** A staff member in one session with role and preferences (old tblAssignedStaff + tblStaffPreference). */
export type DutyStaffMemberDocument = HydratedDocument<DutyStaffMember>;
@Schema({ timestamps: true, collection: 'duty_staff_members' })
export class DutyStaffMember {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'DutyStaff', required: true, index: true }) staffId: Types.ObjectId;
  /** ALL_DUTY | SUPERVISOR | INVIGILATOR | SUPPORTING, or null (not allotted). */
  @Prop({ type: String, default: null }) role: string | null;
  /** ANY | Morning | Evening */
  @Prop({ default: 'ANY' }) shiftPreference: string;
  /** "Allotment" tick for the whole session. */
  @Prop({ default: true }) allot: boolean;
  /** Sittings this person can't do (per-date "Allotment" tick). */
  @Prop({ type: [{ examDate: String, shift: String, _id: false }], default: [] }) unavailable: DutyUnavailable[];
}
export const DutyStaffMemberSchema = SchemaFactory.createForClass(DutyStaffMember);
DutyStaffMemberSchema.index({ sessionId: 1, staffId: 1 }, { unique: true });
DutyStaffMemberSchema.plugin(auditPlugin);

export type DutyNeed = { allDuty: number; supervisor: number; invigilator: number; supporting: number };

/** Exam duty requirement of one sitting (old tblAllotedStaff). */
export type DutySittingDocument = HydratedDocument<DutySitting>;
@Schema({ timestamps: true, collection: 'duty_sittings' })
export class DutySitting {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSchedule', required: true, index: true }) scheduleId: Types.ObjectId;
  /** YYYY-MM-DD, kept in step with the schedule row. */
  @Prop({ required: true }) examDate: string;
  @Prop({ required: true }) shift: string;
  @Prop({ type: Object, required: true }) need: DutyNeed;
}
export const DutySittingSchema = SchemaFactory.createForClass(DutySitting);
DutySittingSchema.index({ sessionId: 1, examDate: 1, shift: 1 }, { unique: true });
DutySittingSchema.plugin(auditPlugin);

/** One person on one sitting (old tblAllotedDuty). */
export type DutyAllotmentDocument = HydratedDocument<DutyAllotment>;
@Schema({ timestamps: true, collection: 'duty_allotments' })
export class DutyAllotment {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'DutySitting', required: true, index: true }) sittingId: Types.ObjectId;
  @Prop({ required: true }) examDate: string;
  @Prop({ required: true }) shift: string;
  @Prop({ type: Types.ObjectId, ref: 'DutyStaff', required: true, index: true }) staffId: Types.ObjectId;
  /** The person's role in the session. */
  @Prop({ required: true }) memberRole: string;
  /** The requirement this duty fills (Supervisor filling an Invigilator shortfall → INVIGILATOR). */
  @Prop({ required: true }) dutyAs: string;
  /** AUTO | MANUAL | REPLACEMENT */
  @Prop({ required: true, default: 'AUTO' }) source: string;
  @Prop({ type: Types.ObjectId, ref: 'DutyStaff' }) replacedStaffId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) by?: Types.ObjectId;
}
export const DutyAllotmentSchema = SchemaFactory.createForClass(DutyAllotment);
DutyAllotmentSchema.index({ sittingId: 1, staffId: 1 }, { unique: true });
DutyAllotmentSchema.plugin(auditPlugin);

export type DutyShortfall = { sittingId: string; examDate: string; shift: string; dutyAs: string; missing: number };
/** Duty list texts; default to the old printed list (08:30 AM / 01:05 PM, three IMPORTANT notes). */
export type DutySettings = {
  reportingTime: { Morning: string; Evening: string };
  notes: string[];
  /** e.g. "MAY 2022 TO JUNE 2022"; empty → worked out from the first and last exam date. */
  titlePeriod?: string;
};

/** Allotment state of a session: generated / locked, shortfalls, duty list settings. */
export type DutyRunDocument = HydratedDocument<DutyRun>;
@Schema({ timestamps: true, collection: 'duty_runs' })
export class DutyRun {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSession', required: true, unique: true }) sessionId: Types.ObjectId;
  /** OPEN | LOCKED */
  @Prop({ required: true, default: 'OPEN' }) status: string;
  @Prop({ type: Object }) generated?: { at: Date; by?: string; byName?: string; mode?: string };
  @Prop({ type: Object }) locked?: { at: Date; by?: string; byName?: string };
  @Prop({ type: Array, default: [] }) unlocks: { at: Date; by?: string; byName?: string; reason: string }[];
  @Prop({ type: Array, default: [] }) shortfalls: DutyShortfall[];
  @Prop({ type: Object }) settings?: DutySettings;
}
export const DutyRunSchema = SchemaFactory.createForClass(DutyRun);
DutyRunSchema.plugin(auditPlugin);
