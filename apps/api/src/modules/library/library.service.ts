import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import type { Chapter } from './locator';

const DAY_MS = 86_400_000;

export interface IngestedMetadata {
  title?: string;
  authors?: string[];
  language?: string;
  publisher?: string;
  publishedYear?: number;
  description?: string;
  subjects?: string[];
  isbn?: string;
}

const utcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own item. Another member's item is indistinguishable from a missing one (404). */
  async item(workspaceId: string, userId: string, itemId: string) {
    if (!isUuid(itemId)) throw new NotFoundException();
    const item = await this.prisma.libraryItem.findFirst({ where: { id: itemId, workspaceId, userId }, include: { book: true, progress: true } });
    if (!item) throw new NotFoundException('Book not found');
    return item;
  }

  async source(workspaceId: string, sourceId: string | null) {
    if (!sourceId) return null;
    const s = await this.prisma.source.findFirst({
      where: { id: sourceId, workspaceId, deletedAt: null },
      select: { id: true, title: true, mimeType: true, ingestionState: true, currentVersionId: true, projectId: true },
    });
    return s;
  }

  /** Stats of the latest finished ingestion of a version, or null. */
  private async ingestStats(versionId: string | null | undefined): Promise<Record<string, any> | null> {
    if (!versionId) return null;
    const job = await this.prisma.ingestionJob.findFirst({
      where: { sourceVersionId: versionId, state: { in: ['READY', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      select: { stats: true },
    });
    return (job?.stats as Record<string, any> | null) ?? null;
  }

  /** Chapters recorded by ingestion of the current version (EPUB); empty for PDFs and unfinished ingestion. */
  async chapters(versionId: string | null | undefined): Promise<Chapter[]> {
    const list = (await this.ingestStats(versionId))?.chapters;
    return Array.isArray(list) ? list.filter((c) => typeof c?.page === 'number' && typeof c?.href === 'string') : [];
  }

  /** EPUB package metadata recorded by ingestion of a version, if any. */
  async ingestedMetadata(versionId: string | null | undefined): Promise<IngestedMetadata | undefined> {
    const meta = (await this.ingestStats(versionId))?.metadata;
    return meta && typeof meta === 'object' ? (meta as IngestedMetadata) : undefined;
  }

  /**
   * Fills blank book fields from EPUB metadata once ingestion finishes (or when a book is shelved from an
   * already ingested file). Values the reader entered are never
   * overwritten, and books enriched by a metadata provider are left alone.
   */
  async applyIngestedMetadata(sourceId: string, meta: IngestedMetadata | undefined) {
    if (!meta || typeof meta !== 'object') return 0;
    const items = await this.prisma.libraryItem.findMany({ where: { sourceId }, select: { bookId: true } });
    const books = await this.prisma.book.findMany({ where: { id: { in: [...new Set(items.map((i) => i.bookId))] }, metadataSource: { in: ['MANUAL', 'EPUB'] } } });
    let updated = 0;
    for (const b of books) {
      const data: Prisma.BookUpdateInput = {};
      if (!b.authors.length && meta.authors?.length) data.authors = meta.authors.slice(0, 10);
      if (!b.language && meta.language) data.language = meta.language.slice(0, 20);
      if (!b.publisher && meta.publisher) data.publisher = meta.publisher.slice(0, 200);
      if (!b.publishedYear && Number.isInteger(meta.publishedYear)) data.publishedYear = meta.publishedYear;
      if (!b.description && meta.description) data.description = meta.description.slice(0, 4000);
      if (!b.subjects.length && meta.subjects?.length) data.subjects = meta.subjects.slice(0, 12);
      if (!b.isbn13 && meta.isbn && /^97[89]\d{10}$/.test(meta.isbn)) data.isbn13 = meta.isbn;
      if (meta.title && b.metadataSource === 'MANUAL' && !b.authors.length) data.title = meta.title.slice(0, 300);
      if (!Object.keys(data).length) continue;
      await this.prisma.book.update({ where: { id: b.id }, data: { ...data, metadataSource: 'EPUB' } });
      updated++;
    }
    return updated;
  }

  /** Adds reading time to today's session (UTC). */
  async addReadingTime(workspaceId: string, userId: string, itemId: string, seconds: number) {
    if (seconds <= 0) return;
    const day = utcDay();
    await this.prisma.$executeRaw`
      INSERT INTO app.reading_sessions (id, workspace_id, user_id, item_id, day, seconds)
      VALUES (${newId()}::uuid, ${workspaceId}::uuid, ${userId}::uuid, ${itemId}::uuid, ${day}::date, ${seconds})
      ON CONFLICT (item_id, day) DO UPDATE SET seconds = app.reading_sessions.seconds + EXCLUDED.seconds`;
  }

  async stats(workspaceId: string, userId: string, days = 14) {
    const since = new Date(utcDay().getTime() - (days - 1) * DAY_MS);
    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const [byStatus, sessions, highlights, notes, finishedThisYear, total] = await Promise.all([
      this.prisma.libraryItem.groupBy({ by: ['status'], where: { workspaceId, userId }, _count: { _all: true } }),
      this.prisma.readingSession.groupBy({ by: ['day'], where: { workspaceId, userId, day: { gte: since } }, _sum: { seconds: true } }),
      this.prisma.annotation.count({ where: { workspaceId, userId, kind: 'HIGHLIGHT', deletedAt: null } }),
      this.prisma.annotation.count({ where: { workspaceId, userId, kind: 'NOTE', deletedAt: null } }),
      this.prisma.libraryItem.count({ where: { workspaceId, userId, status: 'FINISHED', finishedAt: { gte: yearStart } } }),
      this.prisma.readingSession.aggregate({ where: { workspaceId, userId }, _sum: { seconds: true } }),
    ]);
    const perDay = new Map(sessions.map((s) => [s.day.toISOString().slice(0, 10), s._sum.seconds ?? 0]));
    const activity = Array.from({ length: days }, (_, i) => {
      const day = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      return { day, seconds: perDay.get(day) ?? 0 };
    });
    let streak = 0;
    for (let i = activity.length - 1; i >= 0; i--) {
      if (activity[i].seconds > 0) streak++;
      else if (i < activity.length - 1) break;
    }
    const counts = { TO_READ: 0, READING: 0, FINISHED: 0, ABANDONED: 0 } as Record<string, number>;
    for (const r of byStatus) counts[r.status] = r._count._all;
    return {
      counts,
      finishedThisYear,
      highlights,
      notes,
      totalSeconds: total._sum.seconds ?? 0,
      activity,
      daysRead: activity.filter((a) => a.seconds > 0).length,
      streak,
    };
  }
}
