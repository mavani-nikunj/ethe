import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type CommTemplateDocument = HydratedDocument<CommTemplate>;

@Schema({ timestamps: true })
export class CommTemplate {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop({ required: true, enum: ['EMAIL', 'LETTER', 'SMS'] }) channel: string;
  @Prop() subject?: string;
  @Prop({ required: true }) body: string;
  @Prop() stageCode?: string;
  @Prop() purpose?: string;
  @Prop({ default: true }) active: boolean;
}

export const CommTemplateSchema = SchemaFactory.createForClass(CommTemplate);
CommTemplateSchema.plugin(auditPlugin);

export type OutboundMessageDocument = HydratedDocument<OutboundMessage>;

@Schema({ timestamps: true })
export class OutboundMessage {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'ThesisFile' }) fileId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'PracticalExaminer', index: true }) practicalExaminerId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SupervisorAppointment', index: true }) supervisorAppointmentId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'CommTemplate' }) templateId?: Types.ObjectId;
  @Prop({ required: true }) channel: string;
  @Prop() to?: string;
  @Prop() toName?: string;
  @Prop() subject?: string;
  @Prop({ required: true }) body: string;
  @Prop() purpose?: string;
  @Prop({ default: 'SENT' }) status: string;
}

export const OutboundMessageSchema = SchemaFactory.createForClass(OutboundMessage);
OutboundMessageSchema.plugin(auditPlugin);

export type ReminderDocument = HydratedDocument<Reminder>;

@Schema({ timestamps: true })
export class Reminder {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() stageCode?: string;
  @Prop({ default: 3 }) afterDays: number;
  @Prop({ type: Types.ObjectId, ref: 'CommTemplate' }) templateId?: Types.ObjectId;
  @Prop({ default: true }) active: boolean;
}

export const ReminderSchema = SchemaFactory.createForClass(Reminder);
ReminderSchema.plugin(auditPlugin);

export type TaskTokenDocument = HydratedDocument<TaskToken>;

@Schema({ timestamps: true })
export class TaskToken {
  @Prop({ required: true, unique: true }) token: string;
  @Prop({ type: Types.ObjectId, required: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'ThesisFile', required: true }) fileId: Types.ObjectId;
  @Prop({ required: true }) purpose: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() name?: string;
  @Prop() otpHash?: string;
  @Prop() otpExpiresAt?: Date;
  @Prop() otpRequestedAt?: Date;
  @Prop({ default: false }) verified: boolean;
  @Prop() panelIndex?: number;
  @Prop() expiresAt?: Date;
}

export const TaskTokenSchema = SchemaFactory.createForClass(TaskToken);
TaskTokenSchema.plugin(auditPlugin);
