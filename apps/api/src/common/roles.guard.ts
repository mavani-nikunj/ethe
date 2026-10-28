import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canonicalUserRole } from '@ethesis/shared';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest().user;
    const allowed = (roles || []).map((r) => canonicalUserRole(r));
    if (!user || !allowed.includes(canonicalUserRole(user.role))) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
