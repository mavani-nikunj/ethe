import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TaskToken, TaskTokenSchema } from '../database/comms.schema';
import { Institute, InstituteSchema } from '../database/institute.schema';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import { Blueprint, BlueprintSchema } from '../database/blueprint.schema';
import {
  Course,
  CourseSchema,
  CourseType,
  CourseTypeSchema,
  Speciality,
  SpecialitySchema,
} from '../database/masters.schema';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { PanelModule } from '../panel/panel.module';
import { FilesModule } from '../files/files.module';
import { CommsModule } from '../comms/comms.module';
import { MailerService } from '../common/mailer.service';

@Module({
  imports: [
    EvaluationModule,
    PanelModule,
    FilesModule,
    CommsModule,
    MongooseModule.forFeature([
      { name: TaskToken.name, schema: TaskTokenSchema },
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: Institute.name, schema: InstituteSchema },
      { name: Blueprint.name, schema: BlueprintSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseType.name, schema: CourseTypeSchema },
      { name: Speciality.name, schema: SpecialitySchema },
    ]),
  ],
  providers: [TasksService, MailerService],
  controllers: [TasksController],
})
export class TasksModule {}
