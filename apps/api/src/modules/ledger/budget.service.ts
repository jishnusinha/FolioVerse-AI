import { Injectable } from '@nestjs/common';
import type { BudgetPeriod, BudgetPolicy, Prisma } from '@prisma/client';
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
  hard?: boolean;
  /** Scope of the policy that rejected (or most constrains) the run. */
  scope?: BudgetPolicy['scope'];
  policyId?: string;
}

/** Who and what a run is charged to: every matching policy applies. */
export interface BudgetContext {
  userId?: string | null;
  projectId?: string | null;
}

export function periodBounds(kind: BudgetPolicy['period'], now = new Date()) {
  const start =
    kind === 'DAILY'
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = kind === 'DAILY' ? new Date(start.getTime() + 86400_000) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

const remainingOf = (p: Pick<BudgetPeriod, 'limitAmount' | 'spentFinal' | 'reservedOpen'>) =>
  new Decimal(p.limitAmount.toString()).minus(p.spentFinal.toString()).minus(p.reservedOpen.toString());

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Workspace policy plus the caller's personal and the project's policy, when they exist. */
  async policiesFor(workspaceId: string, ctx: BudgetContext = {}) {
    const or: Prisma.BudgetPolicyWhereInput[] = [{ scope: 'WORKSPACE' }];
    if (ctx.userId) or.push({ scope: 'USER', scopeRefId: ctx.userId });
    if (ctx.projectId) or.push({ scope: 'PROJECT', scopeRefId: ctx.projectId });
    return this.prisma.budgetPolicy.findMany({ where: { workspaceId, OR: or }, orderBy: { createdAt: 'asc' } });
  }

  /** The policy's period containing now, created on demand with the policy's current limit. */
  async periodOf(policy: BudgetPolicy) {
    const now = new Date();
    const existing = await this.prisma.budgetPeriod.findFirst({ where: { policyId: policy.id, periodStart: { lte: now }, periodEnd: { gt: now } } });
    if (existing) return existing;
    const { start, end } = periodBounds(policy.period, now);
    return this.prisma.budgetPeriod.upsert({
      where: { policyId_periodStart: { policyId: policy.id, periodStart: start } },
      create: { id: newId(), workspaceId: policy.workspaceId, policyId: policy.id, periodStart: start, periodEnd: end, limitAmount: policy.limitAmount },
      update: {},
    });
  }

  /** Current workspace-level period, rolled forward on demand from the policy. */
  async currentPeriod(workspaceId: string) {
    const policy = await this.prisma.budgetPolicy.findFirst({ where: { workspaceId, scope: 'WORKSPACE' }, orderBy: { createdAt: 'asc' } });
    if (!policy) return null;
    return { policy, period: await this.periodOf(policy) };
  }

  /**
   * Reserves `amount` against every applicable policy. Each hard policy uses a conditional UPDATE so concurrent
   * admissions can never push spent + reserved above its limit; if one rejects, reservations already taken for
   * this run are released before returning.
   */
  async reserve(workspaceId: string, runId: string, amount: Decimal, ctx: BudgetContext = {}): Promise<ReservationResult> {
    const policies = await this.policiesFor(workspaceId, ctx);
    if (!policies.length) return { ok: true };
    const amt = amount.toFixed(8);
    const taken: { id: string; periodId: string }[] = [];
    let binding: { remaining: Decimal; limit: string; policy: BudgetPolicy } | null = null;
    for (const policy of policies) {
      const period = await this.periodOf(policy);
      const rows = policy.hard
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE app.budget_periods
               SET reserved_open = reserved_open + ${amt}::numeric
             WHERE id = ${period.id}::uuid
               AND spent_final + reserved_open + ${amt}::numeric <= limit_amount
         RETURNING id`
        : await this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE app.budget_periods SET reserved_open = reserved_open + ${amt}::numeric
             WHERE id = ${period.id}::uuid RETURNING id`;
      const fresh = await this.prisma.budgetPeriod.findUniqueOrThrow({ where: { id: period.id } });
      const remaining = remainingOf(fresh);
      if (rows.length === 0) {
        for (const t of taken) await this.releaseOne(t.id);
        return { ok: false, periodId: period.id, remaining: remaining.toFixed(8), limit: fresh.limitAmount.toString(), hard: true, scope: policy.scope, policyId: policy.id };
      }
      const id = newId();
      await this.prisma.budgetReservation.create({ data: { id, workspaceId, periodId: period.id, runId, amount: amt } });
      taken.push({ id, periodId: period.id });
      if (policy.hard && (!binding || remaining.lt(binding.remaining))) binding = { remaining, limit: fresh.limitAmount.toString(), policy };
      if (!binding && policy.scope === 'WORKSPACE') binding = { remaining, limit: fresh.limitAmount.toString(), policy };
    }
    return {
      ok: true,
      reservationId: taken[0].id,
      periodId: taken[0].periodId,
      remaining: binding?.remaining.toFixed(8),
      limit: binding?.limit,
      hard: !!binding?.policy.hard,
      scope: binding?.policy.scope,
      policyId: binding?.policy.id,
    };
  }

  private async releaseOne(reservationId: string) {
    const r = await this.prisma.budgetReservation.findUnique({ where: { id: reservationId } });
    if (!r) return;
    const claimed = await this.prisma.budgetReservation.updateMany({ where: { id: r.id, status: 'OPEN' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    if (claimed.count === 1) {
      await this.prisma.$executeRaw`
        UPDATE app.budget_periods SET reserved_open = GREATEST(reserved_open - ${r.amount.toString()}::numeric, 0)
         WHERE id = ${r.periodId}::uuid`;
    }
  }

  /** Releases every OPEN reservation for a run exactly once. */
  async releaseRun(runId: string) {
    const open = await this.prisma.budgetReservation.findMany({ where: { runId, status: 'OPEN' } });
    for (const r of open) await this.releaseOne(r.id);
  }

  /**
   * Adds finalized AI spend to every period the run reserved against (or, without a run, to the current periods of
   * the workspace and user policies) and emits threshold alerts once per period.
   */
  async addSpend(workspaceId: string, amount: Decimal, opts: { runId?: string | null; userId?: string | null } = {}) {
    const reserved = opts.runId ? await this.prisma.budgetReservation.findMany({ where: { runId: opts.runId }, select: { periodId: true } }) : [];
    let periodIds = [...new Set(reserved.map((r) => r.periodId))];
    if (!periodIds.length) {
      const policies = await this.policiesFor(workspaceId, { userId: opts.userId });
      periodIds = (await Promise.all(policies.map((p) => this.periodOf(p)))).map((p) => p.id);
    }
    for (const periodId of periodIds) {
      const n = await this.prisma.$executeRaw`
        UPDATE app.budget_periods SET spent_final = spent_final + ${amount.toFixed(8)}::numeric WHERE id = ${periodId}::uuid`;
      if (n) await this.alertIfCrossed(workspaceId, periodId);
    }
  }

  private async alertIfCrossed(workspaceId: string, periodId: string) {
    const fresh = await this.prisma.budgetPeriod.findUniqueOrThrow({ where: { id: periodId }, include: { policy: true } });
    const limit = new Decimal(fresh.limitAmount.toString());
    if (limit.lte(0)) return;
    const pct = new Decimal(fresh.spentFinal.toString()).div(limit).mul(100).toNumber();
    const policy = fresh.policy;
    for (const t of [...policy.alertThresholds].sort((a, b) => a - b)) {
      if (pct < t || fresh.alertsSent.includes(t)) continue;
      // Claim the threshold atomically so concurrent ledger jobs alert once.
      const claimed = await this.prisma.$executeRaw`
        UPDATE app.budget_periods SET alerts_sent = array_append(alerts_sent, ${t}::int)
         WHERE id = ${fresh.id}::uuid AND NOT (${t}::int = ANY(alerts_sent))`;
      if (!claimed) continue;
      const label = await this.scopeLabel(policy);
      await this.events.publishWorkspace(workspaceId, 'notification', {
        kind: 'BUDGET_ALERT',
        scope: policy.scope,
        policyId: policy.id,
        threshold: t,
        spent: fresh.spentFinal.toString(),
        limit: fresh.limitAmount.toString(),
      });
      const recipients =
        policy.scope === 'USER' && policy.scopeRefId
          ? [policy.scopeRefId]
          : (await this.prisma.workspaceMember.findMany({ where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } } })).map((m) => m.userId);
      for (const userId of recipients) {
        await this.prisma.notification.create({
          data: {
            id: newId(),
            workspaceId,
            userId,
            kind: 'BUDGET_ALERT',
            title: `${label} ${t}% used`,
            body: `Spent ${fresh.spentFinal.toString()} of ${fresh.limitAmount.toString()} ${policy.currency} this ${policy.period === 'DAILY' ? 'day' : 'month'}.`,
            link: '/app/costs',
          },
        });
      }
    }
  }

  async scopeLabel(policy: Pick<BudgetPolicy, 'scope' | 'scopeRefId'>) {
    if (policy.scope === 'USER' && policy.scopeRefId) {
      const u = await this.prisma.user.findUnique({ where: { id: policy.scopeRefId }, select: { displayName: true } });
      return `${u?.displayName ?? 'Member'}’s AI budget`;
    }
    if (policy.scope === 'PROJECT' && policy.scopeRefId) {
      const p = await this.prisma.project.findUnique({ where: { id: policy.scopeRefId }, select: { name: true } });
      return `Project “${p?.name ?? 'project'}” AI budget`;
    }
    return 'Workspace AI budget';
  }

  /** Policies with their current period, for display. Non-admins see workspace, project and their own budgets. */
  async status(workspaceId: string, viewer: { userId: string; seesAll: boolean }) {
    const policies = await this.prisma.budgetPolicy.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    const visible = policies.filter((p) => viewer.seesAll || p.scope !== 'USER' || p.scopeRefId === viewer.userId);
    return Promise.all(
      visible.map(async (p) => {
        const period = await this.periodOf(p);
        return {
          id: p.id,
          scope: p.scope,
          scopeRefId: p.scopeRefId,
          label: await this.scopeLabel(p),
          period: p.period,
          hard: p.hard,
          currency: p.currency,
          alertThresholds: p.alertThresholds,
          limit: p.limitAmount.toString(),
          current: {
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            limit: period.limitAmount.toString(),
            spent: period.spentFinal.toString(),
            reserved: period.reservedOpen.toString(),
            remaining: remainingOf(period).toFixed(8),
            alertsSent: period.alertsSent,
          },
        };
      }),
    );
  }
}
