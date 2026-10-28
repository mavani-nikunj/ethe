import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type InstituteDocument = HydratedDocument<Institute>;

@Schema({ timestamps: true })
export class Institute {
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) displayName: string;
  @Prop({ required: true, unique: true, uppercase: true }) code: string;
  @Prop({ required: true, enum: ['MEDICAL', 'UNIVERSITY', 'COLLEGE'] }) type: string;
  @Prop({ default: 'IN' }) country: string;
  @Prop() logoUrl?: string;
  @Prop({ default: '#0061f2' }) primaryColor: string;
  @Prop() supportEmail?: string;
  @Prop({ default: 'Asia/Kolkata' }) timezone: string;
  @Prop({ default: 'DD/MM/YYYY' }) dateFormat: string;
  @Prop({ default: 'DRAFT', enum: ['DRAFT', 'ACTIVE', 'SUSPENDED'] }) status: string;
  @Prop({ type: Object, default: {} }) plan: {
    seats?: number;
    validFrom?: Date;
    validTo?: Date;
    featureFlags?: string[];
  };
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy?: Types.ObjectId;
}

export const InstituteSchema = SchemaFactory.createForClass(Institute);
InstituteSchema.plugin(auditPlugin);
