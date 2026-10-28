import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Practical examiner appointment is scoped to session + course + speciality, not to a thesis.
 * Old tables: tblSubjectCode / QunPprAndPracticalDate (schedule), tblApoinmentExaminer +
 * AppoinmentProcessLog (examiner + status).
 */

export type PracticalScheduleDocument = HydratedDocument<PracticalSchedule>;
@Schema({ timestamps: true, collection: 'practical_schedules' })
export class PracticalSchedule {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession', required: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true }) courseId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Speciality', required: true }) specialityId: Types.ObjectId;
  @Prop() department?: string;
  @Prop() subjectCode?: string;
  @Prop() totalStudents?: number;
  @Prop() totalMarks?: number;
  @Prop() pageNoInternal?: number;
  @Prop() pageNoExternal?: number;
  @Prop() tentativeSchedule?: string;
  @Prop({ type: Types.ObjectId, ref: 'ExamType' }) examTypeId?: Types.ObjectId;
  @Prop() examName?: string;
  @Prop() practicalDate?: string;
  @Prop() practicalDateBy?: string;
  @Prop() practicalDateAt?: Date;
}
export const PracticalScheduleSchema = SchemaFactory.createForClass(PracticalSchedule);
PracticalScheduleSchema.index({ instituteId: 1, sessionId: 1, specialityId: 1 }, { unique: true });
PracticalScheduleSchema.plugin(auditPlugin);

export type PracticalHistoryEvent = {
  status: string;
  at: Date;
  by?: string;
  byName?: string;
  role?: string;
  remark?: string;
};

export type PracticalExaminerDocument = HydratedDocument<PracticalExaminer>;
@Schema({ timestamps: true, collection: 'practical_examiners' })
export class PracticalExaminer {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'PracticalSchedule', required: true }) scheduleId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true }) courseId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Speciality', required: true }) specialityId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) dealingUserId: Types.ObjectId;
  @Prop({ required: true }) type: string;
  @Prop({ type: Types.ObjectId, ref: 'Faculty' }) facultyId?: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() designation?: string;
  @Prop() department?: string;
  @Prop() instituteName?: string;
  @Prop() instituteAddress?: string;
  @Prop() city?: string;
  @Prop({ required: true }) mobile: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() alternateMobile?: string;
  @Prop({ lowercase: true }) alternateEmail?: string;
  @Prop() salaryCode?: string;
  @Prop({ required: true, default: 'PENDING', index: true }) status: string;
  @Prop({ type: Array, default: [] }) history: PracticalHistoryEvent[];
  @Prop() rejectReason?: string;
  @Prop() regretReason?: string;
  @Prop() remarks?: string;
  @Prop() examinerCode?: string;
  @Prop({ type: Object }) approvedBy?: { userId?: string; name?: string; at?: Date };
  @Prop({ type: Object }) offer?: { sentAt?: Date; resentAt?: Date[] };
  @Prop() acceptedAt?: Date;
  @Prop({ type: Object }) appointment?: { sentAt?: Date; resentAt?: Date[] };
  @Prop({ type: Object }) portal?: { generatedAt?: Date; lastLoginAt?: Date };
  @Prop({ type: Object }) dateMail?: { state?: string; requestedAt?: Date; reminderAt?: Date[]; fixedAt?: Date };
  @Prop({ type: Object }) bank?: {
    holderName?: string;
    bankName?: string;
    branch?: string;
    ifsc?: string;
    accountType?: string;
    account?: string;
    pan?: string;
    chequePath?: string;
  };
  @Prop({ type: Object }) airBooking?: Record<string, unknown>;
}
export const PracticalExaminerSchema = SchemaFactory.createForClass(PracticalExaminer);
PracticalExaminerSchema.index({ instituteId: 1, sessionId: 1, specialityId: 1, type: 1 });
PracticalExaminerSchema.plugin(auditPlugin);

/**
 * Examiner entered from "Download Examiner Details" (old DownloadExaminers add form).
 * Scoped to exam month/year + course only, not to a speciality board, so it stays out of the
 * approval workflow; it shows in the download grid and in the Name of Examiner picker.
 */
