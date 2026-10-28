import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { AuditLog } from '../database/audit-log.schema';
import { AuthUser } from '../common/current-user';
import { isLogDay, listLogDays, logFileFor, logRoot, retentionDays, writeLog } from '../common/app-log';
import { deviceOf } from '../common/request-log';

export type LogEntry = {
  time: string;
  level: string;
  ref: string;
  text: string;
  detail?: string;
};

const HEAD = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} IST) \| (\w+)\s*\| (.*)$/;
const MAX_ENTRIES = 5000;
const CLIENT_LIMIT_PER_MIN = 20;

function clip(v: unknown, max: number) {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

@Injectable()
export class LogsService {
  private clientHits = new Map<string, { at: number; n: number }>();

  constructor(@InjectModel(AuditLog.name) private audit: Model<AuditLog>) {}

  /** Error reports from browsers (page crashes, failed submissions). Logging only; nothing is stored in the database. */
  recordClient(body: any, ip: string, ua?: string) {
    const now = Date.now();
    const hit = this.clientHits.get(ip);
    if (hit && now - hit.at < 60_000) {
      if (++hit.n > CLIENT_LIMIT_PER_MIN) return { ok: true };
    } else {
      this.clientHits.set(ip, { at: now, n: 1 });
      if (this.clientHits.size > 5000) this.clientHits.clear();
    }
    const kind = clip(body?.kind, 20) || 'error';
    const ref = /^[A-Z0-9]{4,12}$/.test(String(body?.ref || '')) ? String(body.ref) : '-';
    const status = /^\d{3}$/.test(String(body?.status || '')) ? ` | status=${body.status}` : '';
    const page = clip(body?.page, 200) || '-';
    const message = clip(body?.message, 600) || '(no message)';
    writeLog(
      kind === 'crash' ? 'ERROR' : 'WARN',
      `ref=${ref} | CLIENT ${kind} | page=${page}${status} | ip=${ip} | ${deviceOf(ua)} | ${message}`,
      kind === 'crash' ? clip(body?.stack, 4000).replace(/ {2,}at /g, '\n at ') : undefined,
    );
    return { ok: true };
  }

  private fileOf(day: string) {
    if (!isLogDay(day)) throw new BadRequestException('Invalid date');
    const root = resolve(logRoot());
    const abs = resolve(logFileFor(day));
    if (!abs.startsWith(root + sep)) throw new BadRequestException('Invalid date');
    if (!existsSync(abs)) throw new NotFoundException('No log file for this date');
    return abs;
  }

  private parse(text: string): LogEntry[] {
    const out: LogEntry[] = [];
    for (const raw of text.split(/\r?\n/)) {
      if (!raw) continue;
      const m = raw.match(HEAD);
      if (m) {
        out.push({ time: m[1], level: m[2], ref: m[3].match(/^ref=([^ |]+)/)?.[1] || '-', text: m[3] });
      } else if (out.length) {
        const last = out[out.length - 1];
        last.detail = last.detail ? `${last.detail}\n${raw.trim()}` : raw.trim();
      }
    }
    return out;
  }

  private async read(day: string) {
    return this.parse(await readFile(this.fileOf(day), 'utf8'));
  }

  async days() {
    const keep = listLogDays().slice(0, retentionDays());
    const rows: { date: string; sizeBytes: number; errors: number; warnings: number }[] = [];
    for (const date of keep) {
      try {
        const abs = this.fileOf(date);
        const entries = this.parse(await readFile(abs, 'utf8'));
        rows.push({
          date,
          sizeBytes: statSync(abs).size,
          errors: entries.filter((e) => e.level === 'ERROR').length,
          warnings: entries.filter((e) => e.level === 'WARN').length,
        });
      } catch {
        /* skip unreadable files */
      }
    }
    return { retentionDays: retentionDays(), days: rows };
  }

  async day(user: AuthUser, date: string, q: { level?: string; q?: string; status?: string; limit?: string }) {
    let entries = await this.read(date);
    const total = entries.length;
    const level = String(q.level || '').toUpperCase();
    if (level === 'ERROR' || level === 'WARN') entries = entries.filter((e) => e.level === level);
    if (q.status && /^\d{3}$/.test(q.status)) entries = entries.filter((e) => e.text.includes(` | ${q.status} | `) || e.text.includes(`status=${q.status}`));
    const needle = String(q.q || '').trim().toLowerCase();
    if (needle) entries = entries.filter((e) => `${e.text}\n${e.detail || ''}`.toLowerCase().includes(needle));
    const limit = Math.min(Math.max(Number(q.limit) || MAX_ENTRIES, 1), MAX_ENTRIES);
    const shown = entries.slice(-limit).reverse();
    await this.note(user, 'LOGS_VIEW', { date });
    return { date, total, matched: entries.length, entries: shown };
  }

  async findRef(user: AuthUser, ref: string) {
    const code = String(ref || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new BadRequestException('Enter a valid reference code');
    const hits: (LogEntry & { date: string })[] = [];
    for (const date of listLogDays().slice(0, retentionDays())) {
      try {
        for (const e of await this.read(date)) if (e.ref === code) hits.push({ ...e, date });
      } catch {
        /* skip */
      }
      if (hits.length >= 50) break;
    }
    await this.note(user, 'LOGS_SEARCH', { ref: code });
    return { ref: code, entries: hits };
  }

  async downloadPath(user: AuthUser, date: string) {
    const abs = this.fileOf(date);
    await this.note(user, 'LOGS_DOWNLOAD', { date });
    return abs;
  }

  private async note(user: AuthUser, action: string, meta: Record<string, unknown>) {
    try {
      await this.audit.create({
        action,
        table: 'Logs',
        operation: action,
        actorUserId: user?.userId && Types.ObjectId.isValid(user.userId) ? new Types.ObjectId(user.userId) : undefined,
        actorEmail: user?.email,
        actorName: user?.name,
        meta,
      });
    } catch {
      /* audit is best effort */
    }
  }
}
