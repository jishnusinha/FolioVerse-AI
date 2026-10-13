import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { emptyDoc, type PMNode } from './doc';
import { compile, fileSlug, toDocx, toMarkdown } from './export';
import { WriterService } from './writer.service';

const KINDS = ['PART', 'CHAPTER', 'SCENE'] as const;
type Kind = (typeof KINDS)[number];
/** Allowed parent kind per node kind (`null` = top level). */
const PARENT: Record<Kind, (Kind | null)[]> = { PART: [null], CHAPTER: [null, 'PART'], SCENE: ['CHAPTER'] };

class CreateManuscriptDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional({ description: 'WRITER project; a new one is created when omitted' }) @IsOptional() @IsUUID() projectId?: string;
}
class UpdateManuscriptDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) dailyGoal?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
}
class CreateNodeDto {
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS as unknown as string[]) kind: Kind;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) position?: number;
}
class UpdateNodeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) pov?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) position?: number;
}
class SaveDocDto {
  @ApiProperty({ description: 'TipTap JSON document' }) @IsObject() content: Record<string, unknown>;
  @ApiProperty({ description: 'Revision the edit is based on (optimistic concurrency)' }) @IsInt() @Min(0) revision: number;
  @ApiPropertyOptional({ enum: ['accept', 'undo'] }) @IsOptional() @IsIn(['accept', 'undo']) action?: 'accept' | 'undo';
  @ApiPropertyOptional() @IsOptional() @IsUUID() suggestionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(5) variant?: number;
}
class RestoreDto {
  @ApiProperty({ description: 'Current revision (optimistic concurrency)' }) @IsInt() @Min(0) revision: number;
}

