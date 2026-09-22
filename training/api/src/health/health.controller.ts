import { Controller, Get } from '@nestjs/common';

import { healthResponse, type HealthResponse } from '../health.js';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return healthResponse();
  }
}
