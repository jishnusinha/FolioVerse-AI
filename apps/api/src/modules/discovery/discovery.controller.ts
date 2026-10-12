import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, RequireRole } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { RunsService } from '../runs/runs.service';
import { DiscoveryService, FEEDBACK_ACTIONS, type FeedbackAction, presentItem } from './discovery.service';

const KINDS = ['BOOK', 'FILM'] as const;
const SEEDS = 24;

class TasteDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) genres?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) moods?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(60, { each: true }) themes?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Catalog items picked as favourites' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) seedItemIds?: string[];
}
class WeightsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) semantic?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) tfidf?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) theme?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) preference?: number;
  @ApiPropertyOptional({ description: 'Capped at 0.10 after normalisation' }) @IsOptional() @IsNumber() @Min(0) @Max(1) prior?: number;
}
class LabDto {
  @ApiPropertyOptional({ type: WeightsDto }) @IsOptional() @ValidateNested() @Type(() => WeightsDto) weights?: WeightsDto;
  @ApiPropertyOptional({ minimum: 0, maximum: 1, description: 'MMR relevance/diversity trade-off' }) @IsOptional() @IsNumber() @Min(0) @Max(1) lambda?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsInt() @Min(1) @Max(5) perCreator?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() balanceMedia?: boolean;
}
class RecommendDto {
  @ApiPropertyOptional({ description: 'What the member is in the mood for, in their own words' }) @IsOptional() @IsString() @MaxLength(500) query?: string;
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) genres?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) moods?: string[];
  @ApiPropertyOptional({ minimum: 1, maximum: 24 }) @IsOptional() @IsInt() @Min(1) @Max(24) k?: number;
  @ApiPropertyOptional({ type: LabDto, description: 'Recommendation Lab overrides; the set is logged as LAB and records no impressions' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LabDto)
  lab?: LabDto;
}
class FeedbackDto {
  @ApiProperty() @IsUUID() itemId: string;
  @ApiProperty({ enum: FEEDBACK_ACTIONS }) @IsIn(FEEDBACK_ACTIONS) action: FeedbackAction;
  @ApiPropertyOptional() @IsOptional() @IsUUID() setId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) position?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
class EvaluateDto {
  @ApiPropertyOptional({ minimum: 5, maximum: 20 }) @IsOptional() @IsInt() @Min(5) @Max(20) k?: number;
}

