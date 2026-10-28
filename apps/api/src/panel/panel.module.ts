import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import { Blueprint, BlueprintSchema } from '../database/blueprint.schema';
import { TaskToken, TaskTokenSchema } from '../database/comms.schema';
import { Department, DepartmentSchema, ExaminerPool, ExaminerPoolSchema, Faculty, FacultySchema } from '../database/masters.schema';
import { Institute, InstituteSchema } from '../database/institute.schema';
import { User, UserSchema } from '../database/user.schema';
import { PanelService } from './panel.service';
import { PanelBulkController, PanelController } from './panel.controller';
import { ExaminerConsentsController } from './examiner-consents.controller';
import { ExaminerConsentsService } from './examiner-consents.service';
import { AcceptedEvaluationsController } from './accepted-evaluations.controller';
import { AcceptedEvaluationsService } from './accepted-evaluations.service';
import { FilesModule } from '../files/files.module';
import { MailerService } from '../common/mailer.service';
import { CommsModule } from '../comms/comms.module';

@Module({
  imports: [
    FilesModule,
    CommsModule,
    MongooseModule.forFeature([
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: Blueprint.name, schema: BlueprintSchema },
      { name: TaskToken.name, schema: TaskTokenSchema },
      { name: ExaminerPool.name, schema: ExaminerPoolSchema },
      { name: Faculty.name, schema: FacultySchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Institute.name, schema: InstituteSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [PanelService, ExaminerConsentsService, AcceptedEvaluationsService, MailerService],
  controllers: [PanelBulkController, PanelController, ExaminerConsentsController, AcceptedEvaluationsController],
  exports: [PanelService],
})
export class PanelModule {}
