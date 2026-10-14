import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { diffParagraphs, paragraphs } from './diff';
import { SourcesService } from './sources.service';

class CreateUploadDto {
  @ApiProperty() @IsUUID() projectId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() folderId?: string;
  @ApiPropertyOptional({ description: 'Upload a new version of an existing source' }) @IsOptional() @IsUUID() sourceId?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) filename: string;
  @ApiProperty() @IsInt() @Min(1) @Max(2_000_000_000) sizeBytes: number;
}
class CompleteUploadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
}
class UpdateSourceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() folderId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}
class BatchDto {
  @ApiProperty() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
  @ApiProperty({ enum: ['delete', 'move', 'reingest', 'restore'] }) @IsEnum(['delete', 'move', 'reingest', 'restore']) action: 'delete' | 'move' | 'reingest' | 'restore';
  @ApiPropertyOptional() @IsOptional() @IsUUID() folderId?: string | null;
}

@ApiTags('sources')
@Controller('workspaces/:workspaceId')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @RequireRole('EDITOR')
  @Post('uploads')
  createUpload(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateUploadDto) {
    return this.sources.createUpload(workspaceId, u.id, dto);
  }

  @RequireRole('EDITOR')
  @Put('uploads/:uploadId/content')
  upload(@Param('workspaceId') workspaceId: string, @Param('uploadId') uploadId: string, @Req() req: Request) {
    return this.sources.receiveContent(workspaceId, uploadId, req);
  }

  @RequireRole('EDITOR')
  @Put('uploads/:uploadId/parts/:partNumber')
  uploadPart(
    @Param('workspaceId') workspaceId: string,
    @Param('uploadId') uploadId: string,
    @Param('partNumber') partNumber: string,
    @Req() req: Request,
  ) {
    return this.sources.receivePart(workspaceId, uploadId, parseInt(partNumber, 10), req);
  }

  @RequireRole('EDITOR')
  @Post('uploads/:uploadId/assemble')
  assemble(
    @Param('workspaceId') workspaceId: string,
    @Param('uploadId') uploadId: string,
    @Body() dto: { totalParts: number },
  ) {
    return this.sources.assemble(workspaceId, uploadId, dto.totalParts);
  }

  @RequireRole('EDITOR')
  @Post('uploads/:uploadId/complete')
  complete(@Param('workspaceId') workspaceId: string, @Param('uploadId') uploadId: string, @CurrentUser() u: AuthUser, @Body() dto: CompleteUploadDto) {
    return this.sources.completeUpload(workspaceId, u.id, uploadId, dto.title);
  }

  @Get('projects/:projectId/sources')
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('projectId') projectId: string,
    @Query('folderId') folderId?: string,
    @Query('q') q?: string,
    @Query('state') state?: string,
    @Query('type') type?: string,
  ) {
    if (!isUuid(projectId) || !(await this.prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } }))) {
      throw new NotFoundException();
    }
    const where: Prisma.SourceWhereInput = { workspaceId, projectId, deletedAt: null };
    if (folderId && isUuid(folderId)) {
      const f = await this.prisma.folder.findFirst({ where: { id: folderId, workspaceId } });
      const ids = f ? (await this.prisma.folder.findMany({ where: { workspaceId, OR: [{ id: f.id }, { path: { startsWith: `${f.path}/` } }] } })).map((x) => x.id) : [];
      where.folderId = { in: ids };
    }
    if (q) where.title = { contains: q, mode: 'insensitive' };
    if (state) where.ingestionState = state as any;
    if (type) where.mimeType = { contains: type };
    const rows = await this.prisma.source.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    const versionIds = rows.map((r) => r.currentVersionId).filter(Boolean) as string[];
    const versions = await this.prisma.sourceVersion.findMany({ where: { id: { in: versionIds } } });
    const vmap = new Map(versions.map((v) => [v.id, v]));
    return rows.map((r) => ({ ...r, currentVersion: r.currentVersionId ? vmap.get(r.currentVersionId) ?? null : null }));
  }

  @Get('sources/:sourceId')
  async get(@Param('workspaceId') workspaceId: string, @Param('sourceId') sourceId: string) {
    const s = await this.sources.getSource(workspaceId, sourceId);
    const versions = await this.prisma.sourceVersion.findMany({ where: { sourceId, workspaceId }, orderBy: { versionNo: 'desc' } });
    const manifests = await this.prisma.indexManifest.findMany({ where: { sourceVersionId: { in: versions.map((v) => v.id) } } });
    const jobs = await this.prisma.ingestionJob.findMany({ where: { sourceVersionId: { in: versions.map((v) => v.id) } }, orderBy: { createdAt: 'desc' }, take: 10 });
    return { ...s, versions, manifests, jobs };
  }

  @RequireRole('EDITOR')
  @Patch('sources/:sourceId')
  async update(@Param('workspaceId') workspaceId: string, @Param('sourceId') sourceId: string, @Body() dto: UpdateSourceDto) {
    const s = await this.sources.getSource(workspaceId, sourceId);
    if (dto.folderId) {
      const f = await this.prisma.folder.findFirst({ where: { id: dto.folderId, workspaceId, projectId: s.projectId, deletedAt: null } });
      if (!f) throw new NotFoundException('Folder not found');
    }
    return this.prisma.source.update({ where: { id: sourceId }, data: { title: dto.title, folderId: dto.folderId, tags: dto.tags } });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete('sources/:sourceId')
  async remove(@Param('workspaceId') workspaceId: string, @Param('sourceId') sourceId: string, @CurrentUser() u: AuthUser) {
    await this.sources.getSource(workspaceId, sourceId);
    await this.prisma.source.update({ where: { id: sourceId }, data: { deletedAt: new Date() } });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'source.trash', resourceType: 'source', resourceId: sourceId });
  }

  @RequireRole('EDITOR')
  @Post('sources/:sourceId/restore')
  async restore(@Param('workspaceId') workspaceId: string, @Param('sourceId') sourceId: string) {
    await this.sources.getSource(workspaceId, sourceId, true);
    return this.prisma.source.update({ where: { id: sourceId }, data: { deletedAt: null } });
  }

  @RequireRole('EDITOR')
  @Post('sources/batch')
  async batch(@Param('workspaceId') workspaceId: string, @Body() dto: BatchDto, @CurrentUser() u: AuthUser) {
    const rows = await this.prisma.source.findMany({ where: { workspaceId, id: { in: dto.ids } } });
    const ids = rows.map((r) => r.id);
    if (dto.action === 'delete') await this.prisma.source.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    if (dto.action === 'restore') await this.prisma.source.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
    if (dto.action === 'move') {
      if (dto.folderId) {
        const f = await this.prisma.folder.findFirst({ where: { id: dto.folderId, workspaceId, deletedAt: null } });
        if (!f || rows.some((r) => r.projectId !== f.projectId)) throw new BadRequestException('Folder must belong to the same project');
      }
      await this.prisma.source.updateMany({ where: { id: { in: ids } }, data: { folderId: dto.folderId ?? null } });
    }
    if (dto.action === 'reingest') {
      for (const r of rows) if (r.currentVersionId) await this.sources.enqueueIngestion(workspaceId, r.currentVersionId);
    }
    await this.audit.record({ workspaceId, actorId: u.id, action: `source.batch_${dto.action}`, resourceType: 'source', metadata: { count: ids.length } });
    return { affected: ids.length };
  }

  @Get('sources/:sourceId/versions/:versionId/file')
  async file(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('versionId') versionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const v = await this.sources.getVersion(workspaceId, sourceId, versionId);
    if (v.ingestionState === 'QUARANTINED') throw new NotFoundException('This file was quarantined');
    const obj = await this.prisma.storedObject.findUniqueOrThrow({ where: { id: v.storedObjectId } });
    const range = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
    const r = await this.storage.getStream(obj.key, range);
    res.setHeader('Content-Type', v.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(obj.key.split('/').pop() || 'file')}"`);
    if (r.size !== undefined) res.setHeader('Content-Length', String(r.size));
    if (range && r.range) {
      res.status(206);
      res.setHeader('Content-Range', r.range);
    }
    r.body.pipe(res);
  }

  @Get('sources/:sourceId/versions/:versionId/pages')
  async pages(@Param('workspaceId') workspaceId: string, @Param('sourceId') sourceId: string, @Param('versionId') versionId: string) {
    await this.sources.getVersion(workspaceId, sourceId, versionId);
    return this.prisma.sourcePage.findMany({ where: { sourceVersionId: versionId, workspaceId }, orderBy: { pageNo: 'asc' } });
  }

  /** Paragraph-level summary of changes from `against` (default: the previous version) to this version. */
  @Get('sources/:sourceId/versions/:versionId/diff')
  async diff(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('versionId') versionId: string,
    @Query('against') against?: string,
  ) {
    const to = await this.sources.getVersion(workspaceId, sourceId, versionId);
    const from = against
      ? await this.sources.getVersion(workspaceId, sourceId, against)
      : await this.prisma.sourceVersion.findFirst({ where: { workspaceId, sourceId, versionNo: { lt: to.versionNo } }, orderBy: { versionNo: 'desc' } });
    if (!from) return { from: null, to: { id: to.id, versionNo: to.versionNo }, summary: null };
    const load = (id: string) => this.prisma.sourcePage.findMany({ where: { sourceVersionId: id, workspaceId }, orderBy: { pageNo: 'asc' }, select: { pageNo: true, text: true } });
    const [a, b] = await Promise.all([load(from.id), load(to.id)]);
    const ready = a.length > 0 && b.length > 0;
    return {
      from: { id: from.id, versionNo: from.versionNo },
      to: { id: to.id, versionNo: to.versionNo },
      summary: ready ? diffParagraphs(paragraphs(a), paragraphs(b)) : null,
    };
  }

  @Get('sources/:sourceId/versions/:versionId/chunks')
  async chunks(
    @Param('workspaceId') workspaceId: string,
    @Param('sourceId') sourceId: string,
    @Param('versionId') versionId: string,
    @Query('level') level = 'CHILD',
  ) {
    await this.sources.getVersion(workspaceId, sourceId, versionId);
    return this.prisma.chunk.findMany({ where: { sourceVersionId: versionId, workspaceId, level }, orderBy: { ordinal: 'asc' }, take: 2000 });
  }

  @RequireRole('EDITOR')
  @Post('sources/:sourceId/versions/:versionId/ingest')
  async reingest(@Param('workspaceId') workspaceId: string, @Param('sourceId') sourceId: string, @Param('versionId') versionId: string) {
    const v = await this.sources.getVersion(workspaceId, sourceId, versionId);
    if (v.ingestionState === 'QUARANTINED') throw new BadRequestException('Quarantined files cannot be ingested');
    const jobId = await this.sources.enqueueIngestion(workspaceId, versionId);
    return { jobId };
  }
}
