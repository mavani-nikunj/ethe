import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import { AcademicSession, AcademicSessionSchema } from '../database/masters.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
    ]),
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
