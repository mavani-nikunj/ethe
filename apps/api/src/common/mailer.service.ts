import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { LETTERHEAD_LOGO_SRC, PRODUCT_NAME, withLetterheadLogo } from '@ethesis/shared';
import { webUrl } from './web-origin';
import { existsSync, readFileSync } from 'fs';
import { basename, extname, join, resolve } from 'path';

/** Same lookup as main.ts static serving. */
function uploadRoot() {
  const dir = process.env.UPLOAD_DIR || 'uploads';
  const here = join(process.cwd(), dir);
  const inApp = join(process.cwd(), 'apps', 'api', dir);
  return resolve(existsSync(here) ? here : existsSync(inApp) ? inApp : here);
}

const LOGO_CID = 'aiims-logo';

/** The AIIMS letterhead logo from the web app's public folder (API runs from the repo root or apps/api). */
function letterheadLogoFile() {
  const rel = join('web', 'public', LETTERHEAD_LOGO_SRC.replace(/^\//, ''));
  const file = [join(process.cwd(), 'apps', rel), join(process.cwd(), '..', rel)].find((p) => existsSync(p));
  return file ? resolve(file) : null;
}

const TRANSIENT = ['ESOCKET', 'EHOSTUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EDNS'];
const SMTP2GO_API_URL = 'https://api.smtp2go.com/v3/email/send';
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
  private usedPort: number | null = null;

  constructor(private config: ConfigService) {}

  private smtpHost() {
    return this.config.get<string>('SMTP_HOST')?.trim() || '';
  }

  private smtpUser() {
    return this.config.get<string>('SMTP_USER')?.trim() || '';
  }

  private smtpPass() {
    return this.config.get<string>('SMTP_PASS') || '';
  }

  private createTransport(port: number, secure: boolean): Transporter {
    return nodemailer.createTransport({
      host: this.smtpHost(),
      port,
      secure,
      auth: { user: this.smtpUser(), pass: this.smtpPass() },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000,
    });
  }

  private configured(): boolean {
    return Boolean(this.apiKey() || (this.smtpHost() && this.smtpUser() && this.smtpPass()));
  }

  /** SMTP2GO HTTP API key: the mail route for this project. Plain SMTP is used only when SMTP_HOST/USER/PASS are set and no key is. */
  private apiKey() {
    return this.config.get<string>('SMTP2GO_API_KEY')?.trim() || '';
  }

  /** Send through the SMTP2GO HTTP API; inline images are referenced as cid:<filename>. */
  private async sendViaApi(payload: {
    from: string;
    to: string;
    cc?: string;
    subject: string;
    text: string;
    html: string;
    attachments?: { filename: string; path: string; cid: string }[];
  }) {
    const inlines = (payload.attachments || []).map((a) => ({
      filename: a.cid,
      fileblob: readFileSync(a.path).toString('base64'),
      mimetype: IMAGE_TYPES[extname(a.path).toLowerCase()] || 'application/octet-stream',
    }));
    const res = await fetch(this.config.get<string>('SMTP2GO_API_URL') || SMTP2GO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Smtp2go-Api-Key': this.apiKey() },
      body: JSON.stringify({
        sender: payload.from,
        to: [payload.to],
        ...(payload.cc ? { cc: payload.cc.split(/[,;]/).map((x) => x.trim()).filter(Boolean) } : {}),
        subject: payload.subject,
        text_body: payload.text,
        html_body: payload.html,
        ...(inlines.length ? { inlines } : {}),
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    const data = json?.data || {};
    if (!res.ok || !(data.succeeded > 0)) {
      const reason = data.failures?.[0] || data.error || json?.error || `HTTP ${res.status}`;
      throw new BadRequestException(`Email send failed: ${String(reason).split('\n')[0]}`);
    }
    return data.email_id as string | undefined;
  }

  private async connect(preferredPort?: number): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    const primary = preferredPort || Number(this.config.get('SMTP_PORT') || 587);
    const attempts: { port: number; secure: boolean }[] =
      primary === 465
        ? [
            { port: 465, secure: true },
            { port: 587, secure: false },
          ]
        : [
            { port: 587, secure: false },
            { port: 465, secure: true },
          ];
    let lastErr: any;
    for (const attempt of attempts) {
      try {
        const smtp = this.createTransport(attempt.port, attempt.secure);
        await smtp.verify();
        this.transporter = smtp;
        this.usedPort = attempt.port;
        this.log.log(`SMTP ready on port ${attempt.port}`);
        return smtp;
      } catch (err: any) {
        lastErr = err;
        this.log.warn(`SMTP port ${attempt.port} failed: ${err?.code || ''} ${err?.message || err}`);
      }
    }
    throw lastErr;
  }

  private looksLikeHtml(body: string) {
    return /<\/?(?:p|div|br|span|b|i|u|strong|em|ul|ol|li|h[1-6]|table|a|font|blockquote|hr|img)[\s>/]/i.test(body || '');
  }

  /**
   * Images from our own uploads (letterhead logo, signatures) are attached inline (cid:), so they show
   * even when the site URL is not reachable from the recipient's mail client. Empty <img src=""> is dropped.
   */
  private inlineImages(html: string) {
    const attachments: { filename: string; path: string; cid: string }[] = [];
    const root = uploadRoot();
    const logo = letterheadLogoFile();
    const out = withLetterheadLogo(html)
      .replace(/<img\b[^>]*\bsrc=(["'])\s*\1[^>]*>/gi, '')
      .replace(/(<img\b[^>]*\bsrc=)(["'])([^"']*\/aiims-logo\.png)\2/gi, (match, pre, q) => {
        if (!logo) return `${pre}${q}${webUrl(LETTERHEAD_LOGO_SRC)}${q}`;
        if (!attachments.some((a) => a.cid === LOGO_CID)) {
          attachments.push({ filename: 'aiims-logo.png', path: logo, cid: LOGO_CID });
        }
        return `${pre}${q}cid:${LOGO_CID}${q}`;
      })
      .replace(/(<img\b[^>]*\bsrc=)(["'])([^"']*?\/(?:api\/)?uploads\/([^"'?#]+))\2/gi, (match, pre, q, _src, rel) => {
        const relPath = decodeURIComponent(rel);
        if (relPath.startsWith('private/')) return match;
        const file = resolve(root, relPath);
        if (!file.startsWith(root) || !existsSync(file)) return match;
        let att = attachments.find((a) => a.path === file);
        if (!att) {
          const name = `img${attachments.length}-${basename(file).replace(/[^\w.-]/g, '_')}`;
          att = { filename: name, path: file, cid: name };
          attachments.push(att);
        }
        return `${pre}${q}cid:${att.cid}${q}`;
      });
    return { html: out, attachments };
  }

  private stripHtml(html: string) {
    return String(html || '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** `noCc` leaves out MAIL_CC, for confidential mail such as the examiner's evaluation report. */
  async send(to: string, subject: string, body: string, extra?: Record<string, string>, opts: { noCc?: boolean } = {}) {
    // MAIL_DISABLED=1 (tests / local dry runs): log instead of sending real mail.
    if (!this.configured() || this.config.get<string>('MAIL_DISABLED') === '1') {
      this.log.warn(`Mail not configured (set SMTP2GO_API_KEY); logging mail to ${to}: ${subject}`);
      console.log('[ConsoleMailer]', { to, subject, body: body.slice(0, 240), extra });
      return { to, subject, body, status: 'LOGGED' };
    }
    const fromEmail = this.config.get<string>('MAIL_FROM') || this.smtpUser();
    const fromName = this.config.get<string>('MAIL_FROM_NAME') || PRODUCT_NAME;
    const html = this.looksLikeHtml(body);
    const inline = html ? this.inlineImages(body) : { html: body, attachments: [] };
    const payload = {
      from: `"${fromName}" <${fromEmail}>`,
      to,
      cc: opts.noCc ? undefined : this.config.get<string>('MAIL_CC')?.trim() || undefined,
      subject,
      text: html ? this.stripHtml(body) : body,
      html: html
        ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2d41">${inline.html}</div>`
        : `<pre style="font-family:inherit;white-space:pre-wrap">${body.replace(/</g, '&lt;')}</pre>`,
      attachments: inline.attachments.length ? inline.attachments : undefined,
    };
    if (this.apiKey()) {
      const id = await this.sendViaApi(payload);
      this.log.log(`Sent "${subject}" to ${to} via SMTP2GO API (${id || 'no id'})`);
      return { to, subject, body, status: 'SENT' };
    }
    let lastErr: any;
    for (let i = 0; i < 3; i++) {
      try {
        const smtp = await this.connect();
        await smtp.sendMail(payload);
        this.log.log(`Sent "${subject}" to ${to}`);
        return { to, subject, body, status: 'SENT' };
      } catch (err: any) {
        lastErr = err;
        this.transporter = null;
        this.log.error(`SMTP attempt ${i + 1} failed for ${to}: ${err?.code || ''} ${err?.message || err}`);
        if (!TRANSIENT.includes(err?.code) && err?.name !== 'BadRequestException') break;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    const code = lastErr?.code || '';
    if (TRANSIENT.includes(code)) {
      throw new BadRequestException(
        'Could not reach the mail server. Check internet / firewall, then try again.',
      );
    }
    throw new BadRequestException(lastErr?.message || 'Email send failed');
  }
}
