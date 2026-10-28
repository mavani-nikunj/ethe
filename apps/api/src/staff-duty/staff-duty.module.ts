import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupervisorSchedule, SupervisorScheduleSchema, SupervisorSession, SupervisorSessionSchema } from '../database/supervisor.schema';
import {
  DutyAllotment,
  DutyAllotmentSchema,
  DutyRun,
  DutyRunSchema,
  DutySitting,
  DutySittingSchema,
  DutyStaff,
  DutyStaffMember,
  DutyStaffMemberSchema,
  DutyStaffSchema,
} from '../database/staff-duty.schema';
import { SupervisorModule } from '../supervisor/supervisor.module';
import { StaffDutyService } from './staff-duty.service';
import { StaffDutyController } from './staff-duty.controller';

@Module({
  imports: [
    SupervisorModule,
    MongooseModule.forFeature([
      { name: DutyStaff.name, schema: DutyStaffSchema },
      { name: DutyStaffMember.name, schema: DutyStaffMemberSchema },
      { name: DutySitting.name, schema: DutySittingSchema },
      { name: DutyAllotment.name, schema: DutyAllotmentSchema },
      { name: DutyRun.name, schema: DutyRunSchema },
      { name: SupervisorSession.name, schema: SupervisorSessionSchema },
      { name: SupervisorSchedule.name, schema: SupervisorScheduleSchema },
    ]),
  ],
  providers: [StaffDutyService],
  controllers: [StaffDutyController],
})
export class StaffDutyModule {}
