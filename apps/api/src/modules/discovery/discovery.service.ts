import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { CatalogItem, Feedback, ItemTheme, Prisma } from '@prisma/client';
import { isUuid, newId } from '../../common/ids';
import { rootLogger } from '../../common/logger';
import { PrismaService } from '../../infra/prisma.service';
import { QUEUES, QueuesService } from '../../infra/queues.service';
import { AiClientService, AiServiceError } from '../ai-client/ai-client.service';

export const FEEDBACK_ACTIONS = ['SAVE', 'UNSAVE', 'LIKE', 'DISLIKE', 'CLEAR_RATING', 'DISMISS', 'UNDISMISS', 'CLICK'] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];
export type RecFactor = 'semantic' | 'tfidf' | 'theme' | 'preference' | 'prior';

export interface RecommendInput {
  query?: string;
  kind?: 'BOOK' | 'FILM';
  genres?: string[];
  moods?: string[];
  k?: number;
  lab?: { weights?: Partial<Record<RecFactor, number>>; lambda?: number; perCreator?: number; balanceMedia?: boolean };
}

type CatalogRow = CatalogItem & { themes: ItemTheme[] };
type FeedbackState = Pick<Feedback, 'saved' | 'rating' | 'dismissed' | 'libraryItemId'>;

const CONTEXT_BOOKS = 12;
const RECENT_CLICKS = 20;
const RECENT_DAYS = 30;

/** Public shape of a catalog item, with the member's feedback when known. */
export function presentItem(i: CatalogRow, fb?: FeedbackState | null) {
  return {
    id: i.id,
    slug: i.slug,
    kind: i.kind,
    title: i.title,
    creators: i.creators,
    year: i.year,
    genres: i.genres,
    moods: i.moods,
    themes: [...i.themes].sort((a, b) => b.weight - a.weight).map((t) => t.theme),
    description: i.description,
    franchise: i.franchise,
    length: i.length,
    quality: i.quality,
    popularity: i.popularity,
    coverTone: i.coverTone,
    isDemo: i.isDemo,
    feedback: { saved: fb?.saved ?? false, rating: fb?.rating ?? null, dismissed: fb?.dismissed ?? false, libraryItemId: fb?.libraryItemId ?? null },
  };
}

