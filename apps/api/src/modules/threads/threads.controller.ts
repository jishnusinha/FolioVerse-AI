import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';

class UpdateThreadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
}
class ThreadScopeDto {
  @ApiProperty() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('all', { each: true }) sourceVersionIds: string[];
}

@ApiTags('threads')
@Controller('workspaces/:workspaceId/threads')
export class ThreadsController {
  constructor(private readonly prisma: PrismaService) {}

  private async thread(workspaceId: string, threadId: string) {
    if (!isUuid(threadId)) throw new NotFoundException();
    const t = await this.prisma.thread.findFirst({ where: { id: threadId, workspaceId } });
    if (!t) throw new NotFoundException();
    return t;
  }

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Query('sourceId') sourceId?: string,
    @Query('projectId') projectId?: string,
    @Query('q') q?: string,
    @Query('archived') archived?: string,
  ) {
    const where: Prisma.ThreadWhereInput = { workspaceId, archivedAt: archived === 'true' ? { not: null } : null };
    if (sourceId && isUuid(sourceId)) where.sourceId = sourceId;
    if (projectId && isUuid(projectId)) where.projectId = projectId;
    if (q) where.OR = [{ title: { contains: q, mode: 'insensitive' } }, { messages: { some: { content: { contains: q, mode: 'insensitive' } } } }];
    const threads = await this.prisma.thread.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 });
    const counts = await this.prisma.message.groupBy({ by: ['threadId'], where: { threadId: { in: threads.map((t) => t.id) } }, _count: { _all: true } });
    const m = new Map(counts.map((c) => [c.threadId, c._count._all]));
    return threads.map((t) => ({ ...t, messageCount: m.get(t.id) ?? 0 }));
  }

  /** Returns the full message tree; the client renders the active branch and sibling switchers. */
  @Get(':threadId')
  async get(@Param('workspaceId') workspaceId: string, @Param('threadId') threadId: string) {
    const t = await this.thread(workspaceId, threadId);
    const messages = await this.prisma.message.findMany({ where: { threadId, workspaceId }, orderBy: { createdAt: 'asc' }, include: { citations: true } });
    const scope = t.contextScopeId ? await this.prisma.contextScope.findUnique({ where: { id: t.contextScopeId } }) : null;
    return { ...t, scope: scope ? { ...scope, sources: await this.scopeSources(workspaceId, scope.sourceVersionIds) } : null, messages };
  }

  /** Attaches or detaches sources: later questions in this thread use a new context scope; earlier answers keep theirs. */
  @RequireRole('EDITOR')
  @Put(':threadId/scope')
  async setScope(@Param('workspaceId') workspaceId: string, @Param('threadId') threadId: string, @Body() dto: ThreadScopeDto) {
    const t = await this.thread(workspaceId, threadId);
    const ids = [...new Set(dto.sourceVersionIds)];
    const versions = await this.prisma.sourceVersion.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true, sourceId: true } });
    const live = await this.prisma.source.count({ where: { id: { in: [...new Set(versions.map((v) => v.sourceId))] }, workspaceId, deletedAt: null } });
    if (versions.length !== ids.length || live !== new Set(versions.map((v) => v.sourceId)).size) {
      throw new BadRequestException({ message: 'Every source in the scope must exist in this workspace', code: 'INVALID_SCOPE' });
    }
    const id = newId();
    await this.prisma.contextScope.create({ data: { id, workspaceId, projectId: t.projectId, sourceVersionIds: ids } });
    await this.prisma.thread.update({ where: { id: threadId }, data: { contextScopeId: id } });
    return { id, sourceVersionIds: ids, sources: await this.scopeSources(workspaceId, ids) };
  }

  private async scopeSources(workspaceId: string, svids: string[]) {
    const versions = await this.prisma.sourceVersion.findMany({ where: { id: { in: svids }, workspaceId } });
    const sources = await this.prisma.source.findMany({ where: { id: { in: versions.map((v) => v.sourceId) }, workspaceId }, select: { id: true, title: true } });
    const title = new Map(sources.map((s) => [s.id, s.title]));
    return versions.map((v) => ({ sourceVersionId: v.id, sourceId: v.sourceId, title: title.get(v.sourceId) ?? 'Deleted document', versionNo: v.versionNo, ingestionState: v.ingestionState }));
  }

  @RequireRole('EDITOR')
  @Patch(':threadId')
  async update(@Param('workspaceId') workspaceId: string, @Param('threadId') threadId: string, @Body() dto: UpdateThreadDto) {
    await this.thread(workspaceId, threadId);
    return this.prisma.thread.update({
      where: { id: threadId },
      data: { title: dto.title, archivedAt: dto.archived === undefined ? undefined : dto.archived ? new Date() : null },
    });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete(':threadId')
  async remove(@Param('workspaceId') workspaceId: string, @Param('threadId') threadId: string) {
    await this.thread(workspaceId, threadId);
    await this.prisma.thread.delete({ where: { id: threadId } });
  }
}
