import React from 'react';
import { withLetterheadLogo } from '@ethesis/shared';
import { copyRows, downloadCsv, printRows } from '../dept';

export function Field({
  label,
  children,
  required,
  error,
  extra,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string;
  extra?: React.ReactNode;
}) {
  const caption = (
    <>
      {label}
      {required ? <span className="req"> *</span> : null}
    </>
  );
  const body = (
    <>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </>
  );
  const className = `field${error ? ' has-error' : ''}`;
  if (extra) {
    return (
      <div className={className}>
        <span className="field-head">
          <span>{caption}</span>
          {extra}
        </span>
        {body}
      </div>
    );
  }
  return (
    <label className={className}>
      <span>{caption}</span>
      {body}
    </label>
  );
}

export function ErrorBox({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="error">{error}</div>;
}

function looksLikeHtml(s: string) {
  return /<\/?(?:p|div|br|span|b|i|u|strong|em|ul|ol|li|h[1-6]|table|a|font|blockquote|hr|img)[\s>/]/i.test(s || '');
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** AIIMS logo in the letterhead, then drop HTML comments (letterhead markers) so they do not show as text. */
function tidyMailHtml(body: string) {
  return withLetterheadLogo(body).replace(/<!--[\s\S]*?-->/g, '');
}

export function MailBodyView({ body: raw }: { body?: string }) {
  if (!raw) return null;
  const body = tidyMailHtml(raw);
  if (!looksLikeHtml(body)) {
    return <pre className="mail-preview-body">{body}</pre>;
  }
  const match = body.match(/<\/?(?:p|div|br|span|b|i|u|strong|em|ul|ol|li|h[1-6]|table|a|font|blockquote|hr|img)[\s>/]/i);
  const idx = match?.index ?? 0;
  const head = body.slice(0, idx).trim();
  const html = body.slice(idx);
  const headHtml = head ? `<div class="mail-preview-head">${escapeHtml(head).replace(/\n/g, '<br>')}</div>` : '';
  return <div className="mail-preview-body mail-preview-html" dangerouslySetInnerHTML={{ __html: headHtml + html }} />;
}

export function Pill({ status }: { status?: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'ok',
    COMPLETED: 'ok',
    ACCEPTED: 'ok',
    ACCEPT: 'ok',
    RELEASE: 'ok',
    DRAFT: 'muted',
    INVITED: 'navy',
    IN_PROGRESS: 'navy',
    PENDING: 'navy',
    APPROVED: 'ok',
    HELD: 'warn',
    SUSPENDED: 'bad',
    DISABLED: 'bad',
    REJECTED: 'bad',
    REJECT: 'bad',
    REGRETTED: 'bad',
    ON_HOLD: 'warn',
    HOLD: 'warn',
    REVISION: 'warn',
  };
  return <span className={`pill ${map[status || ''] || 'muted'}`}>{status || '—'}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card" style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>
      {children}
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  detail,
  yesLabel = 'Yes',
  noLabel = 'No',
  onYes,
  onNo,
}: {
  title: string;
  message: string;
  detail?: string;
  yesLabel?: string;
  noLabel?: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div
        className={`modal-card dialog-card${detail ? ' dialog-card-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        {detail ? <MailBodyView body={detail} /> : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onYes}>
            {yesLabel}
          </button>
          <button type="button" className="btn secondary" onClick={onNo}>
            {noLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ResultDialog({
  ok,
  message,
  onClose,
}: {
  ok: boolean;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay dialog-overlay" role="presentation">
      <div className="modal-card dialog-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{ok ? 'Success' : 'Error'}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function PageLoader({ message }: { message: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="page-loader-card">
        <div className="spinner" />
        <div>{message}</div>
      </div>
    </div>
  );
}

export function ExportButtons({
  columns,
  rows,
  filename,
  title,
}: {
  columns: { key: string; label: string }[];
  rows: any[];
  filename: string;
  title?: string;
}) {
  const printTitle =
    title ||
    filename
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="row table-export no-print">
      <button type="button" className="btn small secondary" onClick={() => copyRows(columns, rows)}>
        Copy
      </button>
      <button type="button" className="btn small secondary" onClick={() => downloadCsv(`${filename}.csv`, columns, rows)}>
        Excel
      </button>
      <button type="button" className="btn small secondary" onClick={() => printRows(printTitle, columns, rows)}>
        PDF
      </button>
    </div>
  );
}
