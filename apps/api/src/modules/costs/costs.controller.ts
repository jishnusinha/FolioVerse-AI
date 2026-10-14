import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { MemberRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Decimal } from 'decimal.js';
import { AuthUser, CurrentMember, CurrentUser } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma.service';
import { BudgetService } from '../ledger/budget.service';
import { LedgerService, SETTLED } from '../ledger/ledger.service';
import { priceUsage } from '../ledger/pricing';
import { RunsService } from '../runs/runs.service';
import { DAY_MS, isoDay, utcDay } from './cost-math';

/** Spreadsheet formula injection guard for CSV cells. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

class EstimateDto {
  @ApiProperty({ example: 'mock-grounded' }) @IsString() @MaxLength(80) modelConfigId: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) calls?: number;
  @ApiProperty({ description: 'Input tokens per call (including cached)' }) @IsInt() @Min(0) inputTokens: number;
  @ApiPropertyOptional({ description: 'Of which served from the provider cache' }) @IsOptional() @IsInt() @Min(0) cachedInputTokens?: number;
  @ApiProperty() @IsInt() @Min(0) outputTokens: number;
}

const ADMIN_ROLES: MemberRole[] = ['ADMIN', 'OWNER'];

@ApiTags('costs')
@Controller('workspaces/:workspaceId/costs')
export class CostsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunsService,
    private readonly ledger: LedgerService,
    private readonly budgets: BudgetService,
  ) {}

  @Get('summary')
  async summary(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() u: AuthUser,
    @CurrentMember() m: { role: MemberRole },
    @Query('days') daysQ?: string,
    @Query('model') model?: string,
  ) {
    const days = Math.min(Math.max(Number(daysQ) || 30, 1), 365);
    const since = new Date(utcDay(new Date()).getTime() - (days - 1) * DAY_MS);
    const all = await this.prisma.costEntry.findMany({
      where: { workspaceId, createdAt: { gte: since }, entryType: { in: [...SETTLED] as any } },
      orderBy: { createdAt: 'asc' },
    });
    const entries = all.filter((e) => e.costClass === 'AI_API' && (!model || e.modelConfigId === model));
    const local = all.filter((e) => e.costClass === 'LOCAL_COMPUTE');
    const sum = (xs: typeof all) => xs.reduce((a, e) => a.plus(e.amount.toString()), new Decimal(0));
    const byKey = (xs: typeof all, key: (e: (typeof all)[number]) => string) => {
      const m = new Map<string, Decimal>();
      for (const e of xs) m.set(key(e), (m.get(key(e)) ?? new Decimal(0)).plus(e.amount.toString()));
      return [...m.entries()].map(([k, v]) => ({ key: k, amount: v.toFixed(8) })).sort((a, b) => Number(b.amount) - Number(a.amount));
    };
    const daily = new Map<string, Decimal>();
    for (let i = 0; i < days; i++) daily.set(isoDay(new Date(since.getTime() + i * DAY_MS)), new Decimal(0));
    for (const e of entries) {
      const d = isoDay(e.createdAt);
      daily.set(d, (daily.get(d) ?? new Decimal(0)).plus(e.amount.toString()));
    }

    const usageWhere = { workspaceId, createdAt: { gte: since }, ...(model ? { modelConfigId: model } : {}) };
    const [usage, localUsage, runs] = await Promise.all([
      this.prisma.usageEvent.aggregate({
        where: { ...usageWhere, costClass: 'AI_API' },
        _sum: { inputTokens: true, outputTokens: true, cachedInputTokens: true, reasoningTokens: true },
        _count: { _all: true },
      }),
      this.prisma.usageEvent.aggregate({ where: { workspaceId, createdAt: { gte: since }, costClass: 'LOCAL_COMPUTE' }, _sum: { computeSeconds: true } }),
      this.prisma.aiRun.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.runId).filter(Boolean))] as string[] } }, select: { id: true, scope: true, threadId: true } }),
    ]);

    // Project of each run: recorded at admission (scope.projectId), else the thread's project.
    const threads = await this.prisma.thread.findMany({ where: { id: { in: runs.map((r) => r.threadId).filter(Boolean) as string[] } }, select: { id: true, projectId: true } });
    const projectOfRun = new Map(runs.map((r) => [r.id, (r.scope as any)?.projectId ?? threads.find((t) => t.id === r.threadId)?.projectId ?? null]));
    const projectIds = [...new Set([...projectOfRun.values()].filter(Boolean))] as string[];
    const projects = await this.prisma.project.findMany({ where: { id: { in: projectIds }, workspaceId }, select: { id: true, name: true } });
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const byProject = byKey(entries, (e) => {
      const pid = e.runId ? projectOfRun.get(e.runId) : null;
      return pid ? (projectName.get(pid) ?? 'Deleted project') : 'No project';
    });

    let byUser: { key: string; amount: string }[] | null = null;
    if (ADMIN_ROLES.includes(m.role)) {
      const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.userId).filter(Boolean))] as string[] } }, select: { id: true, displayName: true } });
      const name = new Map(users.map((x) => [x.id, x.displayName]));
      byUser = byKey(entries, (e) => (e.userId ? (name.get(e.userId) ?? 'Former member') : 'System'));
    }
    const anomalies = await this.prisma.costAnomaly.findMany({ where: { workspaceId, day: { gte: since } }, orderBy: { day: 'desc' }, take: 10 });

    return {
      days,
      model: model ?? null,
      currency: 'USD',
      total: sum(entries).toFixed(8),
      isDemo: entries.some((e) => e.isDemo),
      byTier: byKey(entries, (e) => e.tier),
      byModel: byKey(entries, (e) => e.modelConfigId ?? 'unknown'),
      byFeature: byKey(entries, (e) => e.feature ?? 'other'),
      byClass: byKey(model ? entries : all, (e) => e.costClass),
      byProject,
      byUser,
      daily: [...daily.entries()].map(([date, amount]) => ({ date, amount: amount.toFixed(8) })),
      tokens: {
        input: usage._sum.inputTokens ?? 0,
        output: usage._sum.outputTokens ?? 0,
        cachedInput: usage._sum.cachedInputTokens ?? 0,
        reasoning: usage._sum.reasoningTokens ?? 0,
        calls: usage._count._all,
      },
      localCompute: {
        amount: sum(local).toFixed(8),
        seconds: Number(localUsage._sum.computeSeconds ?? 0),
        priced: local.length > 0 && local.every((e) => e.tier === 'FINALIZED'),
      },
      budget: await this.runs.budgetStatus(workspaceId),
      budgets: await this.budgets.status(workspaceId, { userId: u.id, seesAll: ADMIN_ROLES.includes(m.role) }),
      anomalies: anomalies.map((a) => ({ id: a.id, day: isoDay(a.day), dimension: a.dimension, key: a.key, amount: a.amount.toString(), baselineMean: a.baselineMean.toString(), zScore: a.zScore, isDemo: a.isDemo })),
    };
  }

  /** What a number of calls would cost at the model's current price. Pure arithmetic: nothing is reserved. */
  @Post('estimate')
  @HttpCode(200)
  async estimate(@Body() dto: EstimateDto) {
    const price = await this.ledger.priceFor(dto.modelConfigId);
    const calls = dto.calls ?? 1;
    const cached = Math.min(dto.cachedInputTokens ?? 0, dto.inputTokens);
    const usable = price && price.unit === 'MTOK' ? price : null;
    const per = priceUsage(
      usable
        ? {
            inputPerMTok: usable.inputPerMTok.toString(),
            outputPerMTok: usable.outputPerMTok.toString(),
            cachedInputPerMTok: usable.cachedInputPerMTok?.toString() ?? null,
            reasoningPerMTok: usable.reasoningPerMTok?.toString() ?? null,
            batchDiscount: null,
          }
        : null,
      { input: dto.inputTokens, output: dto.outputTokens, cachedInput: cached },
    );
    return {
      modelConfigId: dto.modelConfigId,
      calls,
      perCall: per.amount.toFixed(8),
      total: per.amount.mul(calls).toFixed(8),
      currency: 'USD',
      status: usable ? 'PRICED' : 'PRICE_MISSING',
      price: usable
        ? {
            inputPerMTok: usable.inputPerMTok.toString(),
            outputPerMTok: usable.outputPerMTok.toString(),
            cachedInputPerMTok: usable.cachedInputPerMTok?.toString() ?? null,
            effectiveFrom: usable.effectiveFrom,
            sourceUrl: usable.sourceUrl,
            isDemo: usable.isDemo,
          }
        : null,
    };
  }

  @Get('anomalies')
  async anomalies(@Param('workspaceId') workspaceId: string) {
    const rows = await this.prisma.costAnomaly.findMany({ where: { workspaceId }, orderBy: { day: 'desc' }, take: 50 });
    return rows.map((a) => ({ id: a.id, day: isoDay(a.day), dimension: a.dimension, key: a.key, amount: a.amount.toString(), baselineMean: a.baselineMean.toString(), zScore: a.zScore, isDemo: a.isDemo }));
  }

  @Get('entries')
  async entries(@Param('workspaceId') workspaceId: string, @Query('limit') limit?: string, @Query('runId') runId?: string) {
    return this.prisma.costEntry.findMany({
      where: { workspaceId, ...(runId ? { runId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 1000),
    });
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="folioverse-costs.csv"')
  async csv(@Param('workspaceId') workspaceId: string, @Query('days') daysQ?: string) {
    const days = Number(daysQ) > 0 ? Math.min(Number(daysQ), 3650) : null;
    const rows = await this.prisma.costEntry.findMany({
      where: { workspaceId, ...(days ? { createdAt: { gte: new Date(Date.now() - days * DAY_MS) } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 50000,
    });
    const header = ['created_at', 'entry_id', 'run_id', 'entry_type', 'tier', 'cost_class', 'model', 'feature', 'amount', 'currency', 'reason', 'supersedes_entry_id', 'is_demo'];
    const lines = rows.map((r) =>
      [r.createdAt.toISOString(), r.id, r.runId, r.entryType, r.tier, r.costClass, r.modelConfigId, r.feature, r.amount.toString(), r.currency, r.reason, r.supersedesEntryId, r.isDemo]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
  }
}
