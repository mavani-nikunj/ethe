import { Model, Types } from 'mongoose';
import { CommTemplate } from '../database/comms.schema';
import { catalogEntry, catalogFor, CatalogEntry } from './catalog';

type TemplateModel = Model<CommTemplate>;

const oid = (id: Types.ObjectId | string) => new Types.ObjectId(String(id));

/**
 * True when the institute already has its own copy for this entry: a row with the same purpose, or (thesis mails)
 * an older row matched only by stage code, which findActiveTemplate still uses and a seeded row would shadow.
 */
async function hasCopy(model: TemplateModel, instituteId: Types.ObjectId, entry: CatalogEntry) {
  const or: Record<string, unknown>[] = [{ purpose: entry.purpose }];
  if (entry.stageCode) or.push({ stageCode: entry.stageCode, purpose: { $in: [null, ''] } });
  return !!(await model.exists({ instituteId, channel: entry.channel, $or: or }));
}

async function insertCopy(model: TemplateModel, instituteId: Types.ObjectId, entry: CatalogEntry) {
  // Upsert so two mails sent at the same moment do not insert two copies.
  return model.findOneAndUpdate(
    { instituteId, channel: entry.channel, purpose: entry.purpose },
    {
      $setOnInsert: {
        instituteId,
        channel: entry.channel,
        purpose: entry.purpose,
        name: entry.name,
        stageCode: entry.stageCode,
        subject: entry.subject,
        body: entry.body,
        active: true,
      },
    },
    { upsert: true, new: true },
  );
}

/** Put every catalog mail / letter the institute does not have yet into its Email / Letter master. */
export async function seedMissingTemplates(model: TemplateModel, instituteId: Types.ObjectId | string, channel?: string) {
  const iid = oid(instituteId);
  let created = 0;
  for (const entry of catalogFor(channel)) {
    if (await hasCopy(model, iid, entry)) continue;
    await insertCopy(model, iid, entry);
    created += 1;
  }
  return created;
}

/**
 * The institute's active template for a purpose. The first time a catalog purpose is used, its starting copy is
 * inserted into the master and returned. Null when the master has copies but all are switched off.
 */
export async function activeTemplate(model: TemplateModel, instituteId: Types.ObjectId | string, purpose: string, channel = 'EMAIL') {
  const iid = oid(instituteId);
  const ch = String(channel || 'EMAIL').toUpperCase();
  const active = await model.findOne({ instituteId: iid, purpose, channel: ch, active: true });
  if (active) return active;
  const entry = catalogEntry(purpose, ch);
  if (!entry || (await hasCopy(model, iid, entry))) return null;
  return insertCopy(model, iid, entry);
}

/**
 * Subject and body to fill for a purpose: the master's active template, or the catalog copy when every
 * template for it is switched off. Null for a purpose that is neither in the master nor in the catalog.
 */
export async function resolveTemplate(model: TemplateModel, instituteId: Types.ObjectId | string, purpose: string, channel = 'EMAIL') {
  const tpl = await activeTemplate(model, instituteId, purpose, channel);
  const entry = catalogEntry(purpose, channel);
  if (tpl?.body) {
    return { subject: tpl.subject || entry?.subject || '', body: tpl.body, templateId: tpl._id as Types.ObjectId };
  }
  if (!entry) return null;
  return { subject: entry.subject, body: entry.body, templateId: undefined };
}

export function looksLikeHtml(body: string) {
  return /<\/?(p|div|br|table|b|a)[\s>/]/i.test(String(body || ''));
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Replace {{name}} placeholders; in an HTML body the values are escaped unless listed in htmlVars. */
export function fillTemplate(text: string, vars: Record<string, string>, html = false, htmlVars: Set<string> = new Set()) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k] ?? '';
    return !html || htmlVars.has(k) ? v : esc(v);
  });
}

/** Resolve and fill a mail in one step (system mails). */
export async function renderTemplate(
  model: TemplateModel,
  instituteId: Types.ObjectId | string,
  purpose: string,
  vars: Record<string, string>,
  channel = 'EMAIL',
) {
  const tpl = await resolveTemplate(model, instituteId, purpose, channel);
  if (!tpl) throw new Error(`No template for ${purpose}`);
  const html = looksLikeHtml(tpl.body);
  return { subject: fillTemplate(tpl.subject, vars), body: fillTemplate(tpl.body, vars, html), templateId: tpl.templateId };
}
