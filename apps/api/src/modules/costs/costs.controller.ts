import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../infra/prisma.service';
import { RunsService } from '../runs/runs.service';

/** Spreadsheet formula injection guard for CSV cells. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@ApiTags('costs')
@Controller('workspaces/:workspaceId/costs')
export class CostsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunsService,
  ) {}

  @Get('summary')
  async summary(@Param('workspaceId') workspaceId: string, @Query('days') daysQ?: string) {
    const days = Math.min(Math.max(Number(daysQ) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86400_000);
    const entries = await this.prisma.costEntry.findMany({
      where: { workspaceId, createdAt: { gte: since }, entryType: { in: ['FINAL', 'RECONCILIATION'] } },
      orderBy: { createdAt: 'asc' },
    });
    const byKey = (key: (e: (typeof entries)[number]) => string) => {
      const m = new Map<string, Decimal>();
      for (const e of entries) m.set(key(e), (m.get(key(e)) ?? new Decimal(0)).plus(e.amount.toString()));
      return [...m.entries()].map(([k, v]) => ({ key: k, amount: v.toFixed(8) })).sort((a, b) => Number(b.amount) - Number(a.amount));
    };
    const daily = new Map<string, Decimal>();
    for (let i = days - 1; i >= 0; i--) daily.set(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), new Decimal(0));
    for (const e of entries) {
      const d = e.createdAt.toISOString().slice(0, 10);
      daily.set(d, (daily.get(d) ?? new Decimal(0)).plus(e.amount.toString()));
    }
    const usage = await this.prisma.usageEvent.aggregate({
      where: { workspaceId, createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, cachedInputTokens: true, reasoningTokens: true },
      _count: { _all: true },
    });
    const total = entries.reduce((a, e) => a.plus(e.amount.toString()), new Decimal(0));
    return {
      days,
      currency: 'USD',
      total: total.toFixed(8),
      isDemo: entries.some((e) => e.isDemo),
      byTier: byKey((e) => e.tier),
      byModel: byKey((e) => e.modelConfigId ?? 'unknown'),
      byFeature: byKey((e) => e.feature ?? 'other'),
      byClass: byKey((e) => e.costClass),
      daily: [...daily.entries()].map(([date, amount]) => ({ date, amount: amount.toFixed(8) })),
      tokens: {
        input: usage._sum.inputTokens ?? 0,
        output: usage._sum.outputTokens ?? 0,
        cachedInput: usage._sum.cachedInputTokens ?? 0,
        reasoning: usage._sum.reasoningTokens ?? 0,
        calls: usage._count._all,
      },
      budget: await this.runs.budgetStatus(workspaceId),
    };
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
  async csv(@Param('workspaceId') workspaceId: string) {
    const rows = await this.prisma.costEntry.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, take: 50000 });
    const header = ['created_at', 'run_id', 'entry_type', 'tier', 'cost_class', 'model', 'feature', 'amount', 'currency', 'reason', 'is_demo'];
    const lines = rows.map((r) =>
      [r.createdAt.toISOString(), r.runId, r.entryType, r.tier, r.costClass, r.modelConfigId, r.feature, r.amount.toString(), r.currency, r.reason, r.isDemo]
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n') + '\n';
  }
}
