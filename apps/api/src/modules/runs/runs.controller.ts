import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { AiClientService } from '../ai-client/ai-client.service';
import { GRAPH_TIERS, RunsService } from './runs.service';

class RunInputDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) question?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50000) text?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() params?: Record<string, unknown>;
}
class RunScopeDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsUUID('all', { each: true }) sourceIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsUUID('all', { each: true }) sourceVersionIds?: string[];
}
export class RunSpecDto {
  @ApiProperty({ enum: Object.keys(GRAPH_TIERS) }) @IsIn(Object.keys(GRAPH_TIERS)) graph: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() threadId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentMessageId?: string;
  @ApiProperty({ type: RunInputDto }) @ValidateNested() @Type(() => RunInputDto) input: RunInputDto;
  @ApiPropertyOptional({ type: RunScopeDto }) @IsOptional() @ValidateNested() @Type(() => RunScopeDto) scope?: RunScopeDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) modelPreference?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() lab?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() options?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [String], description: 'Lab runs only: fallback models replacing the registry fallbacks' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  fallbackModels?: string[];
  @ApiPropertyOptional({ description: 'Lab runs only: run a chat graph without creating a conversation thread' })
  @IsOptional()
  @IsBoolean()
  detached?: boolean;
}
class ForkDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) checkpointId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) modelPreference?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() inputOverride?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() options?: Record<string, unknown>;
}

class ResumeRunDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() inputOverride?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() options?: Record<string, unknown>;
}

@ApiTags('runs')
@Controller('workspaces/:workspaceId')
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly ai: AiClientService,
  ) {}

  @RequireRole('EDITOR')
  @Post('runs')
  create(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: RunSpecDto) {
    return this.runs.create(workspaceId, u, dto);
  }

  @Get('runs')
  list(
    @Param('workspaceId') workspaceId: string,
    @Query('graph') graph?: string,
    @Query('status') status?: string,
    @Query('lab') lab?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runs.list(workspaceId, { graph, status, lab, limit: limit ? Number(limit) : undefined });
  }

  @Get('runs/:runId')
  get(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string) {
    return this.runs.getRun(workspaceId, runId);
  }

  @RequireRole('EDITOR')
  @HttpCode(202)
  @Post('runs/:runId/cancel')
  cancel(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string) {
    return this.runs.cancel(workspaceId, runId);
  }

  @RequireRole('EDITOR')
  @Post('runs/:runId/resume')
  resume(
    @Param('workspaceId') workspaceId: string,
    @Param('runId') runId: string,
    @CurrentUser() u: AuthUser,
    @Body() dto?: ResumeRunDto,
  ) {
    return this.runs.approveOrResume(workspaceId, runId, u, dto);
  }

  @RequireRole('EDITOR')
  @Post('runs/:runId/approve')
  approve(
    @Param('workspaceId') workspaceId: string,
    @Param('runId') runId: string,
    @CurrentUser() u: AuthUser,
    @Body() dto?: ResumeRunDto,
  ) {
    return this.runs.approveOrResume(workspaceId, runId, u, dto);
  }

  @Get('runs/:runId/receipt')
  receipt(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string) {
    return this.runs.receipt(workspaceId, runId);
  }

  @Get('runs/:runId/trace')
  trace(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string) {
    return this.runs.trace(workspaceId, runId);
  }

  /** Read-only checkpoint history from the LangGraph Postgres checkpointer (time machine). */
  @Get('runs/:runId/checkpoints')
  async checkpoints(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string) {
    await this.runs.getRun(workspaceId, runId);
    return this.ai.json(`/internal/runs/${runId}/checkpoints`);
  }

  @Get('runs/:runId/checkpoints/:checkpointId')
  async checkpoint(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Param('checkpointId') checkpointId: string) {
    await this.runs.getRun(workspaceId, runId);
    const { checkpoints } = await this.ai.json<{ checkpoints: { checkpointId: string }[] }>(`/internal/runs/${runId}/checkpoints`);
    const cp = checkpoints.find((c) => c.checkpointId === checkpointId);
    if (!cp) throw new NotFoundException();
    return cp;
  }

  /**
   * Re-execution from a run (optionally from a checkpoint). Always creates a NEW run that is
   * billed separately; replaying a recorded trace never calls this.
   */
  @RequireRole('EDITOR')
  @Post('runs/:runId/fork')
  async fork(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @CurrentUser() u: AuthUser, @Body() dto: ForkDto) {
    const parent = await this.runs.getRun(workspaceId, runId);
    const scope = (parent.scope as any) ?? {};
    return this.runs.create(workspaceId, u, {
      graph: parent.graph,
      input: { ...(parent.input as any), ...(dto.inputOverride ?? {}) },
      scope: { sourceVersionIds: scope.sourceVersionIds ?? [] },
      modelPreference: dto.modelPreference ?? (parent.modelPlan as any)?.primary?.modelConfigId,
      lab: true,
      detached: true,
      options: { ...((parent.options as any) ?? {}), ...(dto.options ?? {}) },
      parentRunId: parent.id,
      forkedFromCheckpoint: dto.checkpointId,
    });
  }

  @Get('budget')
  budget(@Param('workspaceId') workspaceId: string) {
    return this.runs.budgetStatus(workspaceId);
  }

  @Get('graphs/:name')
  async graph(@Param('name') name: string) {
    if (!GRAPH_TIERS[name]) throw new NotFoundException();
    return this.ai.json(`/internal/graphs/${name}`);
  }
}
