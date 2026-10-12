import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { RunsService } from '../runs/runs.service';
import { proseBlocks, type PMNode } from './doc';
import { REVISION_MODES, WriterService } from './writer.service';

/** Most paragraphs revised by one batch request (one T0 run each). */
export const MAX_BATCH = 20;

class RequestSuggestionsDto {
  @ApiProperty({ enum: Object.keys(REVISION_MODES) }) @IsIn(Object.keys(REVISION_MODES)) mode: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(MAX_BATCH) @IsString({ each: true }) blockIds?: string[];
  @ApiPropertyOptional({ description: 'Batch mode: every non-empty paragraph in the scene' }) @IsOptional() @IsBoolean() all?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) tone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) instruction?: string;
}
class UpdateSuggestionDto {
  @ApiProperty({ enum: ['REJECTED', 'PENDING'], description: 'Reject, or undo a rejection' }) @IsIn(['REJECTED', 'PENDING']) state: 'REJECTED' | 'PENDING';
}

@ApiTags('writer')
@Controller('workspaces/:workspaceId')
export class SuggestionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: WriterService,
    private readonly runs: RunsService,
  ) {}

  @Get('manuscripts/:manuscriptId/suggestions')
  async list(@Param('workspaceId') workspaceId: string, @Param('manuscriptId') manuscriptId: string, @Query('nodeId') nodeId?: string, @Query('state') state?: string) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const rows = await this.prisma.suggestion.findMany({
      where: { manuscriptId: m.id, workspaceId, ...(nodeId && isUuid(nodeId) ? { nodeId } : {}), ...(state ? { state: state as any } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const runs = await this.prisma.aiRun.findMany({ where: { id: { in: rows.map((r) => r.runId!).filter(Boolean) } }, select: { id: true, status: true, outcome: true, isDemo: true, error: true } });
    const byId = new Map(runs.map((r) => [r.id, r]));
    return rows.map((r) => ({ ...r, run: r.runId ? (byId.get(r.runId) ?? null) : null }));
  }

  /** Requests rewrites for selected paragraphs (or the whole scene). Older open suggestions on those paragraphs are SUPERSEDED. */
  @RequireRole('EDITOR')
  @Post('manuscripts/:manuscriptId/nodes/:nodeId/suggestions')
  async request(
    @Param('workspaceId') workspaceId: string,
    @Param('manuscriptId') manuscriptId: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() u: AuthUser,
    @Body() dto: RequestSuggestionsDto,
  ) {
    const m = await this.writer.manuscript(workspaceId, manuscriptId);
    const doc = await this.writer.doc(workspaceId, m.id, nodeId);
    const blocks = proseBlocks(doc.content as unknown as PMNode).filter((b) => b.text.trim());
    const picked = dto.all ? blocks.slice(0, MAX_BATCH) : blocks.filter((b) => dto.blockIds?.includes(b.blockId));
    if (!picked.length) throw new BadRequestException({ message: 'Select at least one paragraph with text', code: 'NO_TEXT' });
    const { facts } = await this.writer.canon(m.id);
    const batchId = picked.length > 1 ? newId() : null;
    const instruction = dto.instruction?.trim() || (dto.mode === 'tone' && dto.tone ? `Rewrite in a ${dto.tone} tone.` : REVISION_MODES[dto.mode]);
    const out: any[] = [];
    let budgetRejected = false;
    for (const b of picked) {
      const lower = b.text.toLowerCase();
      const constraints = facts.filter((f) => lower.includes(f.subject.toLowerCase())).map((f) => f.statement).slice(0, 20);
      await this.prisma.suggestion.updateMany({ where: { docId: doc.id, blockId: b.blockId, state: { in: ['PENDING', 'STALE'] } }, data: { state: 'SUPERSEDED' } });
      const id = newId();
      await this.prisma.suggestion.create({
        data: {
          id,
          workspaceId,
          manuscriptId: m.id,
          docId: doc.id,
          nodeId: doc.nodeId,
          blockId: b.blockId,
          batchId,
          mode: dto.mode,
          tone: dto.tone ?? null,
          instruction,
          baseRevision: doc.revision,
          baseText: b.text,
          createdById: u.id,
        },
      });
      const run = await this.runs.create(workspaceId, u, {
        graph: 'writer_revision',
        input: { text: b.text, params: { text: b.text, mode: dto.mode, tone: dto.tone, instruction, constraints, manuscriptId: m.id, nodeId: doc.nodeId, blockId: b.blockId, suggestionId: id } },
      });
      if (run.status === 'BUDGET_REJECTED') {
        await this.prisma.suggestion.delete({ where: { id } });
        budgetRejected = true;
        break;
      }
      const row = await this.prisma.aiRun.findUnique({ where: { id: run.runId }, select: { isDemo: true } });
      await this.prisma.suggestion.update({ where: { id }, data: { runId: run.runId, isDemo: row?.isDemo ?? false } });
      out.push({ id, blockId: b.blockId, runId: run.runId, estimate: run.estimate });
    }
    if (!out.length && budgetRejected) throw new ConflictException({ message: 'Budget limit reached before any model call', code: 'BUDGET_REJECTED' });
    return { batchId, suggestions: out, budgetRejected };
  }

  @RequireRole('EDITOR')
  @Patch('suggestions/:suggestionId')
  async update(@Param('workspaceId') workspaceId: string, @Param('suggestionId') id: string, @Body() dto: UpdateSuggestionDto) {
    if (!isUuid(id)) throw new NotFoundException();
    const s = await this.prisma.suggestion.findFirst({ where: { id, workspaceId } });
    if (!s) throw new NotFoundException('Suggestion not found');
    const allowed = dto.state === 'REJECTED' ? ['PENDING', 'STALE'] : ['REJECTED'];
    if (!allowed.includes(s.state)) throw new ConflictException({ message: `A ${s.state.toLowerCase()} suggestion cannot become ${dto.state.toLowerCase()}`, code: 'INVALID_TRANSITION' });
    if (dto.state === 'PENDING') {
      const doc = await this.prisma.richDoc.findUniqueOrThrow({ where: { id: s.docId } });
      const cur = proseBlocks(doc.content as unknown as PMNode).find((b) => b.blockId === s.blockId)?.text ?? null;
      const state = cur !== null && cur.replace(/\s+/g, ' ').trim() === s.baseText.replace(/\s+/g, ' ').trim() ? 'PENDING' : 'STALE';
      return this.prisma.suggestion.update({ where: { id }, data: { state, decidedAt: null } });
    }
    return this.prisma.suggestion.update({ where: { id }, data: { state: 'REJECTED', decidedAt: new Date() } });
  }
}
