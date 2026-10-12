import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';

class CreateNoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10_000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) quote?: string;
  @ApiPropertyOptional({ description: 'Source anchor (page, textPosition, textQuote)' }) @IsOptional() @IsObject() anchor?: Record<string, unknown>;
}
class UpdateNoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10_000) body: string;
}

@ApiTags('notes')
@Controller('workspaces/:workspaceId/notes')
export class NotesController {
  constructor(private readonly prisma: PrismaService) {}

  private async note(workspaceId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const n = await this.prisma.note.findFirst({ where: { id, workspaceId } });
    if (!n) throw new NotFoundException();
    return n;
  }

  @Get()
  list(@Param('workspaceId') workspaceId: string, @Query('sourceId') sourceId?: string, @Query('projectId') projectId?: string) {
    const where: Prisma.NoteWhereInput = { workspaceId };
    if (sourceId && isUuid(sourceId)) where.sourceId = sourceId;
    if (projectId && isUuid(projectId)) where.projectId = projectId;
    return this.prisma.note.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @RequireRole('EDITOR')
  @Post()
  async create(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateNoteDto) {
    let projectId: string | null = null;
    if (dto.sourceId) {
      const s = await this.prisma.source.findFirst({ where: { id: dto.sourceId, workspaceId, deletedAt: null } });
      if (!s) throw new NotFoundException('Source not found');
      projectId = s.projectId;
      if (dto.sourceVersionId) {
        const v = await this.prisma.sourceVersion.findFirst({ where: { id: dto.sourceVersionId, sourceId: s.id, workspaceId } });
        if (!v) throw new NotFoundException('Version not found');
      }
    } else if (dto.sourceVersionId) {
      throw new NotFoundException('Version not found');
    }
    return this.prisma.note.create({
      data: {
        id: newId(),
        workspaceId,
        projectId,
        sourceId: dto.sourceId ?? null,
        sourceVersionId: dto.sourceVersionId ?? null,
        body: dto.body,
        quote: dto.quote ?? null,
        anchor: (dto.anchor ?? undefined) as any,
        createdById: u.id,
      },
    });
  }

  @RequireRole('EDITOR')
  @Patch(':noteId')
  async update(@Param('workspaceId') workspaceId: string, @Param('noteId') id: string, @Body() dto: UpdateNoteDto) {
    await this.note(workspaceId, id);
    return this.prisma.note.update({ where: { id }, data: { body: dto.body } });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete(':noteId')
  async remove(@Param('workspaceId') workspaceId: string, @Param('noteId') id: string) {
    await this.note(workspaceId, id);
    await this.prisma.note.delete({ where: { id } });
  }
}
