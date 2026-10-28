import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { Observable } from 'rxjs';
import { AuthUser } from './current-user';
import { originFromRequest, runWithRequestOrigin } from './web-origin';

export type AuditActor = {
  userId?: string;
  email?: string;
  name?: string;
  instituteId?: string | null;
};

const storage = new AsyncLocalStorage<AuditActor | null>();

export function getAuditActor(): AuditActor | null {
  return storage.getStore() ?? null;
}

export function runWithAuditActor<T>(actor: AuditActor | null, fn: () => T): T {
  return storage.run(actor, fn);
}

@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    const actor: AuditActor | null = user
      ? {
          userId: user.userId,
          email: user.email,
          name: user.name,
          instituteId: user.instituteId,
        }
      : null;
    const origin = originFromRequest(req);
    return new Observable((subscriber) => {
      storage.run(actor, () => {
        runWithRequestOrigin(origin, () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
        });
      });
    });
  }
}
