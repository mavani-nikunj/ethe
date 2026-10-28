import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PracticalExaminer,
  PracticalExaminerSchema,
  PracticalExaminerDetail,
  PracticalExaminerDetailSchema,
  PracticalLookup,
  PracticalLookupSchema,
  PracticalSchedule,
  PracticalScheduleSchema,
  PracticalToken,
  PracticalTokenSchema,
  PracticalDocument,
  PracticalDocumentSchema,
  TravelAgent,
  TravelAgentSchema,
} from '../database/practical.schema';
import {
  AcademicSession,
  AcademicSessionSchema,
  Course,
  CourseSchema,
  Department,
  DepartmentSchema,
  ExaminerPool,
  ExaminerPoolSchema,
  ExamType,
  ExamTypeSchema,
  Faculty,
  FacultySchema,
  Speciality,
  SpecialitySchema,
} from '../database/masters.schema';
import { User, UserSchema } from '../database/user.schema';
import { Institute, InstituteSchema } from '../database/institute.schema';
import { CommTemplate, CommTemplateSchema, OutboundMessage, OutboundMessageSchema } from '../database/comms.schema';
import { MailerService } from '../common/mailer.service';
import { FileNumbersModule } from '../file-numbers/file-numbers.module';
import { PracticalService } from './practical.service';
import { PracticalController } from './practical.controller';
import { PracticalMailService } from './practical-mail.service';
import { PracticalTaskService } from './practical-task.service';
import { PracticalTaskController } from './practical-task.controller';
import { TravelService } from './travel.service';
import { TravelController } from './travel.controller';

@Module({
  imports: [
    FileNumbersModule,
    MongooseModule.forFeature([
      { name: PracticalSchedule.name, schema: PracticalScheduleSchema },
      { name: PracticalExaminer.name, schema: PracticalExaminerSchema },
      { name: PracticalExaminerDetail.name, schema: PracticalExaminerDetailSchema },
      { name: PracticalLookup.name, schema: PracticalLookupSchema },
      { name: PracticalToken.name, schema: PracticalTokenSchema },
      { name: PracticalDocument.name, schema: PracticalDocumentSchema },
      { name: TravelAgent.name, schema: TravelAgentSchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Speciality.name, schema: SpecialitySchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Faculty.name, schema: FacultySchema },
      { name: ExaminerPool.name, schema: ExaminerPoolSchema },
      { name: ExamType.name, schema: ExamTypeSchema },
      { name: User.name, schema: UserSchema },
      { name: Institute.name, schema: InstituteSchema },
      { name: CommTemplate.name, schema: CommTemplateSchema },
      { name: OutboundMessage.name, schema: OutboundMessageSchema },
    ]),
  ],
  providers: [PracticalService, PracticalMailService, PracticalTaskService, TravelService, MailerService],
  controllers: [PracticalController, PracticalTaskController, TravelController],
  exports: [PracticalService],
})
export class PracticalModule {}
