import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, lowercase: true, unique: true }) email: string;
  @Prop({ required: true }) passwordHash: string;
  @Prop({ required: true }) name: string;
  @Prop() mobile?: string;
  @Prop({ required: true }) role: string;
  @Prop({ type: Types.ObjectId, ref: 'Institute', default: null }) instituteId: Types.ObjectId | null;
  @Prop({ default: 'INVITED' }) status: string;
  @Prop({ default: false }) mustChangePassword: boolean;
  @Prop() tempPassword?: string;
  @Prop() lastLoginAt?: Date;
  @Prop() designation?: string;
  @Prop() authoritySlot?: string;
  @Prop({ type: [Types.ObjectId], default: [] }) departmentIds: Types.ObjectId[];
  @Prop({ type: [Types.ObjectId], default: [] }) courseIds: Types.ObjectId[];
  /** Scanned signature printed on letters (Associate Dean). Path under uploads/. */
  @Prop() signaturePath?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.plugin(auditPlugin);
