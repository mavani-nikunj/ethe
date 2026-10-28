import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Blueprint, BlueprintSchema } from '../database/blueprint.schema';
import { Course, CourseSchema, CourseType, CourseTypeSchema } from '../database/masters.schema';
import { BlueprintsService } from './blueprints.service';
import { BlueprintsController } from './blueprints.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Blueprint.name, schema: BlueprintSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseType.name, schema: CourseTypeSchema },
    ]),
  ],
  providers: [BlueprintsService],
  controllers: [BlueprintsController],
  exports: [BlueprintsService],
})
export class BlueprintsModule {}
