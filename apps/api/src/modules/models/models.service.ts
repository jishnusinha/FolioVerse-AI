import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { CryptoService } from '../../common/crypto.service';
import { PrismaService } from '../../infra/prisma.service';
import { seedModels } from './seed-models';

export interface ModelRef {
  modelConfigId: string;
  provider: 'mock' | 'openai' | 'ollama';
  model: string;
  contextWindow?: number;
}

export interface ModelPlan {
  primary: ModelRef;
  fallbacks: ModelRef[];
  maxOutputTokens: number;
  temperature: number;
  isDemo: boolean;
  reservation?: { reservationId?: string; amount: string; currency: string };
  budgetGuard?: {
    maxCost: string;
    prices: { inputPerMTok: string; outputPerMTok: string; cachedInputPerMTok?: string | null; reasoningPerMTok?: string | null; batchDiscount?: string | null };
  };
}

@Injectable()
export class ModelsService {
  private readonly log = new Logger('Models');
  private providerCache: { at: number; providers: string[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async ensureSeeded() {
    await seedModels(this.prisma, (m) => this.log.log(m));
  }

  /** Providers the AI service can reach (cached 60s). Mock is always available. */
  async availableProviders(): Promise<string[]> {
    if (this.providerCache && Date.now() - this.providerCache.at < 60_000) return this.providerCache.providers;
    let providers = ['mock'];
    try {
      const token = await this.crypto.signInternal('api-http', 60);
      const r = await fetch(`${env().FV_AI_API_URL}/internal/providers`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) providers = ((await r.json()) as { available: string[] }).available;
    } catch {
      /* AI service unreachable: only mock is assumed */
    }
    this.providerCache = { at: Date.now(), providers };
    return providers;
  }

  async list() {
    const [configs, providers] = await Promise.all([
      this.prisma.modelConfig.findMany({ orderBy: [{ isDemo: 'asc' }, { id: 'asc' }], include: { prices: { orderBy: { effectiveFrom: 'desc' }, take: 1 } } }),
      this.availableProviders(),
    ]);
    return configs.map((c) => ({ ...c, available: providers.includes(c.provider) && c.status !== 'DISABLED' }));
  }

  /** `fallbackIds` (lab runs only) replaces the registry fallbacks; every id must be usable. */
  async resolvePlan(preference?: string, opts: { temperature?: number; maxOutputTokens?: number; fallbackIds?: string[] } = {}): Promise<ModelPlan> {
    const providers = await this.availableProviders();
    const configs = await this.prisma.modelConfig.findMany({ where: { status: { not: 'DISABLED' } } });
    const usable = configs.filter((c) => providers.includes(c.provider));
    let primary = preference ? usable.find((c) => c.id === preference) : undefined;
    if (preference && !primary) throw new BadRequestException({ message: 'Requested model is not available', code: 'MODEL_UNAVAILABLE' });
    primary ??=
      usable.filter((c) => c.isDefault && !c.isDemo)[0] ?? usable.filter((c) => c.isDefault)[0] ?? usable.find((c) => c.provider === 'mock');
    if (!primary) throw new BadRequestException({ message: 'No model is configured', code: 'NO_MODEL' });
    const ref = (c: (typeof configs)[number]): ModelRef => ({
      modelConfigId: c.id,
      provider: c.provider as ModelRef['provider'],
      model: c.model,
      contextWindow: c.contextWindow,
    });
    if (opts.fallbackIds?.some((id) => !usable.some((c) => c.id === id))) {
      throw new BadRequestException({ message: 'Requested fallback model is not available', code: 'MODEL_UNAVAILABLE' });
    }
    const fallbackIds = (opts.fallbackIds ?? primary.fallbackIds).filter((id) => id !== primary!.id);
    const fallbacks = fallbackIds.map((id) => usable.find((c) => c.id === id)).filter(Boolean).map((c) => ref(c!));
    return {
      primary: ref(primary),
      fallbacks,
      maxOutputTokens: Math.min(opts.maxOutputTokens ?? primary.maxOutputTokens, primary.maxOutputTokens),
      temperature: opts.temperature ?? 0.2,
      isDemo: primary.isDemo,
    };
  }
}
