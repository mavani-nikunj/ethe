import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type MetroEvent = {
  stageCode: string;
  stageName: string;
  status: string;
  at?: Date;
  by?: string;
  remark?: string;
};

export type PanelMember = {
  _id?: Types.ObjectId;
  name: string;
  email: string;
  mobile?: string;
  designation?: string;
  affiliation?: string;
  city?: string;
  country?: string;
  bucketCode: string;
  assigned: boolean;
  round: number;
  isChiefGuide?: boolean;
  extra?: boolean;
  isPractical?: boolean;
  practicalRole?: string;
  vetStatus?: string;
  consentStatus: string;
  offerSentAt?: Date;
  address?: string;
  department?: string;
  alternateMobile?: string;
  alternateEmail?: string;
  consentRemark?: string;
  bank?: {
    holderName?: string;
    bankName?: string;
    branchAddress?: string;
    ifsc?: string;
    accountType?: string;
    account?: string;
    pan?: string;
    cancelledChequePath?: string;
  };
  travel?: {
    fromCity?: string;
    toCity?: string;
    departDate?: string;
    returnDate?: string;
    pnr?: string;
    hotel?: string;
    mode?: string;
    tadaAmount?: string;
  };
  evaluation?: {
    verdict?: string;
    grade?: string;
    comments?: string;
    report?: Record<string, string>;
    checklist?: { key: string; ok: boolean }[];
    submittedAt?: Date;
    documentVersion?: number;
  };
  evaluationHistory?: {
    verdict?: string;
    grade?: string;
    comments?: string;
    report?: Record<string, string>;
    checklist?: { key: string; ok: boolean }[];
    submittedAt?: Date;
    documentVersion?: number;
  }[];
  thesisSentAt?: Date;
};

export type FileDocumentDoc = {
  kind: string;
  version: number;
  path: string;
  originalName: string;
  uploadedAt: Date;
  uploadedBy?: string;
};

export type ThesisFileDocument = HydratedDocument<ThesisFile>;

@Schema({ timestamps: true })
export class ThesisFile {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true }) courseId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'CourseType' }) courseTypeId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Department', required: true }) departmentId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession' }) sessionId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Speciality' }) specialityId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Blueprint', required: true }) blueprintId: Types.ObjectId;
  @Prop({ type: Object, required: true }) candidate: {
    enrollmentNo: string;
    name: string;
    dob?: string;
    mobile?: string;
    email?: string;
  };
  @Prop({ default: '' }) title?: string;
  @Prop() thesisNumber?: string;
  @Prop() fileNo?: string;
  @Prop({ type: Types.ObjectId, ref: 'Faculty' }) chiefGuideId?: Types.ObjectId;
  @Prop() chiefGuideName?: string;
  @Prop() chiefGuideEmail?: string;
  @Prop({ type: [Types.ObjectId], default: [] }) coGuideIds: Types.ObjectId[];
  @Prop({ required: true }) currentStageCode: string;
  @Prop({ default: 'IN_PROGRESS' }) status: string;
  @Prop({ default: 'RELEASE' }) resultStatus: string;
  @Prop({ type: Array, default: [] }) metro: MetroEvent[];
  @Prop({ type: Array, default: [] }) documents: FileDocumentDoc[];
  @Prop({ type: Array, default: [] }) panel: PanelMember[];
  @Prop({ default: 1 }) evaluationRound: number;
  @Prop({ default: false }) needsAdditionalPanel: boolean;
  @Prop({ default: 0 }) consentTargetCount: number;
  @Prop({ default: 0 }) reminderLevel: number;
  @Prop() vivaDate?: string;
  @Prop() vivaTime?: string;
  @Prop() vivaVenue?: string;
  @Prop() revisionLetterSentAt?: Date;
  @Prop() academicAcknowledgedAt?: Date;
  @Prop() academicAcknowledgedBy?: string;
  @Prop({ type: Object }) examAdmin?: {
    hall?: string;
    supervisors?: string;
    staffDuty?: string;
    eligibleCount?: string;
  };
  @Prop({ type: Array, default: [] }) notes: { at: Date; by: string; role?: string; message: string }[];
  @Prop() remarks?: string;
  @Prop() lastActionRemark?: string;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
  @Prop({ type: Object }) guideChangeRequest?: {
    chiefGuideId?: string;
    chiefGuideName?: string;
    chiefGuideEmail?: string;
    reason?: string;
    status?: string;
    requestedBy?: string;
    requestedAt?: Date;
  };
}

export const ThesisFileSchema = SchemaFactory.createForClass(ThesisFile);
// Unique only after ACE assigns a number. Sparse+null still collides: Mongo treats
// multiple { thesisNumber: null } as duplicates, which blocks a second new file.
ThesisFileSchema.index(
  { instituteId: 1, thesisNumber: 1 },
  { unique: true, partialFilterExpression: { thesisNumber: { $type: 'string' } } },
);
ThesisFileSchema.index({ instituteId: 1, 'candidate.enrollmentNo': 1 });
ThesisFileSchema.plugin(auditPlugin);
