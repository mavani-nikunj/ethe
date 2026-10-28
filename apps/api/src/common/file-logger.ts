import { ConsoleLogger } from '@nestjs/common';
import { writeLog } from './app-log';

/**
 * Nest's console logger, unchanged on screen / pm2, that also copies warnings and errors into the day's log file.
 * Request failures are written by the request logger (with their reference), so Nest's own
 * ExceptionsHandler copy is left on the console only to avoid writing the same error twice.
 */
export class FileLogger extends ConsoleLogger {
  error(message: any, ...rest: any[]) {
    super.error(message, ...rest);
    this.copy('ERROR', message, rest);
  }

  warn(message: any, ...rest: any[]) {
    super.warn(message, ...rest);
    this.copy('WARN', message, rest);
  }

  private copy(level: 'ERROR' | 'WARN', message: any, rest: any[]) {
    try {
      const args = [...rest];
      const context = typeof args[args.length - 1] === 'string' ? (args.pop() as string) : this.context || '';
      if (context === 'ExceptionsHandler') return;
      const stack = args.find((a) => typeof a === 'string' && /\n\s+at /.test(a)) as string | undefined;
      const text = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
      writeLog(level, `ref=- | ${context || 'App'} | ${text}`, message instanceof Error ? message.stack : stack);
    } catch {
      /* never let logging break the caller */
    }
  }
}
