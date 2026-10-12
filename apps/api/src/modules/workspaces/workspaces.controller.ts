import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import type { MemberRole } from '@prisma/client';
import { Decimal } from 'decimal.js';
import type { Request } from 'express';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { newId, randomToken, sha256Hex } from '../../common/ids';
import { clientIp } from '../../common/http';
import { env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { MailService } from '../mail/mail.service';

const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const;

class CreateWorkspaceDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name: string;
}
class InviteDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ enum: ROLES }) @IsEnum(ROLES) role: MemberRole;
}
class AcceptDto {
  @ApiProperty() @IsString() @MaxLength(200) token: string;
}
class RoleDto {
  @ApiProperty({ enum: ROLES }) @IsEnum(ROLES) role: MemberRole;
}

@ApiTags('workspaces')
@Controller()
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Get('workspaces')
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId: u.id, workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({ id: m.workspaceId, name: m.workspace.name, kind: m.workspace.kind, role: m.role }));
  }

  @Post('workspaces')
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateWorkspaceDto, @Req() req: Request) {
    const id = newId();
    const now = new Date();
    const limit = new Decimal(env().FV_DEFAULT_MONTHLY_BUDGET).toFixed(8);
    const policyId = newId();
    await this.prisma.$transaction([
      this.prisma.workspace.create({ data: { id, name: dto.name, kind: 'TEAM', ownerId: u.id } }),
      this.prisma.workspaceMember.create({ data: { workspaceId: id, userId: u.id, role: 'OWNER' } }),
      this.prisma.project.create({ data: { id: newId(), workspaceId: id, name: 'Shared Knowledge', kind: 'KNOWLEDGE', createdById: u.id } }),
      this.prisma.budgetPolicy.create({ data: { id: policyId, workspaceId: id, scope: 'WORKSPACE', limitAmount: limit } }),
      this.prisma.budgetPeriod.create({
        data: {
          id: newId(),
          workspaceId: id,
          policyId,
          periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
          periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
          limitAmount: limit,
        },
      }),
    ]);
    await this.audit.record({ workspaceId: id, actorId: u.id, action: 'workspace.create', resourceType: 'workspace', resourceId: id, ip: clientIp(req) });
    return { id, name: dto.name, kind: 'TEAM', role: 'OWNER' };
  }

  @Get('workspaces/:workspaceId')
  async get(@Param('workspaceId') workspaceId: string) {
    return this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  }

  @Get('workspaces/:workspaceId/members')
  async members(@Param('workspaceId') workspaceId: string) {
    const rows = await this.prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: true } });
    return rows.map((m) => ({ userId: m.userId, email: m.user.email, displayName: m.user.displayName, role: m.role }));
  }

  @RequireRole('ADMIN')
  @Patch('workspaces/:workspaceId/members/:userId')
  async setRole(@Param('workspaceId') workspaceId: string, @Param('userId') userId: string, @Body() dto: RoleDto, @CurrentUser() u: AuthUser) {
    const m = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!m) throw new NotFoundException();
    if (m.role === 'OWNER') throw new NotFoundException();
    await this.prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId } }, data: { role: dto.role } });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'member.role', resourceType: 'member', resourceId: userId, metadata: { role: dto.role } });
    return { userId, role: dto.role };
  }

  @RequireRole('ADMIN')
  @HttpCode(204)
  @Delete('workspaces/:workspaceId/members/:userId')
  async remove(@Param('workspaceId') workspaceId: string, @Param('userId') userId: string, @CurrentUser() u: AuthUser) {
    const m = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!m || m.role === 'OWNER') throw new NotFoundException();
    await this.prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'member.remove', resourceType: 'member', resourceId: userId });
  }

  @RequireRole('ADMIN')
  @Post('workspaces/:workspaceId/invitations')
  async invite(@Param('workspaceId') workspaceId: string, @Body() dto: InviteDto, @CurrentUser() u: AuthUser) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (ws.kind === 'PERSONAL') throw new NotFoundException('Personal workspaces cannot be shared');
    const token = randomToken(24);
    const id = newId();
    await this.prisma.invitation.create({
      data: {
        id,
        workspaceId,
        email: dto.email.toLowerCase(),
        role: dto.role === 'OWNER' ? 'ADMIN' : dto.role,
        tokenHash: sha256Hex(token),
        invitedById: u.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    await this.mail.send({
      to: dto.email,
      subject: `You're invited to ${ws.name} on FolioVerse`,
      text: `Accept the invitation: ${env().APP_ORIGIN}/accept-invite?token=${token}`,
    });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'invitation.create', resourceType: 'invitation', resourceId: id });
    return { id, email: dto.email, role: dto.role };
  }

  @Post('invitations/accept')
  async accept(@Body() dto: AcceptDto, @CurrentUser() u: AuthUser) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256Hex(dto.token) } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date() || inv.email !== u.email.toLowerCase()) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
      this.prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: u.id } },
        create: { workspaceId: inv.workspaceId, userId: u.id, role: inv.role },
        update: {},
      }),
    ]);
    return { workspaceId: inv.workspaceId };
  }

  @Get('workspaces/:workspaceId/audit')
  @RequireRole('ADMIN')
  async auditLog(@Param('workspaceId') workspaceId: string) {
    return this.prisma.auditEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
