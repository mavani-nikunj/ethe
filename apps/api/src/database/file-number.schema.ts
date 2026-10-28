import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type FileNumberPrefixDocument = HydratedDocument<FileNumberPrefix>;

@Schema({ timestamps: true, collection: 'file_number_prefixes' })
export class FileNumberPrefix {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) month: string;
  @Prop({ required: true }) year: number;
  @Prop({ required: true }) fileNumber: string;
}

export const FileNumberPrefixSchema = SchemaFactory.createForClass(FileNumberPrefix);
FileNumberPrefixSchema.index({ instituteId: 1, month: 1, year: 1 }, { unique: true });
FileNumberPrefixSchema.plugin(auditPlugin);
