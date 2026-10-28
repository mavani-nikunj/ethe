import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SupervisorAppointment,
  SupervisorAppointmentSchema,
  SupervisorLookup,
  SupervisorLookupSchema,
  SupervisorPerson,
  SupervisorPersonSchema,
  SupervisorSchedule,
  SupervisorScheduleSchema,
  SupervisorSession,
  SupervisorSessionSchema,
  SupervisorToken,
  SupervisorTokenSchema,
} from '../database/supervisor.schema';
import { Course, CourseSchema, Department, DepartmentSchema, Speciality, SpecialitySchema } from '../database/masters.schema';
import { ExamPaper, ExamPaperSchema, ExamShift, ExamShiftSchema } from '../database/exam-paper.schema';
import { ExamCandidate, ExamCandidateSchema } from '../database/exam-candidate.schema';
import { User, UserSchema } from '../database/user.schema';
import { Institute, InstituteSchema } from '../database/institute.schema';
import { CommTemplate, CommTemplateSchema, OutboundMessage, OutboundMessageSchema } from '../database/comms.schema';
import { DutyAllotment, DutyAllotmentSchema, DutySitting, DutySittingSchema, DutyStaffMember, DutyStaffMemberSchema } from '../database/staff-duty.schema';
import { MailerService } from '../common/mailer.service';
import { SupervisorService } from './supervisor.service';
import { SupervisorMailService } from './supervisor-mail.service';
import { SupervisorTaskService } from './supervisor-task.service';
import { SupervisorController } from './supervisor.controller';
import { SupervisorTaskController } from './supervisor-task.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupervisorSession.name, schema: SupervisorSessionSchema },
      { name: SupervisorLookup.name, schema: SupervisorLookupSchema },
      { name: SupervisorSchedule.name, schema: SupervisorScheduleSchema },
      { name: SupervisorPerson.name, schema: SupervisorPersonSchema },
      { name: SupervisorAppointment.name, schema: SupervisorAppointmentSchema },
      { name: SupervisorToken.name, schema: SupervisorTokenSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Speciality.name, schema: SpecialitySchema },
      { name: ExamPaper.name, schema: ExamPaperSchema },
      { name: ExamShift.name, schema: ExamShiftSchema },
      { name: ExamCandidate.name, schema: ExamCandidateSchema },
      { name: User.name, schema: UserSchema },
      { name: Institute.name, schema: InstituteSchema },
      { name: CommTemplate.name, schema: CommTemplateSchema },
      { name: OutboundMessage.name, schema: OutboundMessageSchema },
      // Staff Duty reads the schedule: guard delete / move of a sitting it uses.
      { name: DutySitting.name, schema: DutySittingSchema },
      { name: DutyAllotment.name, schema: DutyAllotmentSchema },
      { name: DutyStaffMember.name, schema: DutyStaffMemberSchema },
    ]),
  ],
  providers: [SupervisorService, SupervisorMailService, SupervisorTaskService, MailerService],
  controllers: [SupervisorController, SupervisorTaskController],
  exports: [SupervisorService],
})
export class SupervisorModule {}
