import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { PlatformModule } from './platform/platform.module';
import { MastersModule } from './masters/masters.module';
import { BlueprintsModule } from './blueprints/blueprints.module';
import { FilesModule } from './files/files.module';
import { PanelModule } from './panel/panel.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { CommsModule } from './comms/comms.module';
import { FileNumbersModule } from './file-numbers/file-numbers.module';
import { ReportsModule } from './reports/reports.module';
import { TasksModule } from './tasks/tasks.module';
import { PracticalModule } from './practical/practical.module';
import { EligibleModule } from './eligible/eligible.module';
import { SupervisorModule } from './supervisor/supervisor.module';
import { StaffDutyModule } from './staff-duty/staff-duty.module';
import { SeedModule } from './seed/seed.module';
import { LogsModule } from './logs/logs.module';
import { AuditContextInterceptor } from './common/audit-context';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', 'apps/api/.env', '../../.env'] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI') || 'mongodb://127.0.0.1:27017/ethesis_platform',
      }),
    }),
    AuthModule,
    PlatformModule,
    MastersModule,
    BlueprintsModule,
    FilesModule,
    PanelModule,
    EvaluationModule,
    CommsModule,
    FileNumbersModule,
    ReportsModule,
    TasksModule,
    PracticalModule,
    EligibleModule,
    SupervisorModule,
    StaffDutyModule,
    SeedModule,
    LogsModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }],
})
export class AppModule {}
