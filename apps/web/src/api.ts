import { reportClientError } from './errorReporter';

const TOKEN = 'ethesis_token';

export function getToken() {
  return localStorage.getItem(TOKEN);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN, t);
  else localStorage.removeItem(TOKEN);
}

/** Same message as before; also carries the HTTP status (0 = no response), the form field and the server log reference. */
export class ApiError extends Error {
  status: number;
  field?: string;
  ref?: string;
  constructor(message: string, status: number, field?: string, ref?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.ref = ref;
  }
}

/** Failures the API never sees (proxy limits, network, server down) only reach the log through the browser. */
function reportUnseen(path: string, status: number, message: string) {
  if (status === 0 || status === 413 || status === 502 || status === 503 || status === 504) {
    reportClientError({ kind: 'api', status, message: `${path}: ${message}` });
  }
}

function result<T>(path: string, status: number, statusText: string, text: string, ref?: string): T {
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: a proxy error page (e.g. nginx "502 Bad Gateway" while the API is down). Never show raw HTML.
    data = { message: /<[a-z!][\s\S]*>/i.test(text) ? serverDownMessage(status) : text };
  }
  if (status < 200 || status >= 300) {
    const msg = data?.message || data?.error || statusText;
    const message = Array.isArray(msg) ? msg.join(', ') : msg;
    reportUnseen(path, status, String(message));
    throw new ApiError(message, status, typeof data?.field === 'string' ? data.field : undefined, ref || undefined);
  }
  return data as T;
}

const NETWORK_MESSAGE = 'Could not reach the server. Please try again.';

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...opts, headers });
  } catch (err: any) {
    const message = err?.message === 'Failed to fetch' ? NETWORK_MESSAGE : err?.message || 'Request failed';
    reportUnseen(path, 0, message);
    throw new ApiError(message, 0);
  }
  const text = await res.text();
  return result<T>(path, res.status, res.statusText, text, res.headers.get('X-Request-Id') || undefined);
}

function serverDownMessage(status: number) {
  if (status === 502 || status === 503 || status === 504) {
    return `The server is not responding right now (${status}). Please try again in a minute; if it keeps happening, the API service needs to be restarted.`;
  }
  return `The server returned an error (${status}). Please try again.`;
}

export type UploadProgress = { loaded: number; total: number; percent: number };

/** POST a FormData with upload progress (fetch cannot report it). Same errors as `post`. */
export function postWithProgress<T = any>(path: string, body: FormData, onProgress?: (p: UploadProgress) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress({ loaded: e.loaded, total: e.total, percent: Math.min(100, Math.round((e.loaded / e.total) * 100)) });
    };
    xhr.onload = () => {
      try {
        resolve(result<T>(path, xhr.status, xhr.statusText, xhr.responseText, xhr.getResponseHeader('X-Request-Id') || undefined));
      } catch (err) {
        reject(err);
      }
    };
    const failed = () => {
      reportUnseen(path, 0, NETWORK_MESSAGE);
      reject(new ApiError(NETWORK_MESSAGE, 0));
    };
    xhr.onerror = failed;
    xhr.ontimeout = failed;
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
    xhr.send(body);
  });
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
export const patch = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
export const put = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
