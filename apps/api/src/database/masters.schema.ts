import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { auditPlugin } from '../common/audit.plugin';

export type DepartmentDocument = HydratedDocument<Department>;
@Schema({ timestamps: true })
export class Department {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() code?: string;
  @Prop({ default: true }) active: boolean;
}
export const DepartmentSchema = SchemaFactory.createForClass(Department);
DepartmentSchema.index({ instituteId: 1, name: 1 }, { unique: true });
DepartmentSchema.plugin(auditPlugin);

export type CourseTypeDocument = HydratedDocument<CourseType>;
@Schema({ timestamps: true })
export class CourseType {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() code?: string;
  @Prop({ type: Types.ObjectId, ref: 'Blueprint' }) blueprintId?: Types.ObjectId;
}
export const CourseTypeSchema = SchemaFactory.createForClass(CourseType);
CourseTypeSchema.plugin(auditPlugin);

export type CourseDocument = HydratedDocument<Course>;
@Schema({ timestamps: true })
export class Course {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'CourseType', required: true }) courseTypeId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Department' }) departmentId?: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop() code?: string;
  @Prop({ default: true }) active: boolean;
}
export const CourseSchema = SchemaFactory.createForClass(Course);
CourseSchema.plugin(auditPlugin);

export type SpecialityDocument = HydratedDocument<Speciality>;
@Schema({ timestamps: true })
export class Speciality {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Course' }) courseId?: Types.ObjectId;
  @Prop({ required: true }) name: string;
}
export const SpecialitySchema = SchemaFactory.createForClass(Speciality);
SpecialitySchema.plugin(auditPlugin);

export type SessionDocument = HydratedDocument<AcademicSession>;
@Schema({ timestamps: true })
export class AcademicSession {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) month: string;
  @Prop({ required: true }) year: number;
  @Prop({ default: false }) current: boolean;
}
export const AcademicSessionSchema = SchemaFactory.createForClass(AcademicSession);
AcademicSessionSchema.index({ instituteId: 1, month: 1, year: 1 }, { unique: true });
AcademicSessionSchema.plugin(auditPlugin);

export type GeoBucketDocument = HydratedDocument<GeoBucket>;
@Schema({ timestamps: true })
export class GeoBucket {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) code: string;
  @Prop({ required: true }) label: string;
  @Prop({ type: Types.ObjectId, ref: 'CourseType' }) courseTypeId?: Types.ObjectId;
  @Prop() group?: string;
}
export const GeoBucketSchema = SchemaFactory.createForClass(GeoBucket);
GeoBucketSchema.plugin(auditPlugin);

export type RoleLabelDocument = HydratedDocument<RoleLabel>;
@Schema({ timestamps: true })
export class RoleLabel {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) systemRole: string;
  @Prop({ required: true }) code: string;
  @Prop({ required: true }) label: string;
}
export const RoleLabelSchema = SchemaFactory.createForClass(RoleLabel);
RoleLabelSchema.plugin(auditPlugin);

export type FacultyDocument = HydratedDocument<Faculty>;
@Schema({ timestamps: true })
export class Faculty {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() mobile?: string;
  @Prop() alternateMobile?: string;
  @Prop() alternateEmail?: string;
  @Prop() designation?: string;
  @Prop() employeeId?: string;
  @Prop() qualification?: string;
  @Prop() specialization?: string;
  @Prop() affiliation?: string;
  @Prop() registrationNo?: string;
  @Prop() city?: string;
  @Prop({ type: Types.ObjectId, ref: 'Department' }) departmentId?: Types.ObjectId;
  @Prop({ type: [Types.ObjectId], ref: 'Course', default: [] }) courseIds?: Types.ObjectId[];
  @Prop({ default: true }) canGuide: boolean;
}
export const FacultySchema = SchemaFactory.createForClass(Faculty);
FacultySchema.plugin(auditPlugin);

export type ExaminerPoolDocument = HydratedDocument<ExaminerPool>;
@Schema({ timestamps: true })
export class ExaminerPool {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop({ required: true, lowercase: true }) email: string;
  @Prop() mobile?: string;
  @Prop() designation?: string;
  @Prop() department?: string;
  @Prop() affiliation?: string;
  @Prop() address?: string;
  @Prop() city?: string;
  @Prop() country?: string;
  @Prop() bucketCode?: string;
}
export const ExaminerPoolSchema = SchemaFactory.createForClass(ExaminerPool);
ExaminerPoolSchema.plugin(auditPlugin);

export type ExamTypeDocument = HydratedDocument<ExamType>;
@Schema({ timestamps: true })
export class ExamType {
  @Prop({ type: Types.ObjectId, required: true, index: true }) instituteId: Types.ObjectId;
  @Prop({ required: true }) name: string;
}
export const ExamTypeSchema = SchemaFactory.createForClass(ExamType);
ExamTypeSchema.index({ instituteId: 1, name: 1 }, { unique: true });
ExamTypeSchema.plugin(auditPlugin);
