import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Exam hall with its seats (old tblHallMaster + tblHallDetails). Shared by the whole institute
 * (the old halls were per Dealing user; plan §8 Q3). Seat numbers are unique within a hall.
 */
export type ExamHallSeat = { row: number; seatNo: number; active: boolean };

export type ExamHallDocument = HydratedDocument<ExamHall>;
@Schema({ timestamps: true, collection: 'exam_halls' })
export class ExamHall {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ type: [{ row: Number, seatNo: Number, active: Boolean, _id: false }], default: [] }) seats: ExamHallSeat[];
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
}
export const ExamHallSchema = SchemaFactory.createForClass(ExamHall);
ExamHallSchema.index({ instituteId: 1, name: 1 }, { unique: true });
ExamHallSchema.plugin(auditPlugin);
