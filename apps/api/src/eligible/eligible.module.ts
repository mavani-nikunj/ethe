import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExamCandidate, ExamCandidateSchema } from '../database/exam-candidate.schema';
import {
  ExamPaper,
  ExamPaperSchema,
  ExamShift,
  ExamShiftSchema,
  ExamTimeSlot,
  ExamTimeSlotSchema,
} from '../database/exam-paper.schema';
import { ExamHall, ExamHallSchema } from '../database/exam-hall.schema';
import { SeatAllotment, SeatAllotmentSchema } from '../database/seat-allotment.schema';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import {
  AcademicSession,
  AcademicSessionSchema,
  Course,
  CourseSchema,
  Department,
  DepartmentSchema,
  Speciality,
  SpecialitySchema,
} from '../database/masters.schema';
import { EligibleService } from './eligible.service';
import { ExamPapersService } from './exam-papers.service';
import { ExamHallsService } from './exam-halls.service';
import { SeatAllotmentService } from './seat-allotment.service';
import { EligibleController } from './eligible.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExamCandidate.name, schema: ExamCandidateSchema },
      { name: ExamPaper.name, schema: ExamPaperSchema },
      { name: ExamShift.name, schema: ExamShiftSchema },
      { name: ExamTimeSlot.name, schema: ExamTimeSlotSchema },
      { name: ExamHall.name, schema: ExamHallSchema },
      { name: SeatAllotment.name, schema: SeatAllotmentSchema },
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
      { name: Course.name, schema: CourseSchema },
      { name: Speciality.name, schema: SpecialitySchema },
      { name: Department.name, schema: DepartmentSchema },
    ]),
  ],
  providers: [EligibleService, ExamPapersService, ExamHallsService, SeatAllotmentService],
  exports: [ExamPapersService, ExamHallsService],
  controllers: [EligibleController],
})
export class EligibleModule {}
