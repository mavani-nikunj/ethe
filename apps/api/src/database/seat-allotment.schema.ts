import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

/**
 * Seat allotment for one exam date + shift (old tblSeatAllotmentMaster / tblSeatAllotmentDetails).
 * One per institute, not per Dealing user (old bug: two users could double-book the same seats).
 * Placements keep a snapshot of the candidate so a locked allotment reads the same later.
 */
export const SeatingMode = { CONTINUOUS: 'CONTINUOUS', ODD: 'ODD', EVEN: 'EVEN' } as const;

export type AllotmentSeat = { hallId: Types.ObjectId; hallName: string; row: number; seatNo: number; active: boolean };

export type AllotmentPlacement = {
  hallId: Types.ObjectId;
  hallName: string;
  row: number;
  seatNo: number;
  examCandidateId: Types.ObjectId;
  paperId: Types.ObjectId;
  enrollmentNo: string;
  name: string;
  courseName: string;
  specialityName: string;
  paper: string;
};

export type SeatAllotmentDocument = HydratedDocument<SeatAllotment>;
@Schema({ timestamps: true, collection: 'seat_allotments' })
export class SeatAllotment {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AcademicSession', required: true }) sessionId: Types.ObjectId;
  /** YYYY-MM-DD, as on ExamPaper. */
  @Prop({ required: true }) examDate: string;
  @Prop({ type: Types.ObjectId, ref: 'ExamShift', required: true }) shiftId: Types.ObjectId;
  @Prop() mode?: string;
  @Prop() startSeat?: number;
  @Prop({ type: Array, default: [] }) seats: AllotmentSeat[];
  /** Manual seat switches on top of the seating mode, keyed "hallId:seatNo". Cleared when the mode changes. */
  @Prop({ type: Object, default: {} }) overrides: Record<string, boolean>;
  @Prop({ type: Array, default: [] }) placements: AllotmentPlacement[];
  @Prop() processedAt?: Date;
  @Prop({ default: false, index: true }) locked: boolean;
  @Prop({ type: Object }) lockedBy?: { userId?: string; name?: string; at?: Date };
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
}
export const SeatAllotmentSchema = SchemaFactory.createForClass(SeatAllotment);
SeatAllotmentSchema.index({ instituteId: 1, examDate: 1, shiftId: 1 }, { unique: true });
SeatAllotmentSchema.plugin(auditPlugin);