export type PracticalExaminerDetailDocument = HydratedDocument<PracticalExaminerDetail>;
@Schema({ timestamps: true, collection: 'practical_examiner_details' })
export class PracticalExaminerDetail {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession', required: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true }) courseId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) dealingUserId: Types.ObjectId;
  @Prop({ required: true }) type: string;
  @Prop({ type: Types.ObjectId, ref: 'Faculty' }) facultyId?: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() designation?: string;
  @Prop() department?: string;
  @Prop() instituteName?: string;
  @Prop() instituteAddress?: string;
  @Prop() city?: string;
  @Prop({ required: true }) mobile: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() alternateMobile?: string;
  @Prop({ lowercase: true }) alternateEmail?: string;
  @Prop() salaryCode?: string;
}
export const PracticalExaminerDetailSchema = SchemaFactory.createForClass(PracticalExaminerDetail);
PracticalExaminerDetailSchema.index({ instituteId: 1, type: 1, sessionId: 1 });
PracticalExaminerDetailSchema.plugin(auditPlugin);

/** Small Dealing-managed lists behind the "+" buttons: designation, examiner department, schedule. */
export type PracticalLookupDocument = HydratedDocument<PracticalLookup>;
@Schema({ timestamps: true, collection: 'practical_lookups' })
export class PracticalLookup {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) kind: string;
  @Prop({ required: true }) name: string;
}
export const PracticalLookupSchema = SchemaFactory.createForClass(PracticalLookup);
PracticalLookupSchema.index({ instituteId: 1, kind: 1, name: 1 }, { unique: true });
PracticalLookupSchema.plugin(auditPlugin);

/**
 * Link sent to a practical examiner (offer accept/regret now; portal in P4).
 * Email OTP proves the examiner owns the mailbox; verify returns a short-lived session secret.
 */
export type PracticalTokenDocument = HydratedDocument<PracticalToken>;
@Schema({ timestamps: true, collection: 'practical_tokens' })
export class PracticalToken {
  @Prop({ required: true, unique: true }) token: string;
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'PracticalExaminer', required: true, index: true }) examinerId: Types.ObjectId;
  @Prop({ required: true }) purpose: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() otpHash?: string;
  @Prop() otpExpiresAt?: Date;
  @Prop() otpRequestedAt?: Date;
  @Prop({ default: 0 }) otpAttempts: number;
  @Prop() sessionHash?: string;
  @Prop() sessionExpiresAt?: Date;
  @Prop() verifiedAt?: Date;
}
export const PracticalTokenSchema = SchemaFactory.createForClass(PracticalToken);
PracticalTokenSchema.index({ examinerId: 1, purpose: 1 });
PracticalTokenSchema.plugin(auditPlugin);

/** Question papers (per course + speciality + session) and portal documents (upload types 1-7). */
export type PracticalDocumentDocument = HydratedDocument<PracticalDocument>;
@Schema({ timestamps: true, collection: 'practical_documents' })
export class PracticalDocument {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  /** 'QUESTION_PAPER' or 'DOC'. */
  @Prop({ required: true }) kind: string;
  /** 1-7 for kind DOC (see PRACTICAL_DOC_TYPES). */
  @Prop() uploadType?: number;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession' }) sessionId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course' }) courseId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Speciality' }) specialityId?: Types.ObjectId;
  @Prop({ required: true }) path: string;
  @Prop({ required: true }) originalName: string;
  @Prop() uploadedBy?: string;
}
export const PracticalDocumentSchema = SchemaFactory.createForClass(PracticalDocument);
PracticalDocumentSchema.plugin(auditPlugin);

/** Travel agents the Travel Manager sends booking requests to (old PersonManager). */
export type TravelAgentDocument = HydratedDocument<TravelAgent>;
@Schema({ timestamps: true, collection: 'travel_agents' })
export class TravelAgent {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() mobile?: string;
  @Prop({ default: true }) active: boolean;
}
export const TravelAgentSchema = SchemaFactory.createForClass(TravelAgent);
TravelAgentSchema.plugin(auditPlugin);
