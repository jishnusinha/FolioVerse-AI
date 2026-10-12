import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { RequireRole } from '../../common/auth.decorators';
import { isUuid } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';

class UpdateThreadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
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
    return { ...t, scope, messages };
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
