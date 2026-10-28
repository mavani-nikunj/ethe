/**
 * Sends errors the user saw to the server's daily log (POST /api/client-logs).
 * Fire-and-forget: a failed report is dropped silently, never retried and never shown.
 */

export type ClientErrorReport = {
  kind?: 'api' | 'crash' | 'form';
  message: string;
  status?: number;
  ref?: string;
  stack?: string;
};

const MAX_PER_MINUTE = 10;
const sent = new Set<string>();
let windowStart = 0;
let windowCount = 0;

export function reportClientError(report: ClientErrorReport) {
  try {
    const message = String(report.message || '').slice(0, 600);
    const key = `${report.kind || 'form'}|${report.status || ''}|${message}`;
    if (!message || sent.has(key)) return;
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > MAX_PER_MINUTE) return;
    sent.add(key);
    const body = JSON.stringify({
      kind: report.kind || 'form',
      message,
      status: report.status || undefined,
      ref: report.ref || undefined,
      stack: report.stack ? String(report.stack).slice(0, 4000) : undefined,
      page: window.location.pathname,
    });
    fetch('/api/client-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* reporting must never affect the page */
  }
}

let installed = false;

/** Page crashes and unhandled promise errors anywhere in the app. */
export function installErrorReporter() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    reportClientError({ kind: 'crash', message: e.message || String(e.error || 'Script error'), stack: e.error?.stack });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e.reason;
    if (r?.name === 'ApiError') return;
    reportClientError({ kind: 'crash', message: String(r?.message || r || 'Unhandled promise rejection'), stack: r?.stack });
  });
}
