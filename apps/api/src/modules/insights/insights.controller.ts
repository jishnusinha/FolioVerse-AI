import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { INSIGHT_ACTIONS } from './insight-actions';

@ApiTags('insights')
@Controller('insight-actions')
export class InsightsController {
  @Get()
  list() {
    return INSIGHT_ACTIONS;
  }
}
