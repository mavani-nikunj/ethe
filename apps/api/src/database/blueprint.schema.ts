import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type BlueprintStage = {
  code: string;
  name: string;
  type: string;
  actorRole: string;
  authoritySlot?: string;
  next?: string;
  nextOnHold?: string;
  nextOnReject?: string;
  waitAccepted?: number;
  nthBucketCode?: string;
  evaluationRound?: number;
  letterKind?: string;
};

export type BlueprintDocument = HydratedDocument<Blueprint>;

@Schema({ timestamps: true })
export class Blueprint {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() code?: string;
  @Prop() description?: string;
  @Prop({ type: Array, default: [] }) stages: BlueprintStage[];
  @Prop({ type: Object, default: { maxCoGuides: 0, minCoGuides: 0 } }) guidePolicy: { maxCoGuides: number; minCoGuides?: number };
  @Prop({ type: Object, default: { buckets: [] } }) panelRule: {
    buckets: { code: string; label: string; count: number }[];
  };
  @Prop({ default: 'DEALING' }) revisionOwnerRole: string;
  @Prop({ type: Object, default: {} }) flags: {
    resultHoldRelease?: boolean;
    remuneration?: boolean;
    remunerationAmount?: number;
  };
  @Prop({ default: false }) isSystemSeed: boolean;
}

export const BlueprintSchema = SchemaFactory.createForClass(Blueprint);
BlueprintSchema.plugin(auditPlugin);
