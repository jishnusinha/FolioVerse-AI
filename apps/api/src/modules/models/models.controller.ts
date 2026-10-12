import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ModelsService } from './models.service';

@ApiTags('models')
@Controller('models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  async list() {
    const rows = await this.models.list();
    return rows.map((m) => ({
      id: m.id,
      provider: m.provider,
      model: m.model,
      displayName: m.displayName,
      status: m.status,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      isDemo: m.isDemo,
      isDefault: m.isDefault,
      available: m.available,
      price: m.prices[0]
        ? {
            inputPerMTok: m.prices[0].inputPerMTok.toString(),
            outputPerMTok: m.prices[0].outputPerMTok.toString(),
            cachedInputPerMTok: m.prices[0].cachedInputPerMTok?.toString() ?? null,
            isDemo: m.prices[0].isDemo,
            sourceUrl: m.prices[0].sourceUrl,
          }
        : null,
    }));
  }
}
