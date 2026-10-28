import { Logger } from '@nestjs/common';
import mongoose, { Schema, Types } from 'mongoose';
import { getAuditActor } from './audit-context';

const SECRET_KEYS = new Set(['passwordHash', 'tempPassword', 'otpHash', 'token', 'sessionHash']);
const logger = new Logger('AuditPlugin');

function redact(input: any): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const src = typeof input.toObject === 'function' ? input.toObject() : { ...input };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (SECRET_KEYS.has(k)) continue;
    out[k] = v as unknown;
  }
  return out;
}

function asObjectId(value: unknown): Types.ObjectId | undefined {
  if (!value) return undefined;
  if (value instanceof Types.ObjectId) return value;
  const s = String(value);
  if (!/^[a-f0-9]{24}$/i.test(s)) return undefined;
  return new Types.ObjectId(s);
}

function instituteOf(doc?: Record<string, unknown>, actorInstituteId?: string | null) {
  return asObjectId(doc?.instituteId) || asObjectId(actorInstituteId) || undefined;
}

function getAuditModel() {
  if (mongoose.models.AuditLog) return mongoose.models.AuditLog;
  for (const conn of mongoose.connections || []) {
    if (conn?.models?.AuditLog) return conn.models.AuditLog;
  }
  return undefined;
}

async function writeRow(opts: {
  table: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  recordId?: unknown;
  before?: any;
  after?: any;
}) {
  try {
    const Audit = getAuditModel();
    if (!Audit) {
      logger.warn('audit write skipped: AuditLog model is not registered');
      return;
    }
    const actor = getAuditActor();
    const before = redact(opts.before);
    const after = redact(opts.after);
    const recordId = asObjectId(opts.recordId) || asObjectId(after?._id) || asObjectId(before?._id);
    let instituteId = instituteOf(after, actor?.instituteId) || instituteOf(before, actor?.instituteId);
    if (!instituteId && opts.table === 'Institute') instituteId = recordId;
    await Audit.create({
      table: opts.table,
      operation: opts.operation,
      recordId,
      before,
      after,
      actorUserId: asObjectId(actor?.userId),
      actorEmail: actor?.email,
      actorName: actor?.name || 'SYSTEM',
      instituteId,
      action: `${opts.table}.${opts.operation}`,
      meta: {},
    });
  } catch (err: any) {
    logger.warn(`audit write failed: ${err?.message || err}`);
  }
}

function cloneFilter(query: any) {
  return { ...(query.getFilter?.() || query.getQuery?.() || {}) };
}

export function auditPlugin(schema: Schema) {
  schema.pre('save', async function () {
    (this as any).$locals.auditWasNew = this.isNew;
    if (!this.isNew && this._id) {
      try {
        const prev = await (this.constructor as any).findById(this._id).lean();
        (this as any).$locals.auditBefore = prev;
      } catch (err: any) {
        logger.warn(`audit before-save failed: ${err?.message || err}`);
      }
    }
  });

  schema.post('save', async function (doc: any) {
    const wasNew = Boolean(doc?.$locals?.auditWasNew);
    await writeRow({
      table: doc.constructor.modelName,
      operation: wasNew ? 'CREATE' : 'UPDATE',
      recordId: doc._id,
      before: wasNew ? undefined : doc.$locals?.auditBefore,
      after: doc,
    });
  });

  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'] as any, async function (this: any) {
    try {
      this._auditBefores = await this.model.find(cloneFilter(this)).lean();
    } catch (err: any) {
      logger.warn(`audit before-update failed: ${err?.message || err}`);
      this._auditBefores = [];
    }
  });

  schema.post(['findOneAndUpdate', 'updateOne', 'updateMany'] as any, async function (this: any) {
    try {
      const table = this.model.modelName;
      const befores: any[] = Array.isArray(this._auditBefores) ? this._auditBefores : [];
      const ids = befores.map((b) => asObjectId(b?._id)).filter(Boolean);
      const afters = ids.length ? await this.model.find({ _id: { $in: ids } }).lean() : [];
      const afterMap = new Map(afters.map((a: any) => [String(a._id), a]));
      for (const before of befores) {
        await writeRow({
          table,
          operation: 'UPDATE',
          recordId: before._id,
          before,
          after: afterMap.get(String(before._id)),
        });
      }
    } catch (err: any) {
      logger.warn(`audit after-update failed: ${err?.message || err}`);
    }
  });

  schema.pre(['findOneAndDelete', 'deleteOne', 'deleteMany'] as any, async function (this: any) {
    try {
      this._auditBefores = await this.model.find(cloneFilter(this)).lean();
    } catch (err: any) {
      logger.warn(`audit before-delete failed: ${err?.message || err}`);
      this._auditBefores = [];
    }
  });

  schema.post(['findOneAndDelete', 'deleteOne', 'deleteMany'] as any, async function (this: any) {
    try {
      const table = this.model.modelName;
      const befores: any[] = Array.isArray(this._auditBefores) ? this._auditBefores : [];
      for (const before of befores) {
        await writeRow({
          table,
          operation: 'DELETE',
          recordId: before._id,
          before,
        });
      }
    } catch (err: any) {
      logger.warn(`audit after-delete failed: ${err?.message || err}`);
    }
  });

  schema.post('insertMany', async function (docs: any[]) {
    try {
      const table = (this as any).modelName;
      for (const doc of docs || []) {
        await writeRow({
          table,
          operation: 'CREATE',
          recordId: doc._id,
          after: doc,
        });
      }
    } catch (err: any) {
      logger.warn(`audit insertMany failed: ${err?.message || err}`);
    }
  });
}
