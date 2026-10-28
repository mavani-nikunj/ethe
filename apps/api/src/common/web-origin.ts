import { AsyncLocalStorage } from 'async_hooks';

const LOCAL_DEV = 'http://localhost:5173';
const originStore = new AsyncLocalStorage<string | null>();

function firstHeader(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
}

function asOrigin(raw?: string | null): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function publicOrigin(raw?: string | null): string | null {
  const origin = asOrigin(raw);
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (isLoopbackHost(url.hostname)) return null;
    return origin;
  } catch {
    return null;
  }
}

function envOrigin(publicOnly = false): string | null {
  const raw = process.env.WEB_ORIGIN || process.env.PUBLIC_WEB_URL || process.env.APP_URL || '';
  return publicOnly ? publicOrigin(raw) : asOrigin(raw);
}

export function originFromRequest(req?: {
  headers?: Record<string, unknown>;
  protocol?: string;
  secure?: boolean;
}): string | null {
  if (!req?.headers) return null;
  const headers = req.headers;
  const fromOrigin = publicOrigin(firstHeader(headers.origin));
  if (fromOrigin) return fromOrigin;
  const fromReferer = publicOrigin(firstHeader(headers.referer));
  if (fromReferer) return fromReferer;
  const proto = (
    firstHeader(headers['x-forwarded-proto']) ||
    (req.secure || req.protocol === 'https' ? 'https' : 'http')
  )
    .split(',')[0]
    .trim();
  const forwardedHost = firstHeader(headers['x-forwarded-host']).split(',')[0].trim();
  if (forwardedHost && !isLoopbackHost(forwardedHost)) return publicOrigin(`${proto}://${forwardedHost}`);
  const host = firstHeader(headers.host);
  if (host && !isLoopbackHost(host)) return publicOrigin(`${proto}://${host}`);
  return null;
}

export function runWithRequestOrigin<T>(origin: string | null, fn: () => T): T {
  return originStore.run(origin, fn);
}

export function webOrigin(): string {
  return originStore.getStore() || envOrigin(true) || envOrigin(false) || LOCAL_DEV;
}

export function webUrl(path = '/'): string {
  const base = webOrigin().replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function taskUrl(token: string): string {
  return webUrl(`/task/${token}`);
}

export function loginUrl(): string {
  return webUrl('/login');
}

export function rewriteLocalOrigins(text: string): string {
  const origin = webOrigin();
  return String(text || '')
    .replace(/https?:\/\/localhost(?::\d+)?/gi, origin)
    .replace(/https?:\/\/127\.0\.0\.1(?::\d+)?/gi, origin);
}
