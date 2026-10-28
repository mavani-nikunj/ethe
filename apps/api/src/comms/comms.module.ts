import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CommTemplate,
  CommTemplateSchema,
  OutboundMessage,
  OutboundMessageSchema,
  Reminder,
  ReminderSchema,
} from '../database/comms.schema';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import { Institute, InstituteSchema } from '../database/institute.schema';
import { User, UserSchema } from '../database/user.schema';
import {
  AcademicSession,
  AcademicSessionSchema,
  Course,
  CourseSchema,
  CourseType,
  CourseTypeSchema,
  Department,
  DepartmentSchema,
  Speciality,
  SpecialitySchema,
} from '../database/masters.schema';
import { CommsService } from './comms.service';
import { CommsController } from './comms.controller';
import { MailerService } from '../common/mailer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CommTemplate.name, schema: CommTemplateSchema },
      { name: OutboundMessage.name, schema: OutboundMessageSchema },
      { name: Reminder.name, schema: ReminderSchema },
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: Institute.name, schema: InstituteSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseType.name, schema: CourseTypeSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Speciality.name, schema: SpecialitySchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [CommsService, MailerService],
  controllers: [CommsController],
  exports: [CommsService],
})
export class CommsModule {}
