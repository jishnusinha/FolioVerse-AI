import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { AiClientService } from '../ai-client/ai-client.service';

export const PURGE_AFTER_DAYS = 30;

/** Permanently removes sources (and their derived data) that have been in the trash for 30 days. */
@Injectable()
export class PurgeService {
  private readonly log = new Logger('Purge');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiClientService,
  ) {}

  async purgeExpired(now = new Date()) {
    const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86400_000);
    const projects = await this.prisma.project.findMany({ where: { deletedAt: { lt: cutoff } } });
    const sources = await this.prisma.source.findMany({
      where: { OR: [{ deletedAt: { lt: cutoff } }, { projectId: { in: projects.map((p) => p.id) } }] },
    });
    for (const s of sources) await this.purgeSource(s.workspaceId, s.id);
    for (const p of projects) await this.prisma.project.delete({ where: { id: p.id } });
    if (sources.length || projects.length) this.log.log(`purged ${sources.length} sources, ${projects.length} projects`);
    return { sources: sources.length, projects: projects.length };
  }

  async purgeSource(workspaceId: string, sourceId: string) {
    const versions = await this.prisma.sourceVersion.findMany({ where: { sourceId } });
    const vids = versions.map((v) => v.id);
    try {
      await this.ai.json('/internal/index/purge', { body: { workspaceId, sourceVersionIds: vids } }, 'ingest');
    } catch (e) {
      this.log.warn(`vector purge deferred for ${sourceId}: ${(e as Error).message}`);
      return;
    }
    const objects = await this.prisma.storedObject.findMany({ where: { id: { in: versions.map((v) => v.storedObjectId) } } });
    for (const o of objects) await this.storage.delete(o.key).catch(() => undefined);
    await this.prisma.$transaction([
      this.prisma.messageCitation.updateMany({ where: { sourceVersionId: { in: vids } }, data: { state: 'SOURCE_PURGED', quote: '' } }),
      this.prisma.chunk.deleteMany({ where: { sourceVersionId: { in: vids } } }),
      this.prisma.sourcePage.deleteMany({ where: { sourceVersionId: { in: vids } } }),
      this.prisma.indexManifest.deleteMany({ where: { sourceVersionId: { in: vids } } }),
      this.prisma.ingestionJob.deleteMany({ where: { sourceVersionId: { in: vids } } }),
      this.prisma.source.delete({ where: { id: sourceId } }),
      this.prisma.storedObject.deleteMany({ where: { id: { in: objects.map((o) => o.id) } } }),
    ]);
  }
}
