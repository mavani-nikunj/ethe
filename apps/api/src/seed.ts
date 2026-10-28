import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SeedService } from './seed/seed.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(SeedService).ensureSuperAdmin();
  await app.close();
}
run();