/**
 * Discovery: builds a member's taste profile from onboarding, feedback, recent clicks and their Library,
 * asks the AI service to rank the catalog, and logs every call (inputs, weights, model version, stage
 * counts, factor values) so the Recommendation Lab and offline evaluation work from recorded data.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly queues: QueuesService,
  ) {}

  /** Any failure reaching the AI service (HTTP error, refused connection, timeout) surfaces as a 503. */
  private unavailable(e: unknown): never {
    rootLogger.warn({ status: e instanceof AiServiceError ? e.status : null, error: e instanceof Error ? e.name : 'unknown' }, 'recommender unavailable');
    throw new ServiceUnavailableException({ message: 'The recommender is not available right now', code: 'RECOMMENDER_UNAVAILABLE' });
  }

  async catalogRows(ids: string[]): Promise<Map<string, CatalogRow>> {
    const rows = await this.prisma.catalogItem.findMany({ where: { id: { in: ids.filter(isUuid) } }, include: { themes: true } });
    return new Map(rows.map((r) => [r.id, r]));
  }

  async feedbackFor(workspaceId: string, userId: string, ids: string[]): Promise<Map<string, Feedback>> {
    const rows = await this.prisma.feedback.findMany({ where: { workspaceId, userId, itemId: { in: ids } } });
    return new Map(rows.map((r) => [r.itemId, r]));
  }

  async catalogItem(workspaceId: string, userId: string, itemId: string) {
    if (!isUuid(itemId)) throw new NotFoundException('Title not found');
    const row = await this.prisma.catalogItem.findUnique({ where: { id: itemId }, include: { themes: true } });
    if (!row) throw new NotFoundException('Title not found');
    const fb = await this.prisma.feedback.findUnique({ where: { workspaceId_userId_itemId: { workspaceId, userId, itemId } } });
    return presentItem(row, fb);
  }

  /** The profile sent to the recommender. Nothing here leaves the platform except to the internal AI service. */
  async profile(workspaceId: string, userId: string, query?: string) {
    const [taste, feedback, clicks, shelf] = await Promise.all([
      this.prisma.tasteProfile.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }),
      this.prisma.feedback.findMany({ where: { workspaceId, userId } }),
      this.prisma.interaction.findMany({
        where: { workspaceId, userId, kind: { in: ['CLICK', 'EXPLAIN'] }, createdAt: { gte: new Date(Date.now() - RECENT_DAYS * 86_400_000) } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_CLICKS,
        select: { itemId: true },
      }),
      this.prisma.libraryItem.findMany({
        where: { workspaceId, userId, OR: [{ status: { in: ['READING', 'FINISHED'] } }, { rating: { gte: 4 } }] },
        include: { book: true },
        orderBy: [{ lastOpenedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: CONTEXT_BOOKS,
      }),
    ]);
    const positives: Record<string, number> = {};
    const bump = (id: string, w: number) => (positives[id] = Math.max(positives[id] ?? 0, w));
    for (const id of taste?.seedItemIds ?? []) bump(id, 0.8);
    for (const c of clicks) bump(c.itemId, 0.3);
    const negatives: string[] = [];
    const exclude = new Set<string>();
    for (const f of feedback) {
      if (f.saved || f.rating === 1) bump(f.itemId, 1);
      if (f.rating === -1 || f.dismissed) negatives.push(f.itemId);
      if (f.saved || f.rating !== null || f.dismissed) exclude.add(f.itemId);
    }
    for (const n of negatives) delete positives[n];
    const context: { title: string; text: string; weight: number }[] = [];
    for (const li of shelf) {
      const catalogId = (li.book.externalIds as Record<string, unknown> | null)?.catalogId;
      const weight = li.status === 'FINISHED' && (li.rating ?? 0) >= 4 ? 1 : li.status === 'READING' ? 0.9 : 0.7;
      if (typeof catalogId === 'string') bump(catalogId, weight);
      else context.push({ title: li.book.title, text: [li.book.title, li.book.subtitle, li.book.description, li.book.subjects.join(', ')].filter(Boolean).join('. '), weight });
    }
    return {
      positives,
      negatives,
      exclude: [...exclude],
      genres: taste?.genres ?? [],
      moods: taste?.moods ?? [],
      themes: taste?.themes ?? [],
      query: query?.trim() ?? '',
      context,
    };
  }

  async recommend(workspaceId: string, userId: string, input: RecommendInput) {
    const setId = newId();
    const profile = await this.profile(workspaceId, userId, input.query);
    const request = {
      k: input.k ?? 12,
      kind: input.kind,
      genres: input.genres ?? [],
      moods: input.moods ?? [],
      ...(input.lab ? { weights: input.lab.weights, lambda: input.lab.lambda ?? 0.7, perCreator: input.lab.perCreator, balanceMedia: input.lab.balanceMedia ?? true } : {}),
    };
    let res: any;
    try {
      res = await this.ai.json('/internal/recommendations', { body: { requestId: setId, workspaceId, profile, request } });
    } catch (e) {
      this.unavailable(e);
    }
    const rows = await this.catalogRows(res.items.map((i: any) => i.id));
    const ranked = res.items.filter((i: any) => rows.has(i.id));
    const mode = input.lab ? 'LAB' : 'DISCOVER';
    const stages = { ...res.stages, ...(ranked.length < res.items.length ? { missingFromCatalog: res.items.length - ranked.length } : {}) };
    await this.prisma.$transaction([
      this.prisma.recommendationSet.create({
        data: {
          id: setId,
          workspaceId,
          userId,
          mode,
          query: profile.query || null,
          filters: { kind: input.kind ?? null, genres: request.genres, moods: request.moods } as Prisma.InputJsonValue,
          weights: res.weights,
          lambda: res.lambda,
          k: request.k,
          modelVersion: res.modelVersion,
          stages,
          profileSummary: res.profile,
          coldStart: !!res.coldStart,
          latencyMs: Math.round(res.latencyMs ?? 0),
        },
      }),
      this.prisma.recommendationItem.createMany({
        data: ranked.map((i: any, n: number) => ({
          setId,
          rank: n + 1,
          itemId: i.id,
          score: i.score,
          baseRank: i.baseRank,
          factors: i.factors,
          adjustments: i.adjustments ?? [],
          sharedThemes: i.sharedThemes ?? [],
          becauseOf: i.becauseOf ?? undefined,
          rationale: i.rationale ?? '',
        })),
      }),
      ...(mode === 'DISCOVER'
        ? [this.prisma.interaction.createMany({ data: ranked.map((i: any, n: number) => ({ id: newId(), workspaceId, userId, itemId: i.id, kind: 'IMPRESSION' as const, setId, position: n + 1 })) })]
        : []),
    ]);
    return this.set(workspaceId, userId, setId);
  }

  async set(workspaceId: string, userId: string, setId: string) {
    if (!isUuid(setId)) throw new NotFoundException('Recommendation set not found');
    const s = await this.prisma.recommendationSet.findFirst({
      where: { id: setId, workspaceId, userId },
      include: { items: { orderBy: { rank: 'asc' }, include: { item: { include: { themes: true } } } } },
    });
    if (!s) throw new NotFoundException('Recommendation set not found');
    const fb = await this.feedbackFor(workspaceId, userId, s.items.map((i) => i.itemId));
    const { items, profileSummary, ...rest } = s;
    return {
      ...rest,
      profile: profileSummary,
      items: items.map(({ item, setId: _s, ...r }) => ({ ...r, item: presentItem(item, fb.get(item.id)) })),
    };
  }

  async latest(workspaceId: string, userId: string, mode: 'DISCOVER' | 'LAB') {
    const s = await this.prisma.recommendationSet.findFirst({ where: { workspaceId, userId, mode }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return s ? this.set(workspaceId, userId, s.id) : null;
  }

  async similar(workspaceId: string, userId: string, itemId: string, otherKind: boolean) {
    await this.catalogItem(workspaceId, userId, itemId);
    let res: { items: any[] };
    try {
      res = await this.ai.json('/internal/recommendations/similar', { body: { itemId, k: 6, otherKind } });
    } catch (e) {
      this.unavailable(e);
    }
    const rows = await this.catalogRows(res.items.map((i) => i.id));
    const fb = await this.feedbackFor(workspaceId, userId, [...rows.keys()]);
    return res.items.filter((i) => rows.has(i.id)).map((i) => ({ similarity: i.similarity, sharedThemes: i.sharedThemes, item: presentItem(rows.get(i.id)!, fb.get(i.id)) }));
  }

  /** Applies one explicit action. Saving a book also shelves it in the member's Library as "To read". */
  async feedback(workspaceId: string, userId: string, itemId: string, action: FeedbackAction, opts: { setId?: string; position?: number; reason?: string } = {}) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id: itemId }, include: { themes: true } });
    if (!item) throw new NotFoundException('Title not found');
    const setId = opts.setId && isUuid(opts.setId) ? opts.setId : null;
    if (action !== 'CLEAR_RATING') {
      await this.prisma.interaction.create({ data: { id: newId(), workspaceId, userId, itemId, kind: action, setId, position: opts.position ?? null } });
    }
    const key = { workspaceId_userId_itemId: { workspaceId, userId, itemId } };
    if (action === 'CLICK') {
      return presentItem(item, await this.prisma.feedback.findUnique({ where: key }));
    }
    const patch: Prisma.FeedbackUpdateInput = {
      SAVE: { saved: true, dismissed: false },
      UNSAVE: { saved: false },
      LIKE: { rating: 1, dismissed: false },
      DISLIKE: { rating: -1, saved: false },
      CLEAR_RATING: { rating: null },
      DISMISS: { dismissed: true, saved: false, reason: opts.reason?.slice(0, 200) ?? null },
      UNDISMISS: { dismissed: false, reason: null },
    }[action];
    let fb = await this.prisma.feedback.upsert({
      where: key,
      create: { id: newId(), workspaceId, userId, itemId, saved: false, dismissed: false, ...(patch as any) },
      update: patch,
    });
    if (action === 'SAVE' && item.kind === 'BOOK') {
      const libraryItemId = await this.shelve(workspaceId, userId, item, fb.libraryItemId);
      if (libraryItemId !== fb.libraryItemId) fb = await this.prisma.feedback.update({ where: { id: fb.id }, data: { libraryItemId } });
    }
    return presentItem(item, fb);
  }

  private async shelve(workspaceId: string, userId: string, item: CatalogRow, known: string | null): Promise<string> {
    if (known) {
      const still = await this.prisma.libraryItem.findFirst({ where: { id: known, workspaceId, userId }, select: { id: true } });
      if (still) return still.id;
    }
    const existing = await this.prisma.libraryItem.findFirst({
      where: { workspaceId, userId, book: { externalIds: { path: ['catalogId'], equals: item.id } } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const bookId = newId();
    const itemId = newId();
    await this.prisma.$transaction([
      this.prisma.book.create({
        data: {
          id: bookId,
          workspaceId,
          title: item.title,
          authors: item.creators,
          publishedYear: item.year,
          description: item.description,
          subjects: [...item.themes].sort((a, b) => b.weight - a.weight).map((t) => t.theme),
          pageCount: item.length,
          coverTone: item.coverTone,
          metadataSource: 'MANUAL',
          externalIds: { catalogId: item.id },
          isDemo: item.isDemo,
          createdById: userId,
        },
      }),
      this.prisma.libraryItem.create({ data: { id: itemId, workspaceId, userId, bookId, status: 'TO_READ' } }),
    ]);
    return itemId;
  }

  async saved(workspaceId: string, userId: string) {
    const fb = await this.prisma.feedback.findMany({ where: { workspaceId, userId, saved: true }, orderBy: { updatedAt: 'desc' }, take: 200 });
    const rows = await this.catalogRows(fb.map((f) => f.itemId));
    return fb.filter((f) => rows.has(f.itemId)).map((f) => presentItem(rows.get(f.itemId)!, f));
  }

  // ── offline evaluation ────────────────────────────────────────────────
  async queueEvaluation(workspaceId: string, userId: string, k: number) {
    const report = await this.prisma.evaluationReport.create({ data: { id: newId(), workspaceId, requestedById: userId, k } });
    await this.queues.queue(QUEUES.maintenance).add('rec-eval', { reportId: report.id }, { attempts: 1, jobId: `rec-eval-${report.id}` });
    return report;
  }

  /** Worker job: asks the AI service to evaluate the served model on the holdout split and stores the report. */
  async runEvaluation(reportId: string) {
    const claimed = await this.prisma.evaluationReport.updateMany({ where: { id: reportId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claimed.count) return;
    const r = await this.prisma.evaluationReport.findUniqueOrThrow({ where: { id: reportId } });
    try {
      const report = await this.ai.json<any>('/internal/recommendations/evaluate', { body: { k: r.k } });
      await this.prisma.evaluationReport.update({
        where: { id: reportId },
        data: { status: 'SUCCEEDED', report, modelVersion: report.modelVersion ?? null, finishedAt: new Date() },
      });
    } catch (e) {
      const message = e instanceof AiServiceError ? e.message.slice(0, 300) : 'Evaluation failed';
      await this.prisma.evaluationReport.update({ where: { id: reportId }, data: { status: 'FAILED', error: message, finishedAt: new Date() } });
    }
  }

  async evaluations(workspaceId: string) {
    return this.prisma.evaluationReport.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 10 });
  }

  async evaluation(workspaceId: string, id: string) {
    const r = isUuid(id) ? await this.prisma.evaluationReport.findFirst({ where: { id, workspaceId } }) : null;
    if (!r) throw new NotFoundException('Evaluation not found');
    return r;
  }

  async model() {
    try {
      return await this.ai.json('/internal/recommendations/model');
    } catch (e) {
      this.unavailable(e);
    }
  }
}
