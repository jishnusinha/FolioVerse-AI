import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { RunsService } from '../runs/runs.service';
import { docText, type PMNode } from './doc';
import { type Evidence, WriterService } from './writer.service';

const SUBJECT_KINDS = ['CHARACTER', 'PLACE', 'OBJECT', 'THEME', 'EVENT'];
/** Most scenes checked by one continuity request (one T1 run each). */
export const MAX_CHECK_SCENES = 20;
/** Characters of manuscript text sent to one DNA extraction run. */
export const DNA_TEXT_LIMIT = 24_000;

class CreateFactDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) subject: string;
  @ApiPropertyOptional({ enum: SUBJECT_KINDS }) @IsOptional() @IsIn(SUBJECT_KINDS) subjectKind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) predicate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) value?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) statement?: string;
}
class UpdateFactDto {
  @ApiPropertyOptional({ enum: ['CANON', 'RETIRED'] }) @IsOptional() @IsIn(['CANON', 'RETIRED']) status?: 'CANON' | 'RETIRED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) statement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) value?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class CreateLinkDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) source: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) target: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) label: string;
}
class UpdateLinkDto {
  @ApiProperty({ enum: ['CANON', 'RETIRED'] }) @IsIn(['CANON', 'RETIRED']) status: 'CANON' | 'RETIRED';
}
class ScenesDto {
  @ApiPropertyOptional({ type: [String], description: 'Scenes to use; all scenes when omitted' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  nodeIds?: string[];
}
class UpdateIssueDto {
  @ApiProperty({ enum: ['OPEN', 'RESOLVED', 'DISMISSED'] }) @IsIn(['OPEN', 'RESOLVED', 'DISMISSED']) state: 'OPEN' | 'RESOLVED' | 'DISMISSED';
}

@ApiTags('writer')
@Controller('workspaces/:workspaceId/manuscripts/:manuscriptId')
export class DnaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: WriterService,
    private readonly runs: RunsService,
  ) {}

