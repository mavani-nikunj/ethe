import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@ethesis/shared';

@Injectable()
export class InstituteGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || user.role === UserRole.SUPER_ADMIN || !user.instituteId) {
      throw new ForbiddenException('Institute access only');
    }
    return true;
  }
}
