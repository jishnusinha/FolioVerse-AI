import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../infra/prisma.service';
import { IS_PUBLIC, MIN_ROLE, SUPER_ADMIN } from './auth.decorators';
import { CryptoService } from './crypto.service';
import { isUuid } from './ids';

export const ROLE_RANK: Record<MemberRole, number> = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: authenticates (cookie fv_at or Bearer), enforces double-submit CSRF for
 * cookie-authenticated mutations, then resolves workspace membership for :workspaceId routes.
 * Non-members receive 404 so resource existence is never disclosed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: any; member?: any }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);

    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookieToken = req.cookies?.fv_at as string | undefined;
    const token = bearer || cookieToken;

    if (token) {
      try {
        const c = await this.crypto.verifyAccess(token);
        req.user = { id: c.sub, email: c.email, role: c.role };
      } catch {
        if (!isPublic) throw new UnauthorizedException({ message: 'Session expired', code: 'TOKEN_EXPIRED' });
      }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException({ message: 'Authentication required', code: 'NO_SESSION' });

    if (!bearer && !SAFE_METHODS.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      const cookie = req.cookies?.fv_csrf;
      if (!cookie || !header || header !== cookie) throw new ForbiddenException({ message: 'CSRF token missing or invalid', code: 'CSRF' });
    }

    if (this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN, [ctx.getHandler(), ctx.getClass()])) {
      if (req.user.role !== 'SUPER_ADMIN') throw new NotFoundException();
    }

    const workspaceId = req.params?.workspaceId;
    if (workspaceId !== undefined) {
      if (!isUuid(workspaceId)) throw new NotFoundException();
      const m = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
        include: { workspace: { select: { deletedAt: true } } },
      });
      if (!m || m.workspace.deletedAt) throw new NotFoundException();
      const min = this.reflector.getAllAndOverride<MemberRole>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]) ?? 'VIEWER';
      if (ROLE_RANK[m.role] < ROLE_RANK[min]) throw new ForbiddenException({ message: `Requires ${min} role`, code: 'ROLE' });
      req.member = { workspaceId, role: m.role };
    }
    return true;
  }
}