  /** Facts and links with their evidence re-resolved against the current manuscript text. */
  @Get('dna')
  async dna(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const [facts, links, docs, open] = await Promise.all([
      this.prisma.dnaFact.findMany({ where: { manuscriptId: m.id }, orderBy: [{ subject: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.dnaLink.findMany({ where: { manuscriptId: m.id }, orderBy: { createdAt: 'asc' } }),
      this.writer.docsByNode(m.id),
      this.prisma.continuityIssue.count({ where: { manuscriptId: m.id, state: 'OPEN' } }),
    ]);
    const resolve = (ev: unknown) => ((ev as Evidence[]) ?? []).map((e) => this.writer.resolveEvidence(docs, e));
    return {
      version: m.dnaVersion,
      openIssues: open,
      facts: facts.map((f) => ({ ...f, evidence: resolve(f.evidence) })),
      links: links.map((l) => ({ ...l, evidence: resolve(l.evidence) })),
    };
  }

  @RequireRole('EDITOR')
  @Post('dna/facts')
  async createFact(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @CurrentUser() u: AuthUser, @Body() dto: CreateFactDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const statement = dto.statement?.trim() || (dto.predicate && dto.value ? `${dto.subject}: ${dto.predicate} is ${dto.value}.` : '');
    if (!statement) throw new BadRequestException({ message: 'Give a statement, or a predicate and value', code: 'VALIDATION' });
    const fact = await this.prisma.dnaFact.create({
      data: {
        id: newId(),
        workspaceId,
        manuscriptId: m.id,
        subject: dto.subject.trim(),
        subjectKind: dto.subjectKind ?? 'CHARACTER',
        predicate: dto.predicate?.trim() || null,
        value: dto.value?.trim() || null,
        statement,
        status: 'CANON',
        origin: 'AUTHOR',
        createdById: u.id,
        decidedById: u.id,
        decidedAt: new Date(),
      },
    });
    await this.bump(m.id);
    return fact;
  }

  /** Approve (PROPOSED → CANON), reject or retire (→ RETIRED, kept so earlier checks stay explainable), or edit. */
  @RequireRole('EDITOR')
  @Patch('dna/facts/:factId')
  async updateFact(
    @Param('workspaceId') workspaceId: string,
    @Param('manuscriptId') manuscriptId: string,
    @Param('factId') factId: string,
    @CurrentUser() u: AuthUser,
    @Body() dto: UpdateFactDto,
  ) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    if (!isUuid(factId)) throw new NotFoundException();
    const f = await this.prisma.dnaFact.findFirst({ where: { id: factId, manuscriptId: m.id } });
    if (!f) throw new NotFoundException('Fact not found');
    const updated = await this.prisma.dnaFact.update({
      where: { id: f.id },
      data: {
        ...(dto.status ? { status: dto.status, decidedById: u.id, decidedAt: new Date() } : {}),
        ...(dto.status === 'RETIRED' && f.status === 'PROPOSED' && !dto.note ? { note: 'Rejected by author' } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.statement !== undefined ? { statement: dto.statement } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
      },
    });
    if (dto.status || f.status === 'CANON') await this.bump(m.id);
    return updated;
  }

  @RequireRole('EDITOR')
  @Post('dna/links')
  async createLink(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Body() dto: CreateLinkDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const link = await this.prisma.dnaLink.create({
      data: { id: newId(), workspaceId, manuscriptId: m.id, source: dto.source.trim(), target: dto.target.trim(), kind: 'AUTHOR', label: dto.label.trim(), status: 'CANON', origin: 'AUTHOR' },
    });
    await this.bump(m.id);
    return link;
  }

  @RequireRole('EDITOR')
  @Patch('dna/links/:linkId')
  async updateLink(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Param('linkId') linkId: string, @Body() dto: UpdateLinkDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    if (!isUuid(linkId)) throw new NotFoundException();
    const l = await this.prisma.dnaLink.findFirst({ where: { id: linkId, manuscriptId: m.id } });
    if (!l) throw new NotFoundException('Link not found');
    const updated = await this.prisma.dnaLink.update({ where: { id: l.id }, data: { status: dto.status } });
    await this.bump(m.id);
    return updated;
  }

  private async scenes(manuscriptId: string, nodeIds?: string[]) {
    const nodes = await this.prisma.manuscriptNode.findMany({ where: { manuscriptId, kind: 'SCENE', ...(nodeIds ? { id: { in: nodeIds } } : {}) } });
    const docs = await this.writer.docsByNode(manuscriptId, nodes.map((n) => n.id));
    return nodes.map((n) => ({ node: n, text: docs.get(n.id) ? docText(docs.get(n.id) as PMNode) : '' })).filter((s) => s.text.trim());
  }

  /** Runs `dna_extraction` over the manuscript (or the given scenes). Results arrive as PROPOSED facts and links. */
  @RequireRole('EDITOR')
  @Post('dna/extract')
  async extract(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @CurrentUser() u: AuthUser, @Body() dto: ScenesDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const scenes = await this.scenes(m.id, dto.nodeIds);
    if (!scenes.length) throw new BadRequestException({ message: 'Write something first: there is no scene text to read', code: 'NO_TEXT' });
    const text = scenes.map((s) => s.text).join('\n\n').slice(0, DNA_TEXT_LIMIT);
    return this.runs.create(workspaceId, u, {
      graph: 'dna_extraction',
      input: { text, params: { text, manuscriptId: m.id, nodeIds: scenes.map((s) => s.node.id) } },
    });
  }

  @Get('continuity')
  async issues(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Query('state') state?: string, @Query('nodeId') nodeId?: string) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const rows = await this.prisma.continuityIssue.findMany({
      where: { manuscriptId: m.id, ...(state && ['OPEN', 'RESOLVED', 'DISMISSED'].includes(state) ? { state: state as any } : {}), ...(nodeId && isUuid(nodeId) ? { nodeId } : {}) },
      orderBy: [{ state: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const docs = await this.writer.docsByNode(m.id);
    const nodes = await this.prisma.manuscriptNode.findMany({ where: { manuscriptId: m.id }, select: { id: true, title: true } });
    const title = new Map(nodes.map((n) => [n.id, n.title]));
    return rows.map((r) => ({
      ...r,
      sceneTitle: title.get(r.nodeId) ?? null,
      anchors: ((r.anchors as any[]) ?? []).map((a) => (a.nodeId && a.quote ? { ...a, ...this.writer.resolveEvidence(docs, a), sceneTitle: title.get(a.nodeId) ?? null } : a)),
    }));
  }

  /** Runs `continuity_check` per scene against CANON facts. */
  @RequireRole('EDITOR')
  @Post('continuity/check')
  async check(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @CurrentUser() u: AuthUser, @Body() dto: ScenesDto) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const { entities } = await this.writer.canon(m.id);
    if (!entities.length) throw new BadRequestException({ message: 'Approve some canon facts first: checks compare scenes with canon', code: 'NO_CANON' });
    const scenes = (await this.scenes(m.id, dto.nodeIds)).slice(0, MAX_CHECK_SCENES);
    if (!scenes.length) throw new BadRequestException({ message: 'There is no scene text to check', code: 'NO_TEXT' });
    const runs: any[] = [];
    for (const s of scenes) {
      const run = await this.runs.create(workspaceId, u, {
        graph: 'continuity_check',
        input: { text: s.text, params: { text: s.text, canon: entities, manuscriptId: m.id, nodeId: s.node.id } },
      });
      runs.push({ nodeId: s.node.id, ...run });
      if (run.status === 'BUDGET_REJECTED') break;
    }
    return { runs };
  }

  @RequireRole('EDITOR')
  @Patch('continuity/:issueId')
  async updateIssue(
    @Param('workspaceId') workspaceId: string,
    @Param('manuscriptId') manuscriptId: string,
    @Param('issueId') issueId: string,
    @CurrentUser() u: AuthUser,
    @Body() dto: UpdateIssueDto,
  ) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    if (!isUuid(issueId)) throw new NotFoundException();
    const i = await this.prisma.continuityIssue.findFirst({ where: { id: issueId, manuscriptId: m.id } });
    if (!i) throw new NotFoundException('Issue not found');
    return this.prisma.continuityIssue.update({
      where: { id: i.id },
      data: { state: dto.state, decidedById: dto.state === 'OPEN' ? null : u.id, decidedAt: dto.state === 'OPEN' ? null : new Date() },
    });
  }

  private bump(manuscriptId: string) {
    return this.prisma.manuscript.update({ where: { id: manuscriptId }, data: { dnaVersion: { increment: 1 } } });
  }
}
