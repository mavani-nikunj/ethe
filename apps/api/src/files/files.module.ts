import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import { Blueprint, BlueprintSchema } from '../database/blueprint.schema';
import {
  Course,
  CourseSchema,
  CourseType,
  CourseTypeSchema,
  Department,
  DepartmentSchema,
  Faculty,
  FacultySchema,
  AcademicSession,
  AcademicSessionSchema,
  Speciality,
  SpecialitySchema,
} from '../database/masters.schema';
import { TaskToken, TaskTokenSchema } from '../database/comms.schema';
import { AuditLog, AuditLogSchema } from '../database/audit-log.schema';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { WorkflowService } from './workflow.service';
import { MailerService } from '../common/mailer.service';
import { CommsModule } from '../comms/comms.module';
import { FileNumbersModule } from '../file-numbers/file-numbers.module';

@Module({
  imports: [
    CommsModule,
    FileNumbersModule,
    MongooseModule.forFeature([
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: Blueprint.name, schema: BlueprintSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseType.name, schema: CourseTypeSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Faculty.name, schema: FacultySchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
      { name: Speciality.name, schema: SpecialitySchema },
      { name: TaskToken.name, schema: TaskTokenSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [FilesService, WorkflowService, MailerService],
  controllers: [FilesController],
  exports: [FilesService, WorkflowService],
})
export class FilesModule {}
