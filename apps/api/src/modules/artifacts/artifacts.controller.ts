import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { ArtifactKind, Prisma } from '@prisma/client';
import { RequireRole } from '../../common/auth.decorators';
import { isUuid } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { INSIGHT_ACTIONS } from '../insights/insight-actions';
import { ArtifactsService } from './artifacts.service';

class UpdateArtifactDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
}

const KINDS = new Set(INSIGHT_ACTIONS.map((a) => a.kind));

@ApiTags('artifacts')
@Controller('workspaces/:workspaceId/artifacts')
export class ArtifactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactsService,
  ) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Query('projectId') projectId?: string,
    @Query('sourceId') sourceId?: string,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('archived') archived?: string,
  ) {
    const where: Prisma.ArtifactWhereInput = { workspaceId, archivedAt: archived === 'true' ? { not: null } : null };
    if (projectId && isUuid(projectId)) where.projectId = projectId;
    if (sourceId && isUuid(sourceId)) where.OR = [{ sourceId }, { sourceVersionIds: { hasSome: await this.versionsOf(workspaceId, sourceId) } }];
    if (kind && KINDS.has(kind as ArtifactKind)) where.kind = kind as ArtifactKind;
    if (q) where.title = { contains: q, mode: 'insensitive' };
    const rows = await this.prisma.artifact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, projectId: true, sourceId: true, runId: true, kind: true, action: true, title: true, format: true, sourceVersionIds: true, stale: true, fallback: true, isDemo: true, archivedAt: true, createdAt: true },
    });
    return rows;
  }

  @Get(':artifactId')
  async get(@Param('workspaceId') workspaceId: string, @Param('artifactId') id: string) {
    const a = await this.artifacts.get(workspaceId, id);
    const citations = await this.prisma.aiRunEvent.findMany({ where: { runId: a.runId, workspaceId, type: 'citation.validated' }, orderBy: { seq: 'asc' } });
    return { ...a, pins: await this.artifacts.pins(workspaceId, a.sourceVersionIds), citations: citations.map((c) => c.data) };
  }

  @RequireRole('EDITOR')
  @Patch(':artifactId')
  async update(@Param('workspaceId') workspaceId: string, @Param('artifactId') id: string, @Body() dto: UpdateArtifactDto) {
    await this.artifacts.get(workspaceId, id);
    return this.prisma.artifact.update({
      where: { id },
      data: { title: dto.title, archivedAt: dto.archived === undefined ? undefined : dto.archived ? new Date() : null },
    });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete(':artifactId')
  async remove(@Param('workspaceId') workspaceId: string, @Param('artifactId') id: string) {
    await this.artifacts.get(workspaceId, id);
    await this.prisma.artifact.delete({ where: { id } });
  }

  private async versionsOf(workspaceId: string, sourceId: string) {
    const vs = await this.prisma.sourceVersion.findMany({ where: { workspaceId, sourceId }, select: { id: true } });
    return vs.map((v) => v.id);
  }
}
