import { NotFoundException } from '@nestjs/common';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, resolve, sep } from 'path';
import { uploadRoot } from '../practical/practical-files';

/** Cheques hold bank data, so they live under uploads/private, which main.ts never serves. */
export const CHEQUE_FOLDER = 'private/supervisor-cheques';
export const CHEQUE_PATTERN = /\.(jpe?g|png|pdf)$/i;

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };

export async function readCheque(relPath: string, name: string) {
  const abs = resolve(uploadRoot(), relPath);
  if (!abs.startsWith(resolve(uploadRoot()) + sep) || !existsSync(abs)) throw new NotFoundException('Cancelled cheque not uploaded!');
  const mime = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
  const data = await readFile(abs);
  return { name, mime, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
}
