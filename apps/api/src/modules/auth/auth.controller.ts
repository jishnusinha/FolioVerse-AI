import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../../common/auth.decorators';
import { randomToken } from '../../common/ids';
import { env } from '../../config/env';
import { clearAuthCookies, clientIp, setAuthCookies } from '../../common/http';
import { PrismaService } from '../../infra/prisma.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto, UpdateMeDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing = req.cookies?.fv_csrf;
    const token = existing || randomToken(18);
    if (!existing) res.cookie('fv_csrf', token, { httpOnly: false, secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/' });
    return { csrfToken: token };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(dto.email, dto.password, dto.displayName, clientIp(req));
    setAuthCookies(res, await this.auth.issueSession(user, undefined, req.headers['user-agent']));
    return { user: this.auth.publicUser(user) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(dto.email, dto.password, clientIp(req));
    setAuthCookies(res, await this.auth.issueSession(user, undefined, req.headers['user-agent']));
    return { user: this.auth.publicUser(user) };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { session, user } = await this.auth.refresh(req.cookies?.fv_rt, req.headers['user-agent']);
      setAuthCookies(res, session);
      return { user: this.auth.publicUser(user) };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.fv_rt);
    clearAuthCookies(res);
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: u.id, workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      user: this.auth.publicUser(user),
      workspaces: memberships.map((m) => ({ id: m.workspaceId, name: m.workspace.name, kind: m.workspace.kind, role: m.role })),
    };
  }

  @Patch('me')
  async updateMe(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const user = await this.prisma.user.update({
      where: { id: u.id },
      data: {
        displayName: dto.displayName ?? undefined,
        preferences: dto.preferences ? ({ ...(current.preferences as object), ...dto.preferences } as object) : undefined,
      },
    });
    return { user: this.auth.publicUser(user) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('verify-email')
  async verify(@Body() dto: TokenDto) {
    await this.auth.verifyEmail(dto.token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  @HttpCode(204)
  async resend(@CurrentUser() u: AuthUser) {
    await this.auth.sendVerification(u.id, u.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('reset-password')
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }
}
