import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Theory paper schedule of a session (old tblVenue, entered from "Add Venue"), with its shift and
 * time-slot lookups (old tblShift / tblTimeSlot). Staff Duty and Seat Allotment read these later.
 */

export type ExamShiftDocument = HydratedDocument<ExamShift>;
@Schema({ timestamps: true, collection: 'exam_shifts' })
export class ExamShift {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
}
export const ExamShiftSchema = SchemaFactory.createForClass(ExamShift);
ExamShiftSchema.index({ instituteId: 1, name: 1 }, { unique: true });
ExamShiftSchema.plugin(auditPlugin);

export type ExamTimeSlotDocument = HydratedDocument<ExamTimeSlot>;
@Schema({ timestamps: true, collection: 'exam_time_slots' })
export class ExamTimeSlot {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
}
export const ExamTimeSlotSchema = SchemaFactory.createForClass(ExamTimeSlot);
ExamTimeSlotSchema.index({ instituteId: 1, name: 1 }, { unique: true });
ExamTimeSlotSchema.plugin(auditPlugin);

export type ExamPaperDocument = HydratedDocument<ExamPaper>;
@Schema({ timestamps: true, collection: 'exam_papers' })
export class ExamPaper {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession', required: true, index: true }) sessionId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course', required: true }) courseId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Speciality', required: true }) specialityId: Types.ObjectId;
  @Prop({ required: true, trim: true }) paper: string;
  /** YYYY-MM-DD (old VenueDate was dd/mm/yyyy text). */
  @Prop({ required: true, index: true }) examDate: string;
  @Prop({ type: Types.ObjectId, ref: 'ExamShift', required: true }) shiftId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'ExamTimeSlot', required: true }) timeSlotId: Types.ObjectId;
  @Prop({ required: true, trim: true }) venue: string;
  @Prop({ required: true }) fees: number;
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
}
export const ExamPaperSchema = SchemaFactory.createForClass(ExamPaper);
ExamPaperSchema.index({ instituteId: 1, sessionId: 1, specialityId: 1, paper: 1 }, { unique: true });
ExamPaperSchema.plugin(auditPlugin);
