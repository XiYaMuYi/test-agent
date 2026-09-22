import { Controller, Get, UseGuards } from '@nestjs/common';

import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { PersonaService } from './persona.service.js';

@Controller('training')
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin', 'streamer')
export class TrainingBootstrapController {
  public constructor(private readonly personas: PersonaService) {}

  @Get('bootstrap')
  getBootstrap(): unknown {
    return { enabled: process.env.TRAINING_ENABLED !== 'false', ...this.personas.getPresetCatalog() };
  }
}
