import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Decimal } from 'decimal.js';
import { AuditService } from '../../common/audit.service';
import { AuthUser, CurrentUser, RequireSuperAdmin } from '../../common/auth.decorators';
import { newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { ModelsService } from '../models/models.service';
import { readSeed, registryDiff, seedModels } from '../models/seed-models';
import { AdminCostsService } from './admin-costs.service';
import { parseProviderCsv } from './cost-math';
import { ReconciliationService } from './reconciliation.service';
import { CostRollupService } from './rollup.service';

const DEC = /^\d{1,10}(\.\d{1,8})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clampDays = (v: string | undefined, d = 30) => Math.min(Math.max(Number(v) || d, 1), 365);

class ModelPatchDto {
  @ApiPropertyOptional({ enum: ['UNVERIFIED', 'VERIFIED', 'DISABLED'] }) @IsOptional() @IsIn(['UNVERIFIED', 'VERIFIED', 'DISABLED']) status?: 'UNVERIFIED' | 'VERIFIED' | 'DISABLED';
  @ApiPropertyOptional({ description: 'Make this the default chat model (clears the flag elsewhere)' }) @IsOptional() @IsBoolean() isDefault?: boolean;
}

class PriceDto {
  @ApiPropertyOptional({ enum: ['MTOK', 'CPU_HOUR'], default: 'MTOK' }) @IsOptional() @IsIn(['MTOK', 'CPU_HOUR']) unit?: 'MTOK' | 'CPU_HOUR';
  @ApiProperty({ description: 'USD per 1M input tokens, or per CPU-hour for CPU_HOUR', example: '0.40' }) @Matches(DEC) inputPerMTok: string;
  @ApiPropertyOptional({ description: 'USD per 1M output tokens (required for MTOK)' }) @IsOptional() @Matches(DEC) outputPerMTok?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) cachedInputPerMTok?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) reasoningPerMTok?: string;
  @ApiPropertyOptional({ description: 'Fraction off for batch calls, 0–1' }) @IsOptional() @Matches(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/) batchDiscount?: string;
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional({ description: 'ISO time; defaults to now' }) @IsOptional() @IsISO8601() effectiveFrom?: string;
  @ApiProperty({ description: 'Where the price was published (https), or demo:// for DEMO prices' }) @IsString() @MaxLength(500) sourceUrl: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDemo?: boolean;
}

class RollupDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 2 }) @IsOptional() @IsInt() @Min(1) @Max(365) days?: number;
}

class CsvImportDto {
  @ApiProperty({ example: 'openai' }) @IsString() @Matches(/^[a-z][a-z0-9-]{1,30}$/) provider: string;
  @ApiProperty({ description: 'CSV with a date column and an amount column (optional currency)' }) @IsString() @MaxLength(200_000) csv: string;
}

class FetchDto {
  @ApiProperty({ enum: ['openai'] }) @IsIn(['openai']) provider: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 90, default: 7 }) @IsOptional() @IsInt() @Min(1) @Max(90) days?: number;
}

class InfraDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DAY) day: string;
  @ApiProperty({ example: 'Cloud Run' }) @IsString() @Length(1, 120) service: string;
  @ApiProperty({ example: '1.25' }) @Matches(DEC) amount: string;
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDemo?: boolean;
}

class GcpImportDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 90, default: 7 }) @IsOptional() @IsInt() @Min(1) @Max(90) days?: number;
}

