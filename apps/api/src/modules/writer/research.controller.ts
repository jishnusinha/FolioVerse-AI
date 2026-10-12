import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { WriterService } from './writer.service';

class CreateExcerptDto {
  @ApiProperty() @IsUUID() sourceId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceVersionId?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) quote: string;
  @ApiPropertyOptional({ description: 'Source anchor (page, textQuote, textPosition)' }) @IsOptional() @IsObject() anchor?: Record<string, unknown>;
}
class CreateResearchNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() excerptId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() nodeId?: string;
}
class UpdateResearchNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) body?: string;
}

@ApiTags('writer')
@Controller('workspaces/:workspaceId')
export class ResearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: WriterService,
  ) {}

  @Get('excerpts')
  excerpts(@Param('workspaceId') workspaceId: string) {
    return this.prisma.excerpt.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @RequireRole('EDITOR')
  @Post('excerpts')
  async createExcerpt(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateExcerptDto) {
    const s = await this.prisma.source.findFirst({ where: { id: dto.sourceId, workspaceId, deletedAt: null } });
    if (!s) throw new NotFoundException('Source not found');
    const versionId = dto.sourceVersionId ?? s.currentVersionId;
    if (versionId && !(await this.prisma.sourceVersion.findFirst({ where: { id: versionId, sourceId: s.id, workspaceId } }))) {
      throw new NotFoundException('Version not found');
    }
    return this.prisma.excerpt.create({
      data: {
        id: newId(),
        workspaceId,
        sourceId: s.id,
        sourceVersionId: versionId ?? null,
        projectId: s.projectId,
        title: s.title,
        quote: dto.quote,
        anchor: (dto.anchor ?? undefined) as any,
        createdById: u.id,
      },
    });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete('excerpts/:excerptId')
  async removeExcerpt(@Param('workspaceId') workspaceId: string, @Param('excerptId') id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const e = await this.prisma.excerpt.findFirst({ where: { id, workspaceId } });
    if (!e) throw new NotFoundException('Excerpt not found');
    await this.prisma.excerpt.delete({ where: { id } });
  }

  @Get('manuscripts/:manuscriptId/research-notes')
  async notes(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    return this.prisma.researchNote.findMany({ where: { manuscriptId: m.id }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  /** A note may quote an excerpt; its quote and source anchor are copied so the note survives excerpt deletion. */
  @RequireRole('EDITOR')
  @Post('manuscripts/:manuscriptId/research-notes')
  async createNote(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateResearchNoteDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const excerpt = dto.excerptId ? await this.prisma.excerpt.findFirst({ where: { id: dto.excerptId, workspaceId } }) : null;
    if (dto.excerptId && !excerpt) throw new NotFoundException('Excerpt not found');
    if (dto.nodeId) await this.writer.node(workspaceId, m.id, dto.nodeId);
    const title = dto.title?.trim() || excerpt?.title || '';
    if (!title && !dto.body?.trim()) throw new BadRequestException({ message: 'A note needs a title, text or an excerpt', code: 'VALIDATION' });
    return this.prisma.researchNote.create({
      data: {
        id: newId(),
        workspaceId,
        manuscriptId: m.id,
        nodeId: dto.nodeId ?? null,
        excerptId: excerpt?.id ?? null,
        title: title || dto.body!.trim().slice(0, 80),
        body: dto.body ?? '',
        quote: excerpt?.quote ?? null,
        source: excerpt
          ? ({ sourceId: excerpt.sourceId, sourceVersionId: excerpt.sourceVersionId, projectId: excerpt.projectId, title: excerpt.title, anchor: excerpt.anchor } as any)
          : undefined,
        createdById: u.id,
      },
    });
  }

  @RequireRole('EDITOR')
  @Patch('manuscripts/:manuscriptId/research-notes/:noteId')
  async updateNote(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('noteId') noteId: string, @Body() dto: UpdateResearchNoteDto) {
    const n = await this.note(workspaceId, manuscriptId, noteId);
    return this.prisma.researchNote.update({
      where: { id: n.id },
      data: { ...(dto.title !== undefined ? { title: dto.title } : {}), ...(dto.body !== undefined ? { body: dto.body } : {}) },
    });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete('manuscripts/:manuscriptId/research-notes/:noteId')
  async removeNote(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('noteId') noteId: string) {
    const n = await this.note(workspaceId, manuscriptId, noteId);
    await this.prisma.researchNote.delete({ where: { id: n.id } });
  }

  private async note(workspaceId: string, manuscriptId: string, noteId: string) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    if (!isUuid(noteId)) throw new NotFoundException();
    const n = await this.prisma.researchNote.findFirst({ where: { id: noteId, manuscriptId: m.id } });
    if (!n) throw new NotFoundException('Note not found');
    return n;
  }
}
