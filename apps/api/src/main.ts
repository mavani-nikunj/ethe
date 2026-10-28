import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync } from 'fs';
import { PRODUCT_NAME } from '@ethesis/shared';
import { AppModule } from './app.module';
import { SeedService } from './seed/seed.service';
import { originFromRequest, runWithRequestOrigin, webOrigin } from './common/web-origin';
import { FileLogger } from './common/file-logger';
import { LogExceptionsFilter, requestLogMiddleware } from './common/request-log';
import { checkDiskSpace, pruneOldLogs } from './common/app-log';

/** Thesis uploads can be up to 5 GB; Node's default 5-minute limit to receive a request would cut them off. */
const REQUEST_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const HOUSEKEEPING_MS = 6 * 60 * 60 * 1000;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new FileLogger() });
  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const resolvedUpload = existsSync(join(process.cwd(), uploadDir))
    ? join(process.cwd(), uploadDir)
    : existsSync(join(process.cwd(), 'apps', 'api', uploadDir))
    ? join(process.cwd(), 'apps', 'api', uploadDir)
    : join(process.cwd(), uploadDir);
  app.use(requestLogMiddleware);
  app.use((req, _res, next) => {
    runWithRequestOrigin(originFromRequest(req), () => next());
  });
  // uploads/private holds bank documents (supervisor cheques); they are only sent through the API.
  app.use(['/uploads/private', '/api/uploads/private'], (_req: any, res: any) => res.status(404).send('Not found'));
  app.useStaticAssets(resolvedUpload, { prefix: '/uploads/' });
  // Also under /api so a reverse proxy that only forwards /api still serves files.
  app.useStaticAssets(resolvedUpload, { prefix: '/api/uploads/' });
  // A missing upload gets a plain page instead of Nest's JSON 404.
  app.use(['/uploads/', '/api/uploads/'], (req: any, res: any, next: any) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res
      .status(404)
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>File not available</title></head>` +
          `<body style="margin:0;font-family:system-ui,sans-serif;background:#eff3f9;color:#1f2d41;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
          `<div style="background:#fff;border-radius:12px;padding:32px 28px;max-width:420px;margin:16px;text-align:center;box-shadow:0 4px 20px rgba(31,45,65,.08)">` +
          `<h1 style="font-size:20px;margin:0 0 8px">File not available</h1>` +
          `<p style="margin:0;color:#5b6b82;line-height:1.5">This document could not be found. It may have been replaced or removed. Please contact the Examination Section if you need it.</p>` +
          `</div></body></html>`,
      );
  });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new LogExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
  app.getHttpServer().requestTimeout = REQUEST_TIMEOUT_MS;
  const housekeeping = () => {
    pruneOldLogs();
    checkDiskSpace(resolvedUpload);
  };
  housekeeping();
  setInterval(housekeeping, HOUSEKEEPING_MS).unref();
  await app.get(SeedService).ensureSuperAdmin();
  const port = Number(process.env.PORT || 4000);
  const http = app.getHttpAdapter().getInstance();
  http.get('/', (req: any, res: any) => res.redirect(302, `${originFromRequest(req) || webOrigin()}/login`));
  http.get('/health', (req: any, res: any) => {
    const origin = originFromRequest(req) || webOrigin();
    res.json({ ok: true, api: `${origin}/api`, web: `${origin}/login` });
  });
  await app.listen(port, '0.0.0.0');
  console.log(`${PRODUCT_NAME} API http://localhost:${port}/api`);
}
bootstrap();
