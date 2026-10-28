import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Theory-exam candidate of a session (old AcademicSection rows on the "Eligible Candidate" menu).
 * THESIS rows are synced from thesis files of the session ("New"); MANUAL (Add Old Candidate) and
 * CARRIED (Previous Candidate) rows are re-appearing candidates ("Old"). See docs/eligible-candidate-plan.md.
 */
export const ExamCandidateSource = {
  THESIS: 'THESIS',
  MANUAL: 'MANUAL',
  CARRIED: 'CARRIED',
} as const;

export type ExamCandidateEvent = {
  action: string;
  at: Date;
  by?: string;
  byName?: string;
  reason?: string;
};

export type ExamCandidateDocument = HydratedDocument<ExamCandidate>;
@Schema({ timestamps: true, collection: 'exam_candidates' })
export class ExamCandidate {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true }) courseId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Speciality', required: true }) specialityId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Department' }) departmentId?: Types.ObjectId;
  @Prop({ required: true, trim: true }) enrollmentNo: string;
  @Prop({ required: true, trim: true }) name: string;
  @Prop() dob?: string;
  @Prop() mobile?: string;
  @Prop({ lowercase: true, trim: true }) email?: string;
  @Prop({ required: true }) source: string;
  @Prop({ type: Types.ObjectId, ref: 'ThesisFile' }) thesisFileId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession' }) carriedFromSessionId?: Types.ObjectId;
  @Prop({ default: true, index: true }) eligible: boolean;
  @Prop() notEligibleReason?: string;
  @Prop({ type: Array, default: [] }) history: ExamCandidateEvent[];
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
}
export const ExamCandidateSchema = SchemaFactory.createForClass(ExamCandidate);
ExamCandidateSchema.index({ instituteId: 1, sessionId: 1, enrollmentNo: 1 }, { unique: true });
ExamCandidateSchema.index({ instituteId: 1, enrollmentNo: 1 });
ExamCandidateSchema.plugin(auditPlugin);
