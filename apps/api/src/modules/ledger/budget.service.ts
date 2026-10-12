import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { EventsService } from '../events/events.service';

export interface ReservationResult {
  ok: boolean;
  reservationId?: string;
  periodId?: string;
  remaining?: string;
  limit?: string;
}

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Current workspace-level period, rolled forward on demand from the policy. */
  async currentPeriod(workspaceId: string) {
    const policy = await this.prisma.budgetPolicy.findFirst({ where: { workspaceId, scope: 'WORKSPACE' }, orderBy: { createdAt: 'asc' } });
    if (!policy) return null;
    const now = new Date();
    const existing = await this.prisma.budgetPeriod.findFirst({
      where: { policyId: policy.id, periodStart: { lte: now }, periodEnd: { gt: now } },
    });
    if (existing) return { policy, period: existing };
    const start =
      policy.period === 'DAILY'
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end =
      policy.period === 'DAILY'
        ? new Date(start.getTime() + 86400_000)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const period = await this.prisma.budgetPeriod.upsert({
      where: { policyId_periodStart: { policyId: policy.id, periodStart: start } },
      create: { id: newId(), workspaceId, policyId: policy.id, periodStart: start, periodEnd: end, limitAmount: policy.limitAmount },
      update: {},
    });
    return { policy, period };
  }

  /**
   * Atomically reserves `amount` against the current period. The conditional UPDATE guarantees
   * concurrent admissions can never push spent + reserved above the limit for hard budgets.
   */
  async reserve(workspaceId: string, runId: string, amount: Decimal): Promise<ReservationResult> {
    const cur = await this.currentPeriod(workspaceId);
    if (!cur) return { ok: true };
    const amt = amount.toFixed(8);
    const rows = cur.policy.hard
      ? await this.prisma.$queryRaw<{ id: string }[]>`
          UPDATE app.budget_periods
             SET reserved_open = reserved_open + ${amt}::numeric
           WHERE id = ${cur.period.id}::uuid
             AND spent_final + reserved_open + ${amt}::numeric <= limit_amount
       RETURNING id`
      : await this.prisma.$queryRaw<{ id: string }[]>`
          UPDATE app.budget_periods SET reserved_open = reserved_open + ${amt}::numeric
           WHERE id = ${cur.period.id}::uuid RETURNING id`;
    const fresh = await this.prisma.budgetPeriod.findUniqueOrThrow({ where: { id: cur.period.id } });
    const remaining = new Decimal(fresh.limitAmount.toString()).minus(fresh.spentFinal.toString()).minus(fresh.reservedOpen.toString());
    if (rows.length === 0) return { ok: false, periodId: cur.period.id, remaining: remaining.toFixed(8), limit: fresh.limitAmount.toString() };
    const reservationId = newId();
    await this.prisma.budgetReservation.create({ data: { id: reservationId, workspaceId, periodId: cur.period.id, runId, amount: amt } });
    return { ok: true, reservationId, periodId: cur.period.id, remaining: remaining.toFixed(8), limit: fresh.limitAmount.toString() };
  }

  /** Releases every OPEN reservation for a run exactly once. */
  async releaseRun(runId: string) {
    const open = await this.prisma.budgetReservation.findMany({ where: { runId, status: 'OPEN' } });
    for (const r of open) {
      const claimed = await this.prisma.budgetReservation.updateMany({
        where: { id: r.id, status: 'OPEN' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      if (claimed.count === 1) {
        await this.prisma.$executeRaw`
          UPDATE app.budget_periods SET reserved_open = GREATEST(reserved_open - ${r.amount.toString()}::numeric, 0)
           WHERE id = ${r.periodId}::uuid`;
      }
    }
  }

  /** Adds finalized spend and emits threshold alerts once per period. */
  async addSpend(workspaceId: string, amount: Decimal, periodId?: string) {
    const cur = periodId ? { period: await this.prisma.budgetPeriod.findUnique({ where: { id: periodId } }) } : await this.currentPeriod(workspaceId);
    const period = cur?.period;
    if (!period) return;
    await this.prisma.$executeRaw`
      UPDATE app.budget_periods SET spent_final = spent_final + ${amount.toFixed(8)}::numeric WHERE id = ${period.id}::uuid`;
    const fresh = await this.prisma.budgetPeriod.findUniqueOrThrow({ where: { id: period.id }, include: { policy: true } });
    const limit = new Decimal(fresh.limitAmount.toString());
    if (limit.lte(0)) return;
    const pct = new Decimal(fresh.spentFinal.toString()).div(limit).mul(100).toNumber();
    for (const t of fresh.policy.alertThresholds) {
      if (pct >= t && !fresh.alertsSent.includes(t)) {
        await this.prisma.budgetPeriod.update({ where: { id: fresh.id }, data: { alertsSent: { push: t } } });
        await this.events.publishWorkspace(workspaceId, 'notification', {
          kind: 'BUDGET_ALERT',
          threshold: t,
          spent: fresh.spentFinal.toString(),
          limit: fresh.limitAmount.toString(),
        });
        const members = await this.prisma.workspaceMember.findMany({ where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } } });
        for (const m of members) {
          await this.prisma.notification.create({
            data: {
              id: newId(),
              workspaceId,
              userId: m.userId,
              kind: 'BUDGET_ALERT',
              title: `AI budget ${t}% used`,
              body: `Spent ${fresh.spentFinal.toString()} of ${fresh.limitAmount.toString()} ${fresh.policy.currency} this period.`,
              link: '/app/costs',
            },
          });
        }
      }
    }
  }
}
