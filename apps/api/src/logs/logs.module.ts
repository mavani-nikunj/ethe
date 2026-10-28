import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from '../database/audit-log.schema';
import { LogsService } from './logs.service';
import { ClientLogsController, PlatformLogsController } from './logs.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [LogsService],
  controllers: [ClientLogsController, PlatformLogsController],
})
export class LogsModule {}
