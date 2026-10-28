import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FileNumberPrefix, FileNumberPrefixSchema } from '../database/file-number.schema';
import { ThesisFile, ThesisFileSchema } from '../database/thesis-file.schema';
import { AcademicSession, AcademicSessionSchema } from '../database/masters.schema';
import { FileNumbersService } from './file-numbers.service';
import { FileNumbersController } from './file-numbers.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileNumberPrefix.name, schema: FileNumberPrefixSchema },
      { name: ThesisFile.name, schema: ThesisFileSchema },
      { name: AcademicSession.name, schema: AcademicSessionSchema },
    ]),
  ],
  providers: [FileNumbersService],
  controllers: [FileNumbersController],
  exports: [FileNumbersService],
})
export class FileNumbersModule {}
