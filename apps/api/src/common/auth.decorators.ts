import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';

export const IS_PUBLIC = 'fv:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const MIN_ROLE = 'fv:minRole';
/** Requires workspace membership (resolved from the :workspaceId route param) with at least this role. */
export const RequireRole = (role: MemberRole) => SetMetadata(MIN_ROLE, role);

export const SUPER_ADMIN = 'fv:superAdmin';
export const RequireSuperAdmin = () => SetMetadata(SUPER_ADMIN, true);

export interface AuthUser {
  id: string;
  email: string;
  role: 'USER' | 'SUPER_ADMIN';
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const CurrentMember = createParamDecorator((_: unknown, ctx: ExecutionContext): { workspaceId: string; role: MemberRole } => {
  return ctx.switchToHttp().getRequest().member;
});
