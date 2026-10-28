import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Supervisor menu (theory examination supervisory duty). See docs/supervisor-plan.md.
 * Old tables: tblsessionSUP1 (isRoll 1), SupervisorAddSchedule, tblMasterSupervisor, tblSupervisor,
 * tblSupervisorShift, SupervisorProcessLog, tblSupervisorBankInfo.
 */

/** Supervisor Session: month label + year + office file number. One active per institute. */
export type SupervisorSessionDocument = HydratedDocument<SupervisorSession>;
@Schema({ timestamps: true, collection: 'supervisor_sessions' })
export class SupervisorSession {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  /** "July", or a custom label added with "+" such as "July Slot-I". */
  @Prop({ required: true, trim: true }) month: string;
  @Prop({ required: true }) year: number;
  @Prop({ required: true, trim: true }) fileNumber: string;
  @Prop({ default: false, index: true }) active: boolean;
}
export const SupervisorSessionSchema = SchemaFactory.createForClass(SupervisorSession);
SupervisorSessionSchema.index({ instituteId: 1, month: 1, year: 1 }, { unique: true });
SupervisorSessionSchema.plugin(auditPlugin);

/** Extra month labels and years behind the "+" buttons, and the designation list. */
export type SupervisorLookupDocument = HydratedDocument<SupervisorLookup>;
@Schema({ timestamps: true, collection: 'supervisor_lookups' })
export class SupervisorLookup {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  /** MONTH | YEAR | DESIGNATION */
  @Prop({ required: true }) kind: string;
  @Prop({ required: true, trim: true }) name: string;
}
export const SupervisorLookupSchema = SchemaFactory.createForClass(SupervisorLookup);
SupervisorLookupSchema.index({ instituteId: 1, kind: 1, name: 1 }, { unique: true });
SupervisorLookupSchema.plugin(auditPlugin);

/** One exam sitting (date + shift) of a supervisor session (old SupervisorAddSchedule). */
export type SupervisorScheduleDocument = HydratedDocument<SupervisorSchedule>;
@Schema({ timestamps: true, collection: 'supervisor_schedules' })
export class SupervisorSchedule {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ required: true, trim: true }) examName: string;
  /** YYYY-MM-DD. */
  @Prop({ required: true }) examDate: string;
  /** Morning | Evening */
  @Prop({ required: true }) shift: string;
  @Prop({ required: true }) time: string;
  @Prop({ required: true }) studentCount: number;
}
export const SupervisorScheduleSchema = SchemaFactory.createForClass(SupervisorSchedule);
SupervisorScheduleSchema.index({ sessionId: 1, examDate: 1, shift: 1 }, { unique: true });
SupervisorScheduleSchema.plugin(auditPlugin);

/** Registry of supervisors across sessions (old tblMasterSupervisor). */
export type SupervisorPersonDocument = HydratedDocument<SupervisorPerson>;
@Schema({ timestamps: true, collection: 'supervisor_people' })
export class SupervisorPerson {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ trim: true }) designation?: string;
  @Prop({ trim: true }) department?: string;
  @Prop({ trim: true }) instituteName?: string;
  @Prop({ trim: true }) address?: string;
  @Prop({ required: true }) mobile: string;
  @Prop({ required: true, lowercase: true, trim: true }) email: string;
  @Prop({ default: false }) deleted: boolean;
}
export const SupervisorPersonSchema = SchemaFactory.createForClass(SupervisorPerson);
SupervisorPersonSchema.index({ instituteId: 1, email: 1 }, { unique: true });
SupervisorPersonSchema.plugin(auditPlugin);

export type SupervisorDuty = {
  scheduleId: Types.ObjectId;
  examDate: string;
  shift: string;
  reportingTime: string;
};

export type SupervisorHistoryEvent = {
  status: string;
  at: Date;
  by?: string;
  byName?: string;
  role?: string;
  remark?: string;
};

/** A supervisor in one session, with duties, workflow status and acceptance (old tblSupervisor + friends). */
export type SupervisorAppointmentDocument = HydratedDocument<SupervisorAppointment>;
@Schema({ timestamps: true, collection: 'supervisor_appointments' })
export class SupervisorAppointment {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorPerson', required: true, index: true }) personId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User' }) dealingUserId?: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ trim: true }) designation?: string;
  @Prop({ trim: true }) department?: string;
  @Prop({ trim: true }) instituteName?: string;
  @Prop({ trim: true }) address?: string;
  @Prop({ required: true }) mobile: string;
  @Prop({ required: true, lowercase: true, trim: true }) email: string;
  @Prop({ required: true, default: 'DRAFT', index: true }) status: string;
  @Prop({ type: Array, default: [] }) history: SupervisorHistoryEvent[];
  @Prop({ type: Array, default: [] }) duties: SupervisorDuty[];
  @Prop({ type: Object }) approvedBy?: { userId?: string; name?: string; at?: Date };
  @Prop({ type: Object }) offer?: { sentAt?: Date; resentAt?: Date[] };
  @Prop() acceptedAt?: Date;
  @Prop() regretReason?: string;
  @Prop() withdrawReason?: string;
  @Prop({ type: Object }) declarations?: { noRelative?: boolean; available?: boolean; at?: Date };
  @Prop() salaryCode?: string;
  @Prop() remuneration?: string;
  @Prop({ type: Object }) bank?: {
    holderName?: string;
    bankName?: string;
    branch?: string;
    ifsc?: string;
    accountType?: string;
    account?: string;
    chequePath?: string;
  };
}
export const SupervisorAppointmentSchema = SchemaFactory.createForClass(SupervisorAppointment);
SupervisorAppointmentSchema.index({ sessionId: 1, personId: 1 });
SupervisorAppointmentSchema.plugin(auditPlugin);

/** Offer link sent to a supervisor. Email OTP proves the mailbox; verify returns a short-lived session. */
export type SupervisorTokenDocument = HydratedDocument<SupervisorToken>;
@Schema({ timestamps: true, collection: 'supervisor_tokens' })
export class SupervisorToken {
  @Prop({ required: true, unique: true }) token: string;
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorAppointment', required: true, index: true }) appointmentId: Types.ObjectId;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() otpHash?: string;
  @Prop() otpExpiresAt?: Date;
  @Prop() otpRequestedAt?: Date;
  @Prop({ default: 0 }) otpAttempts: number;
  @Prop() sessionHash?: string;
  @Prop() sessionExpiresAt?: Date;
  @Prop() verifiedAt?: Date;
}
export const SupervisorTokenSchema = SchemaFactory.createForClass(SupervisorToken);
SupervisorTokenSchema.plugin(auditPlugin);