@ApiTags('discovery')
@Controller('workspaces/:workspaceId/discover')
export class DiscoveryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly runs: RunsService,
  ) {}

  /** Taste profile, the catalog vocabulary for onboarding, and popular titles to pick favourites from. */
  @Get('taste')
  async taste(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser) {
    const [profile, genres, moods, themes, popular, catalogSize] = await Promise.all([
      this.prisma.tasteProfile.findUnique({ where: { workspaceId_userId: { workspaceId, userId: u.id } } }),
      this.prisma.$queryRaw<{ v: string }[]>`SELECT DISTINCT unnest(genres) AS v FROM rec.catalog_items ORDER BY 1`,
      this.prisma.$queryRaw<{ v: string }[]>`SELECT DISTINCT unnest(moods) AS v FROM rec.catalog_items ORDER BY 1`,
      this.prisma.itemTheme.groupBy({ by: ['theme'], _count: { _all: true }, orderBy: { theme: 'asc' } }),
      this.prisma.catalogItem.findMany({ orderBy: [{ popularity: 'desc' }, { id: 'asc' }], take: 200, include: { themes: true } }),
      this.prisma.catalogItem.count(),
    ]);
    const seeds: typeof popular = [];
    const buckets = new Map<string, typeof popular>();
    for (const p of popular) buckets.set(`${p.kind}:${p.genres[0]}`, [...(buckets.get(`${p.kind}:${p.genres[0]}`) ?? []), p]);
    while (seeds.length < Math.min(SEEDS, popular.length)) {
      for (const b of buckets.values()) if (b.length && seeds.length < SEEDS) seeds.push(b.shift()!);
    }
    return {
      profile,
      catalogSize,
      vocabulary: { genres: genres.map((g) => g.v), moods: moods.map((m) => m.v), themes: themes.map((t) => ({ name: t.theme, count: t._count._all })) },
      seeds: seeds.map((s) => presentItem(s)),
    };
  }

  @Put('taste')
  async saveTaste(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: TasteDto) {
    const seedItemIds = dto.seedItemIds?.length
      ? (await this.prisma.catalogItem.findMany({ where: { id: { in: dto.seedItemIds } }, select: { id: true } })).map((r) => r.id)
      : [];
    const data = { genres: dto.genres ?? [], moods: dto.moods ?? [], themes: dto.themes ?? [], seedItemIds, onboardedAt: new Date() };
    return this.prisma.tasteProfile.upsert({
      where: { workspaceId_userId: { workspaceId, userId: u.id } },
      create: { id: newId(), workspaceId, userId: u.id, ...data },
      update: data,
    });
  }

  @Get('catalog')
  async catalog(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() u: AuthUser,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('genre') genre?: string,
    @Query('mood') mood?: string,
    @Query('theme') theme?: string,
    @Query('offset') offset = '0',
    @Query('limit') limit = '24',
  ) {
    const text = q?.trim().slice(0, 100);
    const where = {
      ...((KINDS as readonly string[]).includes(kind ?? '') ? { kind: kind as 'BOOK' | 'FILM' } : {}),
      ...(genre ? { genres: { has: genre } } : {}),
      ...(mood ? { moods: { has: mood } } : {}),
      ...(theme ? { themes: { some: { theme } } } : {}),
      ...(text
        ? { OR: [{ title: { contains: text, mode: 'insensitive' as const } }, { description: { contains: text, mode: 'insensitive' as const } }, { creators: { has: text } }] }
        : {}),
    };
    const take = Math.min(60, Math.max(1, Number(limit) || 24));
    const skip = Math.max(0, Number(offset) || 0);
    const [rows, total] = await Promise.all([
      this.prisma.catalogItem.findMany({ where, include: { themes: true }, orderBy: [{ popularity: 'desc' }, { id: 'asc' }], skip, take }),
      this.prisma.catalogItem.count({ where }),
    ]);
    const fb = await this.discovery.feedbackFor(workspaceId, u.id, rows.map((r) => r.id));
    return { total, items: rows.map((r) => presentItem(r, fb.get(r.id))) };
  }

  @Get('catalog/:itemId')
  item(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string) {
    return this.discovery.catalogItem(workspaceId, u.id, itemId);
  }

  /** Nearest titles in the model's semantic space; `otherKind=true` gives related films for a book and vice versa. */
  @Get('catalog/:itemId/similar')
  similar(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('itemId') itemId: string, @Query('otherKind') otherKind?: string) {
    return this.discovery.similar(workspaceId, u.id, itemId, otherKind === 'true');
  }

  /**
   * Ranks the catalog for the caller (scoring only; no language model, nothing billed). The call is logged with
   * its inputs, weights, model version, stage counts and per-item factor values; Discover sets also log impressions.
   */
  @Post('recommendations')
  recommend(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: RecommendDto) {
    return this.discovery.recommend(workspaceId, u.id, dto);
  }

  @Get('recommendations/latest')
  async latest(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Query('mode') mode?: string) {
    return (await this.discovery.latest(workspaceId, u.id, mode === 'LAB' ? 'LAB' : 'DISCOVER')) ?? { id: null, items: [] };
  }

  @Get('recommendations/:setId')
  set(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('setId') setId: string) {
    return this.discovery.set(workspaceId, u.id, setId);
  }

  /** Natural-language rationale from the logged factors (`rec_explain`, T0). Creates a billed run. */
  @RequireRole('EDITOR')
  @Post('recommendations/:setId/items/:itemId/explain')
  async explain(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Param('setId') setId: string, @Param('itemId') itemId: string) {
    if (!isUuid(setId) || !isUuid(itemId)) throw new NotFoundException();
    const row = await this.prisma.recommendationItem.findFirst({
      where: { setId, itemId, set: { workspaceId, userId: u.id } },
      include: { item: { include: { themes: true } } },
    });
    if (!row) throw new NotFoundException('Recommendation not found');
    const item = presentItem(row.item);
    const run = await this.runs.create(workspaceId, u, {
      graph: 'rec_explain',
      input: {
        text: `Why was “${item.title}” recommended?`,
        params: {
          setId,
          itemId,
          item: { title: item.title, kind: item.kind, creators: item.creators, year: item.year, genres: item.genres, moods: item.moods, themes: item.themes, description: item.description },
          factors: row.factors,
          adjustments: row.adjustments,
          sharedThemes: row.sharedThemes,
          becauseOf: row.becauseOf,
        },
      },
    });
    await this.prisma.interaction.create({ data: { id: newId(), workspaceId, userId: u.id, itemId, kind: 'EXPLAIN', setId, position: row.rank } });
    return run;
  }

  @Post('feedback')
  feedback(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: FeedbackDto) {
    return this.discovery.feedback(workspaceId, u.id, dto.itemId, dto.action, dto);
  }

  @Get('saved')
  saved(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser) {
    return this.discovery.saved(workspaceId, u.id);
  }

  /** Manifest of the served model artifact (version, training data hashes, parameters). */
  @Get('model')
  model() {
    return this.discovery.model();
  }

  /** Queues an offline evaluation of the served model on the synthetic holdout split (worker job). */
  @RequireRole('EDITOR')
  @Post('evaluations')
  evaluate(@Param('workspaceId') workspaceId: string, @CurrentUser() u: AuthUser, @Body() dto: EvaluateDto) {
    return this.discovery.queueEvaluation(workspaceId, u.id, dto.k ?? 10);
  }

  @Get('evaluations')
  evaluations(@Param('workspaceId') workspaceId: string) {
    return this.discovery.evaluations(workspaceId);
  }

  @Get('evaluations/:id')
  evaluation(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.discovery.evaluation(workspaceId, id);
  }
}
