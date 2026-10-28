import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { newRef, writeLog } from './app-log';

const SLOW_MS = Number(process.env.LOG_SLOW_MS || 10000);

type LoggedError = { message?: string; field?: string; stack?: string };

function clientIp(req: any) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '-';
}

/** "Android 13 Chrome 129" style summary instead of the full user agent. */
export function deviceOf(ua?: string) {
  const s = String(ua || '');
  if (!s) return '-';
  const os =
    s.match(/Android [\d.]+/)?.[0] ||
    (s.match(/iPhone OS ([\d_]+)/) ? `iOS ${s.match(/iPhone OS ([\d_]+)/)![1].replace(/_/g, '.')}` : '') ||
    (s.includes('Windows') ? 'Windows' : '') ||
    (s.includes('Mac OS X') ? 'Mac' : '') ||
    (s.includes('Linux') ? 'Linux' : '') ||
    'Other';
  const browser =
    s.match(/(Edg|SamsungBrowser|CriOS|Firefox|OPR)\/[\d]+/)?.[0] ||
    s.match(/Chrome\/[\d]+/)?.[0] ||
    (s.includes('Safari') ? `Safari${s.match(/Version\/([\d]+)/) ? ' ' + s.match(/Version\/([\d]+)/)![1] : ''}` : '') ||
    'Other';
  return `${os} ${browser.replace('/', ' ')}`;
}

function sizeOf(req: any) {
  const n = Number(req.headers?.['content-length'] || 0);
  if (!n) return '';
  return n >= 1024 * 1024 ? ` | size=${(n / 1024 / 1024).toFixed(1)}MB` : ` | size=${Math.ceil(n / 1024)}KB`;
}

/**
 * Gives every request a reference (X-Request-Id) and, once the response is sent,
 * writes failed (4xx/5xx), aborted and very slow requests to the day's log file.
 * Successful requests are not logged.
 */
export function requestLogMiddleware(req: any, res: any, next: () => void) {
  const ref = newRef();
  const started = Date.now();
  req.logRef = ref;
  try {
    res.setHeader('X-Request-Id', ref);
  } catch {
    /* headers already sent */
  }
  const line = (status: string | number) =>
    `ref=${ref} | ${req.method} ${req.originalUrl || req.url} | ${status} | ${Date.now() - started}ms | ip=${clientIp(req)} | ${deviceOf(
      req.headers?.['user-agent'],
    )}${sizeOf(req)}`;
  res.on('finish', () => {
    try {
      const status = res.statusCode;
      const err: LoggedError = req.logError || {};
      if (status >= 400) {
        const msg = err.message ? ` | ${err.message}${err.field ? ` (field=${err.field})` : ''}` : '';
        writeLog(status >= 500 ? 'ERROR' : 'WARN', line(status) + msg, status >= 500 ? err.stack : undefined);
      } else if (Date.now() - started > SLOW_MS) {
        writeLog('WARN', line(status) + ' | slow request');
      }
    } catch {
      /* logging must never affect the response */
    }
  });
  res.on('close', () => {
    try {
      if (!res.writableFinished) writeLog('WARN', line('aborted') + ' | connection closed before the response was sent');
    } catch {
      /* ignore */
    }
  });
  next();
}

/**
 * Records what went wrong for the request logger, then hands the error to Nest's normal handler,
 * so every error response is exactly what it was before.
 */
@Catch()
export class LogExceptionsFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    try {
      if (host.getType() === 'http') {
        const req = host.switchToHttp().getRequest();
        if (req) {
          let message = '';
          let field: string | undefined;
          if (exception instanceof HttpException) {
            const body: any = exception.getResponse();
            const raw = typeof body === 'string' ? body : body?.message;
            message = Array.isArray(raw) ? raw.join(', ') : String(raw ?? exception.message);
            field = typeof body === 'object' && body?.field ? String(body.field) : undefined;
          } else {
            message = exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception);
          }
          const status = exception instanceof HttpException ? exception.getStatus() : 500;
          req.logError = {
            message,
            field,
            stack: status >= 500 && exception instanceof Error ? exception.stack : undefined,
          } as LoggedError;
        }
      }
    } catch {
      /* fall through to the normal handler */
    }
    super.catch(exception, host);
  }
}
