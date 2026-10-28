import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../database/user.schema';
import { SeedService } from './seed.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
