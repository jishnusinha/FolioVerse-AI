import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CryptoService } from '../../common/crypto.service';
import { isUuid, newId } from '../../common/ids';
import { rootLogger } from '../../common/logger';
import { PrismaService } from '../../infra/prisma.service';
import { AiClientService } from '../ai-client/ai-client.service';

const MAX_SEMANTIC_VERSIONS = 200;

export interface SearchItem {
  type: 'project' | 'source' | 'thread' | 'artifact' | 'note' | 'passage';
  id: string;
  title: string;
  snippet?: string;
  projectId?: string | null;
  sourceId?: string | null;
  sourceVersionId?: string | null;
  page?: number | null;
  kind?: string;
  score: number;
}

/** Prefix query over words only, so user input never reaches tsquery syntax. */
export function prefixQuery(q: string): string | null {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

@ApiTags('search')
@Controller('workspaces/:workspaceId/search')
export class SearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly ai: AiClientService,
  ) {}

  /** Keyword search (Postgres full text over titles and notes) merged with semantic passage search (Qdrant via the AI service). */
  @Get()
  async search(
    @Param('workspaceId') workspaceId: string,
    @Query('q') raw = '',
    @Query('projectId') projectId?: string,
    @Query('semantic') semantic?: string,
  ) {
    const q = raw.trim().slice(0, 200);
    const tq = prefixQuery(q);
    if (!tq) return { query: q, items: [], semantic: { status: 'SKIPPED' } };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const project = projectId && isUuid(projectId) ? projectId : null;

    const [projects, sources, threads, artifacts, notes] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT id, name AS title FROM app.projects
         WHERE workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL AND name ILIKE ${like} LIMIT 5`,
      this.prisma.$queryRaw<any[]>`
        SELECT s.id, s.project_id, s.title, ts_rank(to_tsvector('english', s.title), q) AS rank
          FROM app.sources s, to_tsquery('english', ${tq}) q
         WHERE s.workspace_id = ${workspaceId}::uuid AND s.deleted_at IS NULL
           AND (${project}::uuid IS NULL OR s.project_id = ${project}::uuid)
           AND (to_tsvector('english', s.title) @@ q OR s.title ILIKE ${like})
         ORDER BY rank DESC, s.created_at DESC LIMIT 10`,
      this.prisma.$queryRaw<any[]>`
        SELECT t.id, t.project_id, t.source_id, t.title, ts_rank(to_tsvector('english', t.title), q) AS rank
          FROM app.threads t, to_tsquery('english', ${tq}) q
         WHERE t.workspace_id = ${workspaceId}::uuid AND t.archived_at IS NULL
           AND (${project}::uuid IS NULL OR t.project_id = ${project}::uuid)
           AND (to_tsvector('english', t.title) @@ q OR t.title ILIKE ${like})
         ORDER BY rank DESC, t.updated_at DESC LIMIT 8`,
      this.prisma.$queryRaw<any[]>`
        SELECT a.id, a.project_id, a.source_id, a.title, a.kind::text AS kind, ts_rank(to_tsvector('english', a.title), q) AS rank
          FROM app.artifacts a, to_tsquery('english', ${tq}) q
         WHERE a.workspace_id = ${workspaceId}::uuid AND a.archived_at IS NULL
           AND (${project}::uuid IS NULL OR a.project_id = ${project}::uuid)
           AND (to_tsvector('english', a.title) @@ q OR a.title ILIKE ${like})
         ORDER BY rank DESC, a.created_at DESC LIMIT 8`,
      this.prisma.$queryRaw<any[]>`
        SELECT n.id, n.project_id, n.source_id, n.source_version_id, n.body, n.quote,
               ts_rank(to_tsvector('english', coalesce(n.quote, '') || ' ' || n.body), q) AS rank
          FROM app.notes n, to_tsquery('english', ${tq}) q
         WHERE n.workspace_id = ${workspaceId}::uuid
           AND (${project}::uuid IS NULL OR n.project_id = ${project}::uuid)
           AND (to_tsvector('english', coalesce(n.quote, '') || ' ' || n.body) @@ q OR n.body ILIKE ${like})
         ORDER BY rank DESC, n.created_at DESC LIMIT 8`,
    ]);

    const items: SearchItem[] = [
      ...projects.map((r) => ({ type: 'project' as const, id: r.id, title: r.title, projectId: r.id, score: 1 })),
      ...sources.map((r) => ({ type: 'source' as const, id: r.id, title: r.title, projectId: r.project_id, sourceId: r.id, score: Number(r.rank) })),
      ...threads.map((r) => ({ type: 'thread' as const, id: r.id, title: r.title, projectId: r.project_id, sourceId: r.source_id, score: Number(r.rank) })),
      ...artifacts.map((r) => ({ type: 'artifact' as const, id: r.id, title: r.title, kind: r.kind, projectId: r.project_id, sourceId: r.source_id, score: Number(r.rank) })),
      ...notes.map((r) => ({
        type: 'note' as const,
        id: r.id,
        title: r.body.slice(0, 80),
        snippet: r.quote ?? undefined,
        projectId: r.project_id,
        sourceId: r.source_id,
        sourceVersionId: r.source_version_id,
        score: Number(r.rank),
      })),
    ];

    let status = 'SKIPPED';
    let latencyMs: number | undefined;
    if (semantic !== 'false' && q.length >= 3) {
      try {
        const passages = await this.passages(workspaceId, project, q);
        status = 'OK';
        latencyMs = passages.latencyMs;
        items.push(...passages.items);
      } catch (e) {
        status = 'UNAVAILABLE';
        rootLogger.warn({ workspaceId, err: (e as Error).message }, 'semantic search unavailable');
      }
    }
    return { query: q, items, semantic: { status, latencyMs } };
  }

  private async passages(workspaceId: string, projectId: string | null, q: string): Promise<{ items: SearchItem[]; latencyMs?: number }> {
    const sources = await this.prisma.source.findMany({
      where: { workspaceId, deletedAt: null, ...(projectId ? { projectId } : {}), currentVersionId: { not: null } },
      select: { id: true, title: true, projectId: true, currentVersionId: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_SEMANTIC_VERSIONS,
    });
    const ready = await this.prisma.sourceVersion.findMany({
      where: { id: { in: sources.map((s) => s.currentVersionId!) }, workspaceId, ingestionState: { in: ['READY', 'PARTIAL'] } },
      select: { id: true, sourceId: true },
    });
    if (!ready.length) return { items: [] };
    const bySource = new Map(sources.map((s) => [s.id, s]));
    const versionSource = new Map(ready.map((v) => [v.id, bySource.get(v.sourceId)!]));
    const searchId = newId();
    const scopeToken = await this.crypto.signScope(searchId, workspaceId, ready.map((v) => v.id), 60);
    const res = await this.ai.json<{ items: any[]; latencyMs?: number }>('/internal/search', { body: { searchId, workspaceId, query: q, scopeToken, topK: 8 } });
    const items = res.items
      .filter((p) => versionSource.has(p.sourceVersionId))
      .map((p) => {
        const s = versionSource.get(p.sourceVersionId)!;
        return {
          type: 'passage' as const,
          id: p.chunkId,
          title: s.title,
          snippet: p.snippet,
          projectId: s.projectId,
          sourceId: s.id,
          sourceVersionId: p.sourceVersionId,
          page: p.page ?? null,
          score: Number(p.score),
        };
      });
    return { items, latencyMs: res.latencyMs };
  }
}
