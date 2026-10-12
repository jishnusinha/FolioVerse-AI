import type { INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { newId } from '../../src/common/ids';
import { PrismaService } from '../../src/infra/prisma.service';
import { BudgetService } from '../../src/modules/ledger/budget.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { createApp, registered } from './harness';

let app: INestApplication;
let prisma: PrismaService;
beforeAll(async () => {
  app = await createApp();
  prisma = app.get(PrismaService);
  await app.get(ModelsService).ensureSeeded();
});
afterAll(async () => app?.close());

describe('ledger', () => {
  it('turns a usage event into exactly one FINAL cost entry (idempotent)', async () => {
    const { workspaceId, userId } = await registered(app);
    const id = newId();
    await prisma.usageEvent.create({
      data: { id, workspaceId, userId, modelCallId: newId(), modelConfigId: 'mock-grounded', provider: 'mock', model: 'folioverse-mock-1', inputTokens: 1000, outputTokens: 500, isDemo: true },
    });
    const ledger = app.get(LedgerService);
    expect(await ledger.processUsageEvent(id)).toBe('created');
    expect(await ledger.processUsageEvent(id)).toBe('duplicate');
    const entries = await prisma.costEntry.findMany({ where: { usageEventId: id } });
    expect(entries).toHaveLength(1);
    // DEMO price 0.50 / 1.50 per 1M tokens: 1000 * 0.5e-6 + 500 * 1.5e-6
    expect(entries[0].amount.toString()).toBe('0.00125');
    expect(entries[0]).toMatchObject({ tier: 'FINALIZED', isDemo: true });
  });

  it('missing price yields FINAL_ESTIMATED at zero, never a guessed amount', async () => {
    const { workspaceId } = await registered(app);
    const id = newId();
    await prisma.usageEvent.create({ data: { id, workspaceId, modelConfigId: 'no-such-model', provider: 'openai', model: 'unpriced', inputTokens: 10, outputTokens: 10 } });
    await app.get(LedgerService).processUsageEvent(id);
    const e = await prisma.costEntry.findFirstOrThrow({ where: { usageEventId: id } });
    expect(e).toMatchObject({ tier: 'FINAL_ESTIMATED', reason: 'PRICE_MISSING' });
    expect(e.amount.toString()).toBe('0');
  });

  it('concurrent reservations never exceed a hard budget', async () => {
    const { workspaceId } = await registered(app);
    const budgets = app.get(BudgetService);
    const cur = await budgets.currentPeriod(workspaceId);
    await prisma.budgetPolicy.update({ where: { id: cur!.policy.id }, data: { hard: true } });
    await prisma.budgetPeriod.update({ where: { id: cur!.period.id }, data: { limitAmount: '5.00' } });
    const results = await Promise.all(Array.from({ length: 12 }, () => budgets.reserve(workspaceId, newId(), new Decimal('1.00'))));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const period = await prisma.budgetPeriod.findUniqueOrThrow({ where: { id: cur!.period.id } });
    expect(period.reservedOpen.toString()).toBe('5');
  });
});
