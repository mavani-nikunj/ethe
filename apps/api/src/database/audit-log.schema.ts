import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'User' }) actorUserId?: Types.ObjectId;
  @Prop() actorEmail?: string;
  @Prop() actorName?: string;
  @Prop() table?: string;
  @Prop() operation?: string;
  @Prop({ type: Types.ObjectId }) recordId?: Types.ObjectId;
  @Prop({ type: Object }) before?: Record<string, unknown>;
  @Prop({ type: Object }) after?: Record<string, unknown>;
  /** Legacy platform rows keep this; plugin rows use table.operation */
  @Prop() action?: string;
  @Prop({ type: Types.ObjectId, ref: 'Institute' }) instituteId?: Types.ObjectId;
  @Prop({ type: Object, default: {} }) meta: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ instituteId: 1, createdAt: -1 });
AuditLogSchema.index({ table: 1, recordId: 1, createdAt: -1 });