@ApiTags('writer')
@Controller('workspaces/:workspaceId')
export class ManuscriptsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: WriterService,
    private readonly audit: AuditService,
  ) {}

  @Get('manuscripts')
  async list(@Param('workspaceId') workspaceId: string, @Query('projectId') projectId?: string) {
    const rows = await this.prisma.manuscript.findMany({
      where: { workspaceId, deletedAt: null, ...(projectId && isUuid(projectId) ? { projectId } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const sums = await this.prisma.manuscriptNode.groupBy({ by: ['manuscriptId'], where: { manuscriptId: { in: rows.map((r) => r.id) }, kind: 'SCENE' }, _sum: { wordCount: true }, _count: true });
    const by = new Map(sums.map((s) => [s.manuscriptId, s]));
    return rows.map((r) => ({ ...r, words: by.get(r.id)?._sum.wordCount ?? 0, scenes: by.get(r.id)?._count ?? 0 }));
  }

  @RequireRole('EDITOR')
  @Post('manuscripts')
  async create(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateManuscriptDto) {
    let projectId = dto.projectId;
    if (projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null } });
      if (!p) throw new NotFoundException('Project not found');
      if (p.kind !== 'WRITER') throw new BadRequestException({ message: 'Manuscripts belong to writing projects', code: 'NOT_A_WRITER_PROJECT' });
    } else {
      projectId = newId();
      await this.prisma.project.create({ data: { id: projectId, workspaceId, name: dto.title, kind: 'WRITER', createdById: u.id } });
    }
    const id = newId();
    const part = newId();
    const chapter = newId();
    const scene = newId();
    await this.prisma.$transaction([
      this.prisma.manuscript.create({ data: { id, workspaceId, projectId, title: dto.title, createdById: u.id } }),
      this.prisma.manuscriptNode.create({ data: { id: part, workspaceId, manuscriptId: id, kind: 'PART', title: 'Part One', position: 0 } }),
      this.prisma.manuscriptNode.create({ data: { id: chapter, workspaceId, manuscriptId: id, parentId: part, kind: 'CHAPTER', title: 'Chapter 1', position: 0 } }),
      this.prisma.manuscriptNode.create({ data: { id: scene, workspaceId, manuscriptId: id, parentId: chapter, kind: 'SCENE', title: 'Scene 1', position: 0 } }),
      this.prisma.richDoc.create({ data: { id: newId(), workspaceId, manuscriptId: id, nodeId: scene, content: emptyDoc() as any } }),
    ]);
    await this.audit.record({ workspaceId, actorId: u.id, action: 'manuscript.create', resourceType: 'manuscript', resourceId: id });
    return this.get(workspaceId, id);
  }

  @Get('manuscripts/:manuscriptId')
  async get(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') id: string) {
    const m = await this.writer.manuscript(workspaceId, id);
    const [nodes, project, stats] = await Promise.all([
      this.prisma.manuscriptNode.findMany({ where: { manuscriptId: m.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.project.findUnique({ where: { id: m.projectId }, select: { id: true, name: true } }),
      this.writer.stats(m.id),
    ]);
    return { ...m, project, nodes, stats };
  }

  @RequireRole('EDITOR')
  @Patch('manuscripts/:manuscriptId')
  async update(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') id: string, @Body() dto: UpdateManuscriptDto) {
    await this.writer.manuscript(workspaceId, id);
    await this.prisma.manuscript.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.dailyGoal !== undefined ? { dailyGoal: dto.dailyGoal } : {}),
        ...(dto.archived !== undefined ? { archivedAt: dto.archived ? new Date() : null } : {}),
      },
    });
    return this.get(workspaceId, id);
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete('manuscripts/:manuscriptId')
  async remove(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') id: string, @CurrentUser() u: AuthUser) {
    await this.writer.manuscript(workspaceId, id);
    await this.prisma.manuscript.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ workspaceId, actorId: u.id, action: 'manuscript.trash', resourceType: 'manuscript', resourceId: id });
  }

  private async checkParent(manuscriptId: string, kind: Kind, parentId: string | null | undefined) {
    const parent = parentId ? await this.prisma.manuscriptNode.findFirst({ where: { id: parentId, manuscriptId } }) : null;
    if (parentId && !parent) throw new NotFoundException('Parent not found');
    if (!PARENT[kind].includes((parent?.kind as Kind) ?? null)) {
      throw new BadRequestException({ message: `A ${kind.toLowerCase()} cannot go ${parent ? `inside a ${parent.kind.toLowerCase()}` : 'at the top level'}`, code: 'INVALID_PARENT' });
    }
    return parent;
  }

  /** Renumbers siblings 0..n-1, placing `moved` at `position`. */
  private async reorder(manuscriptId: string, parentId: string | null, moved: string, position?: number) {
    const sibs = await this.prisma.manuscriptNode.findMany({ where: { manuscriptId, parentId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    const rest = sibs.filter((s) => s.id !== moved);
    const at = Math.min(position ?? rest.length, rest.length);
    const ordered = [...rest.slice(0, at), sibs.find((s) => s.id === moved)!, ...rest.slice(at)].filter(Boolean);
    await this.prisma.$transaction(ordered.map((s, i) => this.prisma.manuscriptNode.update({ where: { id: s.id }, data: { position: i } })));
  }

  @RequireRole('EDITOR')
  @Post('manuscripts/:manuscriptId/nodes')
  async createNode(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Body() dto: CreateNodeDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    await this.checkParent(m.id, dto.kind, dto.parentId);
    const id = newId();
    const count = await this.prisma.manuscriptNode.count({ where: { manuscriptId: m.id, parentId: dto.parentId ?? null } });
    await this.prisma.manuscriptNode.create({ data: { id, workspaceId, manuscriptId: m.id, parentId: dto.parentId ?? null, kind: dto.kind, title: dto.title, position: count } });
    if (dto.kind === 'SCENE') await this.prisma.richDoc.create({ data: { id: newId(), workspaceId, manuscriptId: m.id, nodeId: id, content: emptyDoc() as any } });
    if (dto.position !== undefined) await this.reorder(m.id, dto.parentId ?? null, id, dto.position);
    return this.prisma.manuscriptNode.findUniqueOrThrow({ where: { id } });
  }

  @RequireRole('EDITOR')
  @Patch('manuscripts/:manuscriptId/nodes/:nodeId')
  async updateNode(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('nodeId') nodeId: string, @Body() dto: UpdateNodeDto) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    const n = await this.writer.node(workspaceId, manuscriptId, nodeId);
    const moving = dto.parentId !== undefined && dto.parentId !== n.parentId;
    if (moving) {
      await this.checkParent(manuscriptId, n.kind as Kind, dto.parentId);
      if (dto.parentId === n.id) throw new BadRequestException({ message: 'A node cannot contain itself', code: 'INVALID_PARENT' });
    }
    await this.prisma.manuscriptNode.update({
      where: { id: n.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.pov !== undefined ? { pov: dto.pov || null } : {}),
        ...(moving ? { parentId: dto.parentId ?? null, position: 1_000_000 } : {}),
      },
    });
    if (moving || dto.position !== undefined) await this.reorder(manuscriptId, moving ? (dto.parentId ?? null) : n.parentId, n.id, dto.position);
    if (moving) await this.reorder(manuscriptId, n.parentId, '');
    return this.prisma.manuscriptNode.findUniqueOrThrow({ where: { id: n.id } });
  }

  @RequireRole('EDITOR')
  @HttpCode(204)
  @Delete('manuscripts/:manuscriptId/nodes/:nodeId')
  async removeNode(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('nodeId') nodeId: string) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    const n = await this.writer.node(workspaceId, manuscriptId, nodeId);
    const all = await this.prisma.manuscriptNode.findMany({ where: { manuscriptId }, select: { id: true, parentId: true } });
    const ids = new Set([n.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of all) {
        if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
          ids.add(x.id);
          grew = true;
        }
      }
    }
    const list = [...ids];
    await this.prisma.$transaction([
      this.prisma.suggestion.deleteMany({ where: { manuscriptId, nodeId: { in: list } } }),
      this.prisma.continuityIssue.deleteMany({ where: { manuscriptId, nodeId: { in: list } } }),
      this.prisma.manuscriptNode.deleteMany({ where: { id: { in: list }, manuscriptId } }),
    ]);
    await this.reorder(manuscriptId, n.parentId, '');
  }

  @Get('manuscripts/:manuscriptId/nodes/:nodeId/doc')
  async getDoc(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('nodeId') nodeId: string) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    const d = await this.writer.doc(workspaceId, manuscriptId, nodeId);
    return { id: d.id, nodeId: d.nodeId, content: d.content, text: d.text, revision: d.revision, wordCount: d.wordCount, updatedAt: d.updatedAt };
  }

  @RequireRole('EDITOR')
  @Patch('manuscripts/:manuscriptId/nodes/:nodeId/doc')
  async saveDoc(
    @Param('workspaceId') workspaceId: string,
    @Param('manuscriptId') manuscriptId: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() u: AuthUser,
    @Body() dto: SaveDocDto,
  ) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    return this.writer.saveDoc(workspaceId, u.id, manuscriptId, nodeId, dto);
  }

  @Get('manuscripts/:manuscriptId/nodes/:nodeId/doc/revisions')
  async revisions(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('nodeId') nodeId: string) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    const d = await this.writer.doc(workspaceId, manuscriptId, nodeId);
    return this.prisma.docRevision.findMany({
      where: { docId: d.id },
      orderBy: { revision: 'desc' },
      take: 200,
      select: { id: true, revision: true, origin: true, wordCount: true, note: true, createdById: true, createdAt: true, updatedAt: true },
    });
  }

  @Get('manuscripts/:manuscriptId/nodes/:nodeId/doc/revisions/:revision')
  async revision(
    @Param('workspaceId') workspaceId: string,
    @Param('manuscriptId') manuscriptId: string,
    @Param('nodeId') nodeId: string,
    @Param('revision', new ParseIntPipe({ errorHttpStatusCode: 404 })) revision: number,
  ) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    const d = await this.writer.doc(workspaceId, manuscriptId, nodeId);
    const r = await this.prisma.docRevision.findFirst({ where: { docId: d.id, revision } });
    if (!r) throw new NotFoundException('Revision not found');
    return r;
  }

  @RequireRole('EDITOR')
  @Post('manuscripts/:manuscriptId/nodes/:nodeId/doc/revisions/:revision/restore')
  async restore(
    @Param('workspaceId') workspaceId: string,
    @Param('manuscriptId') manuscriptId: string,
    @Param('nodeId') nodeId: string,
    @Param('revision', new ParseIntPipe({ errorHttpStatusCode: 404 })) revision: number,
    @CurrentUser() u: AuthUser,
    @Body() dto: RestoreDto,
  ) {
    await this.writer.manuscript(workspaceId, manuscriptId);
    return this.writer.restore(workspaceId, u.id, manuscriptId, nodeId, revision, dto.revision);
  }

  private async compiled(workspaceId: string, id: string) {
    const m = await this.writer.manuscript(workspaceId, id);
    const nodes = await this.prisma.manuscriptNode.findMany({ where: { manuscriptId: m.id } });
    const docs = await this.prisma.richDoc.findMany({ where: { manuscriptId: m.id } });
    return compile(m.title, nodes as any, new Map(docs.map((d) => [d.nodeId, d.content as unknown as PMNode])));
  }

  /** Ordered outline with scene blocks and numbered footnotes (print view / PDF via print CSS). */
  @Get('manuscripts/:manuscriptId/compiled')
  compiledView(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') id: string) {
    return this.compiled(workspaceId, id);
  }

  @Get('manuscripts/:manuscriptId/export')
  async export(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') id: string, @Query('format') format: string, @Res() res: Response) {
    if (format !== 'md' && format !== 'docx') throw new BadRequestException({ message: 'format must be md or docx', code: 'VALIDATION' });
    const c = await this.compiled(workspaceId, id);
    const name = fileSlug(c.title);
    if (format === 'md') {
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${name}.md"`);
      res.send(toMarkdown(c));
      return;
    }
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('content-disposition', `attachment; filename="${name}.docx"`);
    res.send(await toDocx(c));
  }
}
