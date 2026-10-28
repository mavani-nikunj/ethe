import { BadRequestException, NotFoundException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { extname, join, resolve, sep } from 'path';
import { randomBytes } from 'crypto';
import type { Response } from 'express';

/** Same resolution as main.ts so stored paths match what /uploads serves. */
export function uploadRoot() {
  const dir = process.env.UPLOAD_DIR || 'uploads';
  if (existsSync(join(process.cwd(), dir))) return join(process.cwd(), dir);
  if (existsSync(join(process.cwd(), 'apps', 'api', dir))) return join(process.cwd(), 'apps', 'api', dir);
  return join(process.cwd(), dir);
}

/** Multer options storing into uploads/<folder>/<random>.<ext>, filtered by extension. */
export function practicalUpload(folder: string, pattern: RegExp, what: string, maxMb = 10) {
  return {
    limits: { fileSize: maxMb * 1024 * 1024 },
    storage: diskStorage({
      destination: (_req, _f, cb) => {
        const target = join(uploadRoot(), folder);
        if (!existsSync(target)) mkdirSync(target, { recursive: true });
        cb(null, target);
      },
      filename: (_r, file, cb) => cb(null, `${randomBytes(16).toString('hex')}${extname(file.originalname).toLowerCase()}`),
    }),
    fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
      const ok = pattern.test(file.originalname);
      cb(ok ? null : new BadRequestException(what), ok);
    },
  };
}

export async function removeUpload(relPath?: string | null) {
  if (!relPath) return;
  const abs = resolve(uploadRoot(), relPath);
  if (!abs.startsWith(resolve(uploadRoot()) + sep)) return;
  await unlink(abs).catch(() => undefined);
}

/** Send a stored upload as a download/inline file. */
export function sendUpload(res: Response, relPath: string, originalName: string) {
  const abs = resolve(uploadRoot(), relPath);
  if (!abs.startsWith(resolve(uploadRoot()) + sep) || !existsSync(abs)) throw new NotFoundException('File not found');
  res.setHeader('Content-Disposition', `inline; filename="${originalName.replace(/["\r\n]/g, '')}"`);
  res.sendFile(abs);
}
