import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { EventsService } from '../events/events.service';
import { anomalyScore, DAY_MS, isoDay, utcDay } from './cost-math';

/** Rollup dimensions; keys come from whitelisted SQL expressions only. */
export const DIMENSIONS = {
  total: Prisma.sql`'all'`,
  user: Prisma.sql`COALESCE(user_id::text, 'none')`,
  model: Prisma.sql`COALESCE(model_config_id, 'unknown')`,
  feature: Prisma.sql`COALESCE(feature, 'other')`,
  class: Prisma.sql`cost_class::text`,
} as const;
export type Dimension = keyof typeof DIMENSIONS;

const GRANULARITY = { HOUR: 'hour', DAY: 'day' } as const;
const BASELINE_DAYS = 14;

@Injectable()
export class CostRollupService {
  private readonly log = new Logger('CostRollup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Recomputes hourly and daily buckets touched since `days` ago from settled ledger entries. Buckets are rebuilt
   * whole (the window starts on a bucket boundary), so running it again is a no-op.
   */
  async rollup(days = 2) {
    const since = utcDay(Date.now() - (days - 1) * DAY_MS);
    let rows = 0;
    for (const [granularity, unit] of Object.entries(GRANULARITY)) {
      for (const [dimension, expr] of Object.entries(DIMENSIONS)) {
        const trunc = Prisma.sql`date_trunc(${Prisma.raw(`'${unit}'`)}, created_at)`;
        rows += await this.prisma.$executeRaw`
          INSERT INTO app.cost_rollups (id, workspace_id, granularity, bucket_start, dimension, key, amount, entries, is_demo, updated_at)
          SELECT gen_random_uuid(), workspace_id, ${granularity}, ${trunc}, ${dimension}, ${expr}, SUM(amount), COUNT(*)::int, bool_or(is_demo), now()
            FROM app.cost_entries
           WHERE entry_type IN ('FINAL', 'RECONCILIATION', 'VARIANCE') AND created_at >= ${since}
           GROUP BY 2, 4, 6
          ON CONFLICT (workspace_id, granularity, bucket_start, dimension, key)
          DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries, is_demo = EXCLUDED.is_demo, updated_at = now()`;
      }
    }
    const anomalies = await this.detectAnomalies();
    return { since, rows, anomalies };
  }

  /**
   * Flags yesterday and today when a workspace's daily spend (in total and per feature) is `FV_ANOMALY_Z` standard
   * deviations above its trailing 14-day baseline. Each anomaly is stored and announced once.
   */
  async detectAnomalies(now = new Date()) {
    const today = utcDay(now);
    const from = new Date(today.getTime() - (BASELINE_DAYS + 1) * DAY_MS);
    const rows = await this.prisma.costRollup.findMany({
      where: { granularity: 'DAY', dimension: { in: ['total', 'feature'] }, bucketStart: { gte: from } },
    });
    const series = new Map<string, { workspaceId: string; dimension: string; key: string; byDay: Map<string, number>; isDemo: boolean }>();
    for (const r of rows) {
      const id = `${r.workspaceId}|${r.dimension}|${r.key}`;
      const s = series.get(id) ?? { workspaceId: r.workspaceId, dimension: r.dimension, key: r.key, byDay: new Map(), isDemo: false };
      s.byDay.set(isoDay(r.bucketStart), Number(r.amount));
      s.isDemo ||= r.isDemo;
      series.set(id, s);
    }
    const opts = { z: Number(env().FV_ANOMALY_Z), minAmount: Number(env().FV_ANOMALY_MIN_USD), minDays: 7 };
    let created = 0;
    for (const s of series.values()) {
      for (const target of [new Date(today.getTime() - DAY_MS), today]) {
        const value = s.byDay.get(isoDay(target)) ?? 0;
        const baseline = Array.from({ length: BASELINE_DAYS }, (_, i) => s.byDay.get(isoDay(new Date(target.getTime() - (i + 1) * DAY_MS))) ?? 0);
        const score = anomalyScore(baseline, value, opts);
        if (!score?.flagged) continue;
        try {
          await this.prisma.costAnomaly.create({
            data: {
              id: newId(),
              workspaceId: s.workspaceId,
              day: target,
              dimension: s.dimension,
              key: s.key,
              amount: value.toFixed(8),
              baselineMean: score.mean.toFixed(8),
              baselineStd: score.std.toFixed(8),
              zScore: Math.round(score.z * 100) / 100,
              isDemo: s.isDemo,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
          throw e;
        }
        created++;
        await this.announce(s.workspaceId, s.dimension, s.key, value, score.mean, target);
      }
    }
    if (created) this.log.log(`${created} cost anomalies flagged`);
    return created;
  }

  private async announce(workspaceId: string, dimension: string, key: string, value: number, mean: number, day: Date) {
    const what = dimension === 'total' ? 'AI spend' : `AI spend on ${key}`;
    const ratio = mean > 0 ? `${(value / mean).toFixed(1)}×` : 'well above';
    await this.events.publishWorkspace(workspaceId, 'notification', { kind: 'COST_ANOMALY', dimension, key, day: isoDay(day) });
    const admins = await this.prisma.workspaceMember.findMany({ where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } } });
    for (const m of admins) {
      await this.prisma.notification.create({
        data: {
          id: newId(),
          workspaceId,
          userId: m.userId,
          kind: 'COST_ANOMALY',
          title: `Unusual ${what} on ${isoDay(day)}`,
          body: `$${value.toFixed(4)} is ${ratio} the 14-day average.`,
          link: '/app/costs',
        },
      });
    }
  }
}
