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

  it('enforces append-only cost entries at the database boundary', async () => {
    const { workspaceId, userId } = await registered(app);
    const costId = newId();
    await prisma.costEntry.create({
      data: {
        id: costId,
        workspaceId,
        userId,
        entryType: 'FINAL',
        tier: 'FINALIZED',
        costClass: 'AI_API',
        amount: '1.25000000',
        feature: 'grounded_qa',
        isDemo: true,
      },
    });

    // Attempting to UPDATE a cost entry must be rejected by PostgreSQL trigger
    await expect(
      prisma.costEntry.update({
        where: { id: costId },
        data: { amount: '0.00000000' },
      }),
    ).rejects.toThrow(/append-only/i);

    // Attempting to DELETE a cost entry must be rejected by PostgreSQL trigger
    await expect(
      prisma.costEntry.delete({
        where: { id: costId },
      }),
    ).rejects.toThrow(/append-only/i);

    // Cost entry remains unaltered
    const entry = await prisma.costEntry.findUniqueOrThrow({ where: { id: costId } });
    expect(entry.amount.toString()).toBe('1.25');
  });

  it('repairs missing budget spend on retry if a crash occurred before spend update', async () => {
    const { workspaceId, userId } = await registered(app);
    const budgets = app.get(BudgetService);
    const cur = await budgets.currentPeriod(workspaceId);
    const beforePeriod = await prisma.budgetPeriod.findUniqueOrThrow({ where: { id: cur!.period.id } });
    const beforeSpend = new Decimal(beforePeriod.spentFinal.toString());

    const usageEventId = newId();
    await prisma.usageEvent.create({
      data: {
        id: usageEventId,
        workspaceId,
        userId,
        modelCallId: newId(),
        modelConfigId: 'mock-grounded',
        provider: 'mock',
        model: 'folioverse-mock-1',
        inputTokens: 1000,
        outputTokens: 500,
        costClass: 'AI_API',
        isDemo: true,
        processedAt: null, // Simulate crash: cost entry was created, but usageEvent was not marked processedAt and spend wasn't incremented
      },
    });

    // Simulate partial write from previous crash
    await prisma.costEntry.create({
      data: {
        id: newId(),
        workspaceId,
        userId,
        usageEventId,
        entryType: 'FINAL',
        tier: 'FINALIZED',
        costClass: 'AI_API',
        amount: '0.00125000',
        isDemo: true,
      },
    });

    // Process retry
    const ledger = app.get(LedgerService);
    const res = await ledger.processUsageEvent(usageEventId);
    expect(res).toBe('created');

    // Verify budget spend was properly repaired
    const afterPeriod = await prisma.budgetPeriod.findUniqueOrThrow({ where: { id: cur!.period.id } });
    const afterSpend = new Decimal(afterPeriod.spentFinal.toString());
    expect(afterSpend.minus(beforeSpend).toString()).toBe('0.00125');

    // And now retry is a duplicate
    expect(await ledger.processUsageEvent(usageEventId)).toBe('duplicate');
  });

  it('honestly represents unavailable provider usage when calls fail or interrupt', async () => {
    const { workspaceId, userId } = await registered(app);
    const runId = newId();
    await prisma.aiRun.create({
      data: {
        id: runId,
        workspaceId,
        userId,
        graph: 'grounded_qa',
        tier: 'T1',
        status: 'INTERRUPTED',
        input: { question: 'test' },
        modelPlan: {},
      },
    });

    // Model call was attempted but timed out / failed with unknown consumption
    await prisma.modelCall.create({
      data: {
        id: newId(),
        workspaceId,
        runId,
        modelConfigId: 'mock-grounded',
        provider: 'mock',
        model: 'folioverse-mock-1',
        status: 'ERROR',
        errorClass: 'TIMEOUT',
      },
    });

    const ledger = app.get(LedgerService);
    const totals = await ledger.runTotals(runId);
    expect(totals.unknownConsumption).toBe(true);
    expect(totals.tier).toBe('FINAL_ESTIMATED');
  });
});