/** Model registry and prices. Super admins only; everyone else gets 404. */
@ApiTags('admin')
@RequireSuperAdmin()
@Controller('admin/models')
export class AdminModelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const [configs, providers] = await Promise.all([
      this.prisma.modelConfig.findMany({ orderBy: [{ isDemo: 'asc' }, { id: 'asc' }], include: { prices: { orderBy: { effectiveFrom: 'desc' } } } }),
      this.models.availableProviders(),
    ]);
    const now = new Date();
    return configs.map(({ prices, ...c }) => {
      const current = prices.find((p) => p.effectiveFrom <= now && (!p.effectiveTo || p.effectiveTo > now)) ?? null;
      return {
        ...c,
        available: providers.includes(c.provider) && c.status !== 'DISABLED',
        currentPriceId: current?.id ?? null,
        prices: prices.map((p) => ({
          ...p,
          inputPerMTok: p.inputPerMTok.toString(),
          outputPerMTok: p.outputPerMTok.toString(),
          cachedInputPerMTok: p.cachedInputPerMTok?.toString() ?? null,
          reasoningPerMTok: p.reasoningPerMTok?.toString() ?? null,
          batchDiscount: p.batchDiscount?.toString() ?? null,
          scheduled: p.effectiveFrom > now,
        })),
      };
    });
  }

  @Get('registry/diff')
  async diff() {
    const db = await this.prisma.modelConfig.findMany();
    return registryDiff(readSeed(), db);
  }

  @Post('registry/sync')
  @HttpCode(200)
  async sync(@CurrentUser() u: AuthUser) {
    const created = await seedModels(this.prisma);
    if (created.length) await this.audit.record({ actorId: u.id, action: 'model.registry_sync', resourceType: 'model_config', metadata: { created } });
    return { created };
  }

  @Patch(':modelId')
  async patch(@Param('modelId') modelId: string, @Body() dto: ModelPatchDto, @CurrentUser() u: AuthUser) {
    const c = await this.prisma.modelConfig.findUnique({ where: { id: modelId } });
    if (!c) throw new NotFoundException();
    if (dto.isDefault && !c.capabilities.includes('chat')) throw new BadRequestException({ message: 'Only chat models can be the default', code: 'NOT_CHAT_MODEL' });
    await this.prisma.$transaction([
      ...(dto.isDefault ? [this.prisma.modelConfig.updateMany({ where: { id: { not: modelId } }, data: { isDefault: false } })] : []),
      this.prisma.modelConfig.update({ where: { id: modelId }, data: { ...(dto.status ? { status: dto.status } : {}), ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}) } }),
    ]);
    await this.audit.record({ actorId: u.id, action: 'model.update', resourceType: 'model_config', resourceId: modelId, metadata: { ...dto } });
    return this.prisma.modelConfig.findUnique({ where: { id: modelId } });
  }

  @Post(':modelId/prices')
  async addPrice(@Param('modelId') modelId: string, @Body() dto: PriceDto, @CurrentUser() u: AuthUser) {
    const c = await this.prisma.modelConfig.findUnique({ where: { id: modelId } });
    if (!c) throw new NotFoundException();
    const unit = dto.unit ?? (c.provider === 'local' ? 'CPU_HOUR' : 'MTOK');
    if ((unit === 'CPU_HOUR') !== (c.provider === 'local')) {
      throw new BadRequestException({ message: 'Local compute is priced per CPU-hour; models are priced per 1M tokens', code: 'PRICE_UNIT_MISMATCH' });
    }
    if (unit === 'MTOK' && dto.outputPerMTok === undefined) throw new BadRequestException({ message: 'An output price is required', code: 'OUTPUT_PRICE_REQUIRED' });
    if ((dto.currency ?? 'USD').toUpperCase() !== 'USD') {
      throw new BadRequestException({ message: 'Only USD prices are supported: the ledger does not convert currencies', code: 'CURRENCY_UNSUPPORTED' });
    }
    const source = dto.sourceUrl.trim();
    const validSource = dto.isDemo ? /^(https:\/\/|demo:\/\/)\S+$/.test(source) : /^https:\/\/[^\s/]+\.[^\s]+$/.test(source);
    if (!validSource) throw new BadRequestException({ message: 'Give the https page where the price is published (demo:// only for DEMO prices)', code: 'SOURCE_URL_REQUIRED' });
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const clash = await this.prisma.modelPrice.findFirst({ where: { modelConfigId: modelId, effectiveFrom } });
    if (clash) throw new ConflictException({ message: 'A price with this effective time already exists', code: 'PRICE_EXISTS' });
    const latestEntry = await this.prisma.costEntry.findFirst({ where: { modelConfigId: modelId, entryType: 'FINAL' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    const price = await this.prisma.modelPrice.create({
      data: {
        id: newId(),
        modelConfigId: modelId,
        unit,
        inputPerMTok: dto.inputPerMTok,
        outputPerMTok: unit === 'CPU_HOUR' ? '0' : dto.outputPerMTok!,
        cachedInputPerMTok: unit === 'MTOK' ? (dto.cachedInputPerMTok ?? null) : null,
        reasoningPerMTok: unit === 'MTOK' ? (dto.reasoningPerMTok ?? null) : null,
        batchDiscount: unit === 'MTOK' ? (dto.batchDiscount ?? null) : null,
        currency: 'USD',
        effectiveFrom,
        sourceUrl: source,
        isDemo: !!dto.isDemo,
        enteredById: u.id,
      },
    });
    await this.audit.record({
      actorId: u.id,
      action: 'model.price_add',
      resourceType: 'model_price',
      resourceId: price.id,
      metadata: { modelConfigId: modelId, unit, inputPerMTok: dto.inputPerMTok, outputPerMTok: dto.outputPerMTok ?? null, effectiveFrom: effectiveFrom.toISOString(), sourceUrl: source, isDemo: !!dto.isDemo },
    });
    const backdated = !!latestEntry && effectiveFrom < latestEntry.createdAt;
    return {
      ...price,
      inputPerMTok: price.inputPerMTok.toString(),
      outputPerMTok: price.outputPerMTok.toString(),
      note: backdated ? 'Entries already finalized keep the price they were calculated with; this price applies to usage from now on.' : null,
    };
  }
}

/** Platform costs: overview, rollups, reconciliation and infrastructure. Super admins only. */
@ApiTags('admin')
@RequireSuperAdmin()
@Controller('admin/costs')
export class AdminCostsController {
  constructor(
    private readonly costs: AdminCostsService,
    private readonly rollups: CostRollupService,
    private readonly recon: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  overview(@Query('days') days?: string, @Query('model') model?: string) {
    return this.costs.overview(clampDays(days), model || undefined);
  }

  @Post('rollup')
  @HttpCode(200)
  async rollup(@Body() dto: RollupDto) {
    const r = await this.rollups.rollup(dto.days ?? 2);
    return { since: r.since, rows: r.rows, anomalies: r.anomalies };
  }

  @Get('reconciliation')
  reconciliation(@Query('days') days?: string) {
    return this.recon.list(clampDays(days, 14));
  }

  @Post('reconciliation/import')
  @HttpCode(200)
  async importCsv(@Body() dto: CsvImportDto, @CurrentUser() u: AuthUser) {
    const parsed = parseProviderCsv(dto.csv);
    if (!parsed.days.length) throw new BadRequestException({ message: parsed.errors[0] ?? 'No rows found', code: 'CSV_INVALID', errors: parsed.errors.slice(0, 20) });
    const results = await this.recon.importDays(dto.provider, parsed.days, 'CSV', u.id);
    await this.audit.record({ actorId: u.id, action: 'costs.reconciliation_import', resourceType: 'provider_cost_report', metadata: { provider: dto.provider, days: parsed.days.length } });
    return { results, errors: parsed.errors.slice(0, 20) };
  }

  @Post('reconciliation/fetch')
  @HttpCode(200)
  async fetchReport(@Body() dto: FetchDto, @CurrentUser() u: AuthUser) {
    const results = await this.recon.fetchOpenAi(dto.days ?? 7, u.id);
    await this.audit.record({ actorId: u.id, action: 'costs.reconciliation_fetch', resourceType: 'provider_cost_report', metadata: { provider: dto.provider, days: dto.days ?? 7 } });
    return { results, errors: [] };
  }

  @Get('infra')
  infra(@Query('days') days?: string) {
    return this.costs.infra(clampDays(days));
  }

  @Post('infra')
  async addInfra(@Body() dto: InfraDto, @CurrentUser() u: AuthUser) {
    const row = await this.costs.addInfra(dto, u.id);
    await this.audit.record({ actorId: u.id, action: 'costs.infra_add', resourceType: 'infra_cost', resourceId: row.id, metadata: { day: dto.day, service: dto.service, amount: new Decimal(dto.amount).toFixed(8) } });
    return { ...row, amount: row.amount.toString() };
  }

  @Post('infra/import-gcp')
  @HttpCode(200)
  importGcp(@Body() dto: GcpImportDto) {
    return this.costs.importGcp(dto.days ?? 7);
  }
}
