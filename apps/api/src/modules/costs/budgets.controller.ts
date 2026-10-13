import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { MemberRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentMember, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { BudgetService } from '../ledger/budget.service';

const DEC = /^\d{1,10}(\.\d{1,8})?$/;

class BudgetDto {
  @ApiProperty({ enum: ['WORKSPACE', 'PROJECT', 'USER'] }) @IsIn(['WORKSPACE', 'PROJECT', 'USER']) scope: 'WORKSPACE' | 'PROJECT' | 'USER';
  @ApiPropertyOptional({ description: 'Project id (PROJECT) or member user id (USER)' }) @IsOptional() @IsUUID() scopeRefId?: string;
  @ApiPropertyOptional({ enum: ['DAILY', 'MONTHLY'], default: 'MONTHLY' }) @IsOptional() @IsIn(['DAILY', 'MONTHLY']) period?: 'DAILY' | 'MONTHLY';
  @ApiProperty({ example: '10.00' }) @Matches(DEC) limitAmount: string;
  @ApiPropertyOptional({ description: 'Hard limits reject runs that could exceed them; soft limits only alert', default: true }) @IsOptional() @IsBoolean() hard?: boolean;
  @ApiPropertyOptional({ type: [Number], default: [75, 90, 100] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsInt({ each: true }) @Min(1, { each: true }) @Max(100, { each: true }) alertThresholds?: number[];
}

class BudgetPatchDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) limitAmount?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hard?: boolean;
  @ApiPropertyOptional({ enum: ['DAILY', 'MONTHLY'] }) @IsOptional() @IsIn(['DAILY', 'MONTHLY']) period?: 'DAILY' | 'MONTHLY';
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsInt({ each: true }) @Min(1, { each: true }) @Max(100, { each: true }) alertThresholds?: number[];
}

const ADMIN_ROLES: MemberRole[] = ['ADMIN', 'OWNER'];

@ApiTags('costs')
@Controller('workspaces/:workspaceId/budgets')
export class BudgetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BudgetService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @CurrentMember() m: { role: MemberRole }) {
    return this.budgets.status(workspaceId, { userId: u.id, seesAll: ADMIN_ROLES.includes(m.role) });
  }

  @Post()
  @RequireRole('ADMIN')
  async create(@Param('workspaceId') workspaceId: string, @Body() dto: BudgetDto, @CurrentUser() u: AuthUser) {
    const scopeRefId = dto.scope === 'WORKSPACE' ? null : (dto.scopeRefId ?? null);
    if (dto.scope !== 'WORKSPACE' && !scopeRefId) throw new BadRequestException({ message: 'Pick the project or member this budget applies to', code: 'SCOPE_REF_REQUIRED' });
    if (dto.scope === 'PROJECT' && !(await this.prisma.project.findFirst({ where: { id: scopeRefId!, workspaceId, deletedAt: null } }))) {
      throw new BadRequestException({ message: 'Project not found in this workspace', code: 'SCOPE_REF_INVALID' });
    }
    if (dto.scope === 'USER' && !(await this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: scopeRefId! } }))) {
      throw new BadRequestException({ message: 'That person is not a member of this workspace', code: 'SCOPE_REF_INVALID' });
    }
    if (await this.prisma.budgetPolicy.findFirst({ where: { workspaceId, scope: dto.scope, scopeRefId } })) {
      throw new ConflictException({ message: 'A budget for this scope already exists; edit it instead', code: 'BUDGET_EXISTS' });
    }
    const id = newId();
    await this.prisma.budgetPolicy.create({
      data: {
        id,
        workspaceId,
        scope: dto.scope,
        scopeRefId,
        period: dto.period ?? 'MONTHLY',
        limitAmount: dto.limitAmount,
        hard: dto.hard ?? true,
        alertThresholds: [...new Set(dto.alertThresholds ?? [75, 90, 100])].sort((a, b) => a - b),
      },
    });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'budget.create', resourceType: 'budget_policy', resourceId: id, metadata: { scope: dto.scope, limit: dto.limitAmount, hard: dto.hard ?? true } });
    return (await this.budgets.status(workspaceId, { userId: u.id, seesAll: true })).find((b) => b.id === id);
  }

  @Patch(':policyId')
  @RequireRole('ADMIN')
  async update(@Param('workspaceId') workspaceId: string, @Param('policyId') policyId: string, @Body() dto: BudgetPatchDto, @CurrentUser() u: AuthUser) {
    const p = isUuid(policyId) ? await this.prisma.budgetPolicy.findFirst({ where: { id: policyId, workspaceId } }) : null;
    if (!p) throw new NotFoundException();
    const updated = await this.prisma.budgetPolicy.update({
      where: { id: p.id },
      data: {
        ...(dto.limitAmount ? { limitAmount: dto.limitAmount } : {}),
        ...(dto.hard !== undefined ? { hard: dto.hard } : {}),
        ...(dto.period ? { period: dto.period } : {}),
        ...(dto.alertThresholds ? { alertThresholds: [...new Set(dto.alertThresholds)].sort((a, b) => a - b) } : {}),
      },
    });
    // The running period takes the new limit; a period change starts a fresh period on next use.
    const now = new Date();
    if (dto.limitAmount) {
      await this.prisma.budgetPeriod.updateMany({ where: { policyId: p.id, periodStart: { lte: now }, periodEnd: { gt: now } }, data: { limitAmount: dto.limitAmount } });
    }
    if (dto.period && dto.period !== p.period) {
      await this.prisma.budgetPeriod.updateMany({ where: { policyId: p.id, periodEnd: { gt: now } }, data: { periodEnd: now } });
    }
    await this.audit.record({ workspaceId, actorId: u.id, action: 'budget.update', resourceType: 'budget_policy', resourceId: p.id, metadata: { ...dto } });
    return (await this.budgets.status(workspaceId, { userId: u.id, seesAll: true })).find((b) => b.id === updated.id);
  }

  @Delete(':policyId')
  @RequireRole('ADMIN')
  @HttpCode(204)
  async remove(@Param('workspaceId') workspaceId: string, @Param('policyId') policyId: string, @CurrentUser() u: AuthUser) {
    const p = isUuid(policyId) ? await this.prisma.budgetPolicy.findFirst({ where: { id: policyId, workspaceId } }) : null;
    if (!p) throw new NotFoundException();
    const periods = await this.prisma.budgetPeriod.findMany({ where: { policyId: p.id }, select: { id: true } });
    const open = await this.prisma.budgetReservation.count({ where: { periodId: { in: periods.map((x) => x.id) }, status: 'OPEN' } });
    if (open) throw new ConflictException({ message: 'Runs are still holding reservations against this budget; try again when they finish', code: 'BUDGET_IN_USE' });
    await this.prisma.budgetPolicy.delete({ where: { id: p.id } });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'budget.delete', resourceType: 'budget_policy', resourceId: p.id, metadata: { scope: p.scope } });
  }
}
