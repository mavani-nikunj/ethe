import { existsSync, mkdirSync, readdirSync, statfsSync, unlinkSync } from 'fs';
import { appendFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';

/**
 * Date-wise error log files: <logs>/YYYY-MM-DD.txt (India date), one line per entry.
 * Writing never throws; if the disk refuses, entries only reach the console.
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO';

const IST_OFFSET_MS = 330 * 60 * 1000;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.txt$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** apps/api/logs whether the API runs from the repo root or from apps/api. Never under uploads (that folder is public). */
export function logRoot() {
  if (process.env.LOG_DIR) return resolve(process.env.LOG_DIR);
  const inApp = join(process.cwd(), 'apps', 'api');
  return resolve(existsSync(inApp) ? join(inApp, 'logs') : join(process.cwd(), 'logs'));
}

export function retentionDays() {
  const n = Number(process.env.LOG_RETENTION_DAYS || 90);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

function ist(d = new Date()) {
  const iso = new Date(d.getTime() + IST_OFFSET_MS).toISOString();
  return { day: iso.slice(0, 10), stamp: `${iso.slice(0, 10)} ${iso.slice(11, 23)} IST` };
}

export function todayIst() {
  return ist().day;
}

export function isLogDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

export function logFileFor(day: string) {
  return join(logRoot(), `${day}.txt`);
}

/** Short reference shown to users and written on every error line. */
export function newRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const SECRET_PATH = /\/(tasks|task|practical-task|practical-portal|supervisor-task)\/([A-Za-z0-9_-]{4})[A-Za-z0-9_-]{4,}/g;
const SECRET_QUERY = /([?&](?:token|otp|password|key|access_token|session)=)[^&\s]+/gi;
const SECRET_KV = /\b(password|passcode|otp|token|authorization|pan|ifsc|account|accountNumber|cheque)(["']?\s*[:=]\s*["']?)([^"',\s}&]+)/gi;
const BEARER = /\bBearer\s+[\w.~+/=-]+/g;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /\b([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const MOBILE = /(^|[^\w])(\+?91[\s-]?)?([6-9]\d)\d{3}[\s-]?\d(\d{4})(?!\w)/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;

/** Strip anything that must never reach a log file: link tokens, passcodes, bank details, contact details. */
export function mask(text: string) {
  return String(text)
    .replace(SECRET_PATH, '/$1/$2****')
    .replace(SECRET_QUERY, '$1****')
    .replace(BEARER, 'Bearer ****')
    .replace(JWT, '****')
    .replace(SECRET_KV, '$1$2****')
    .replace(EMAIL, '$1***@$2')
    .replace(MOBILE, '$1$3****$4')
    .replace(PAN, '**********')
    .replace(IFSC, '***********');
}

let dirReady = false;
let diskWarned = false;
let queue: Promise<void> = Promise.resolve();

function ensureDir() {
  if (dirReady) return;
  mkdirSync(logRoot(), { recursive: true });
  dirReady = true;
}

/** Append one entry. `detail` (e.g. a stack trace) goes on indented lines under it. */
export function writeLog(level: LogLevel, message: string, detail?: string) {
  const { day, stamp } = ist();
  const body = mask(message).replace(/\r?\n/g, ' ');
  const extra = detail
    ? '\n' +
      mask(detail)
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(0, 40)
        .map((l) => `    ${l.trim()}`)
        .join('\n')
    : '';
  const line = `${stamp} | ${level.padEnd(5)} | ${body}${extra}\n`;
  queue = queue
    .then(async () => {
      ensureDir();
      await appendFile(logFileFor(day), line, 'utf8');
    })
    .catch((err) => {
      dirReady = false;
      if (!diskWarned) {
        diskWarned = true;
        process.stderr.write(`[AppLog] could not write log file in ${logRoot()}: ${err?.message || err}\n`);
      }
    });
}

/** Delete day files older than the retention window. */
export function pruneOldLogs() {
  try {
    const root = logRoot();
    if (!existsSync(root)) return;
    const cutoff = ist(new Date(Date.now() - retentionDays() * DAY_MS)).day;
    for (const name of readdirSync(root)) {
      const m = name.match(FILE_RE);
      if (m && m[1] < cutoff) unlinkSync(join(root, name));
    }
  } catch {
    /* housekeeping only */
  }
}

/** Warn in the log when the upload disk is getting full (large thesis uploads). */
export function checkDiskSpace(dir: string, minFreeGb = Number(process.env.LOG_MIN_FREE_GB || 10)) {
  try {
    const s = statfsSync(dir);
    const freeGb = (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
    if (freeGb < minFreeGb) writeLog('WARN', `ref=- | DISK | Low disk space: ${freeGb.toFixed(1)} GB free under ${dir}`);
  } catch {
    /* statfs unsupported here */
  }
}

/** Day files present, newest first. */
export function listLogDays(): string[] {
  try {
    const root = logRoot();
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .map((n) => n.match(FILE_RE)?.[1])
      .filter((d): d is string => Boolean(d))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
