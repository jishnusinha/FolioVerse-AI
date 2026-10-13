import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { StudioService } from './studio.service';

class BattleDto {
  @ApiProperty({ description: 'Finished grounded_qa run whose packed passages are frozen for every contestant' }) @IsUUID() runId: string;
  @ApiProperty({ type: [String], minItems: 2, maxItems: 4 }) @IsArray() @ArrayMinSize(2) @ArrayMaxSize(4) @IsString({ each: true }) models: string[];
  @ApiPropertyOptional({ description: 'Defaults to the source run question' }) @IsOptional() @IsString() @MaxLength(2000) question?: string;
}

class VoteDto {
  @ApiProperty({ enum: ['A', 'B', 'C', 'D', 'TIE'] }) @IsIn(['A', 'B', 'C', 'D', 'TIE']) winner: string;
}

class EvalScopeDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsUUID('all', { each: true }) sourceIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsUUID('all', { each: true }) sourceVersionIds?: string[];
}

class RetrievalOptionsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20 }) @IsOptional() @IsInt() @Min(1) @Max(20) topK?: number;
  @ApiPropertyOptional({ enum: ['rrf', 'dense', 'sparse'] }) @IsOptional() @IsIn(['rrf', 'dense', 'sparse']) fusion?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() rerank?: boolean;
  @ApiPropertyOptional({ enum: ['auto', 'child'] }) @IsOptional() @IsIn(['auto', 'child']) chunkLevel?: string;
  @ApiPropertyOptional({ minimum: 500, maximum: 12000 }) @IsOptional() @IsInt() @Min(500) @Max(12000) contextBudget?: number;
}

class EvaluationDto {
  @ApiProperty({ example: 'qa-small' }) @IsString() @MaxLength(60) dataset: string;
  @ApiProperty({ type: EvalScopeDto }) @ValidateNested() @Type(() => EvalScopeDto) scope: EvalScopeDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) modelPreference?: string;
  @ApiPropertyOptional({ type: RetrievalOptionsDto }) @IsOptional() @ValidateNested() @Type(() => RetrievalOptionsDto) options?: RetrievalOptionsDto;
  @ApiPropertyOptional({ description: 'Opt-in: grade answer relevance with a judge model (extra billed calls)' }) @IsOptional() @IsBoolean() judge?: boolean;
}

@ApiTags('studio')
@Controller('workspaces/:workspaceId/studio')
export class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Get('capabilities')
  capabilities() {
    return this.studio.capabilities();
  }

  @Get('compare')
  compare(@Param('workspaceId') workspaceId: string, @Query('runs') runs = '') {
    return this.studio.compare(workspaceId, runs.split(','));
  }

  @Get('battles')
  battles(@Param('workspaceId') workspaceId: string) {
    return this.studio.listBattles(workspaceId);
  }

  @RequireRole('EDITOR')
  @Post('battles')
  createBattle(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: BattleDto) {
    return this.studio.createBattle(workspaceId, u, dto);
  }

  @Get('battles/:battleId')
  battle(@Param('workspaceId') workspaceId: string, @Param('battleId') battleId: string) {
    return this.studio.getBattle(workspaceId, battleId);
  }

  @RequireRole('EDITOR')
  @HttpCode(200)
  @Post('battles/:battleId/vote')
  vote(@Param('workspaceId') workspaceId: string, @Param('battleId') battleId: string, @CurrentUser() u: AuthUser, @Body() dto: VoteDto) {
    return this.studio.vote(workspaceId, u, battleId, dto.winner);
  }

  @Get('evaluations')
  evaluations(@Param('workspaceId') workspaceId: string) {
    return this.studio.listEvaluations(workspaceId);
  }

  @RequireRole('EDITOR')
  @Post('evaluations')
  createEvaluation(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: EvaluationDto) {
    return this.studio.createEvaluation(workspaceId, u, dto);
  }

  @Get('evaluations/:evaluationId')
  evaluation(@Param('workspaceId') workspaceId: string, @Param('evaluationId') evaluationId: string) {
    return this.studio.getEvaluation(workspaceId, evaluationId);
  }
}
