import { Injectable, NotFoundException } from '@nestjs/common';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { ACTION_BY_ID } from '../insights/insight-actions';

@Injectable()
export class ArtifactsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saves the artifact a finished insight run produced. Idempotent per run. The artifact is filed
   * under its document when it was generated from one source, and under the project its sources share.
   */
  async recordFromRun(runId: string, artifact: Record<string, any>): Promise<string | null> {
    const action = ACTION_BY_ID.get(String(artifact?.kind ?? ''));
    if (!action) return null;
    const run = await this.prisma.aiRun.findUnique({ where: { id: runId } });
    if (!run) return null;
    const scope = (run.scope as any) ?? {};
    const pinned: string[] = Array.isArray(artifact.sourceVersionIds) && artifact.sourceVersionIds.length ? artifact.sourceVersionIds : scope.sourceVersionIds ?? [];
    const versions = await this.prisma.sourceVersion.findMany({ where: { id: { in: pinned }, workspaceId: run.workspaceId }, select: { id: true, sourceId: true } });
    const sourceIds = [...new Set(versions.map((v) => v.sourceId))];
    const sources = await this.prisma.source.findMany({ where: { id: { in: sourceIds }, workspaceId: run.workspaceId }, select: { id: true, title: true, projectId: true } });
    const projects = [...new Set(sources.map((s) => s.projectId))];
    const projectId = scope.projectId ?? (projects.length === 1 ? projects[0] : null);
    const sourceId = sources.length === 1 ? sources[0].id : null;
    const about = sources.length === 1 ? sources[0].title.replace(/\.\w+$/, '') : `${sources.length} documents`;
    const existing = await this.prisma.artifact.findUnique({ where: { runId } });
    if (existing) return existing.id;
    const id = newId();
    await this.prisma.artifact.create({
      data: {
        id,
        workspaceId: run.workspaceId,
        projectId,
        sourceId,
        runId,
        kind: action.kind,
        action: action.id,
        title: `${action.label} · ${about}`.slice(0, 200),
        format: artifact.format === 'json' ? 'json' : 'markdown',
        content: artifact.content ?? {},
        sourceVersionIds: versions.map((v) => v.id),
        fallback: Boolean(artifact.fallback),
        isDemo: run.isDemo,
        createdById: run.userId,
      },
    });
    return id;
  }

  async get(workspaceId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const a = await this.prisma.artifact.findFirst({ where: { id, workspaceId } });
    if (!a) throw new NotFoundException();
    return a;
  }

  /** Pinned versions with their document, version number and whether a newer version exists. */
  async pins(workspaceId: string, svids: string[]) {
    const versions = await this.prisma.sourceVersion.findMany({ where: { id: { in: svids }, workspaceId } });
    const sources = await this.prisma.source.findMany({ where: { id: { in: versions.map((v) => v.sourceId) }, workspaceId } });
    const byId = new Map(sources.map((s) => [s.id, s]));
    return versions.map((v) => {
      const s = byId.get(v.sourceId);
      return {
        sourceVersionId: v.id,
        sourceId: v.sourceId,
        projectId: s?.projectId ?? null,
        title: s?.title ?? 'Deleted document',
        versionNo: v.versionNo,
        current: s?.currentVersionId === v.id,
        currentVersionId: s && !s.deletedAt ? s.currentVersionId : null,
      };
    });
  }
}
