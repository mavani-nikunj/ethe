import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { BlueprintsService } from '../blueprints/blueprints.service';
import { Institute } from '../database/institute.schema';
import { UserRole } from '@ethesis/shared';
import { AuthUser } from '../common/current-user';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const institutes = app.get<Model<Institute>>(getModelToken(Institute.name));
  const blueprintSvc = app.get(BlueprintsService);
  const rows = await institutes.find().select('_id displayName code').lean();
  if (!rows.length) {
    console.log('No institutes found. Run reset:aiims first if you need a fresh AIIMS tenant.');
    await app.close();
    return;
  }
  for (const inst of rows) {
    const user: AuthUser = {
      userId: 'reseed',
      email: 'reseed@local',
      name: 'Blueprint reseed',
      role: UserRole.INSTITUTE_ADMIN,
      instituteId: String(inst._id),
    };
    const result = await blueprintSvc.seedDefaults(user);
    console.log(`Reseeded ${inst.displayName || inst.code}: ${result.updated.join(', ')}`);
  }
  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
