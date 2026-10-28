import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Institute, InstituteSchema } from '../database/institute.schema';
import { User, UserSchema } from '../database/user.schema';
import { AuditLog, AuditLogSchema } from '../database/audit-log.schema';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Institute.name, schema: InstituteSchema },
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [PlatformService],
  controllers: [PlatformController],
})
export class PlatformModule {}
