import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ethesis/shared';

@Injectable()
export class PlatformOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Platform access only');
    }
    return true;
  }
}
