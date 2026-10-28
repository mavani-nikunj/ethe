import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Department,
  DepartmentSchema,
  CourseType,
  CourseTypeSchema,
  Course,
  CourseSchema,
  Speciality,
  SpecialitySchema,
  AcademicSession,
  AcademicSessionSchema,
  GeoBucket,
  GeoBucketSchema,
  RoleLabel,
  RoleLabelSchema,
  Faculty,
  FacultySchema,
  ExaminerPool,
  ExaminerPoolSchema,
  ExamType,
  ExamTypeSchema,
} from '../database/masters.schema';
import { User, UserSchema } from '../database/user.schema';
import { Blueprint, BlueprintSchema } from '../database/blueprint.schema';
import { MastersService } from './masters.service';
import { MastersController } from './masters.controller';
import { MailerService } from '../common/mailer.service';
import { CommsModule } from '../comms/comms.module';

@Module({
  imports: [
    CommsModule,
    MongooseModule.forFeature([
      { name: Department.name, schema: DepartmentSchema },
      { name: CourseType.name, schema: CourseTypeSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Speciality.name, schema: SpecialitySchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
      { name: GeoBucket.name, schema: GeoBucketSchema },
      { name: RoleLabel.name, schema: RoleLabelSchema },
      { name: Faculty.name, schema: FacultySchema },
      { name: ExaminerPool.name, schema: ExaminerPoolSchema },
      { name: ExamType.name, schema: ExamTypeSchema },
      { name: User.name, schema: UserSchema },
      { name: Blueprint.name, schema: BlueprintSchema },
    ]),
  ],
  providers: [MastersService, MailerService],
  controllers: [MastersController],
  exports: [MastersService],
})
export class MastersModule {}
