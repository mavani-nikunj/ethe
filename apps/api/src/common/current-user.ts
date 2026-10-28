import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthUser = {
  userId: string;
  email: string;
  name: string;
  role: string;
  instituteId: string | null;
  authoritySlot?: string;
  departmentIds?: string[];
  courseIds?: string[];
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
