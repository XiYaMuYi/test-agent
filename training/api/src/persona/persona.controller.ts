import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { PersonaService, type BuildPersonaInput } from './persona.service.js';

/**
 * Read-only persona setup endpoints for the C-end mini program:
 *   GET  /me/persona/presets — fixed age/psychology/difficulty/scenario options
 *   POST /me/persona/preview  — build + validate a frozen PersonaConfig snapshot (no persistence)
 *
 * Personal-template persistence arrives with the training_template (T7) step.
 */
@Controller(['me/persona', 'training/persona'])
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin', 'streamer')
export class PersonaController {
  public constructor(private readonly personas: PersonaService) {}

  @Get('presets')
  getPresets(): unknown {
    return this.personas.getPresetCatalog();
  }

  @Post('preview')
  preview(@Principal() _principal: CurrentPrincipal, @Body() body: BuildPersonaInput): unknown {
    return this.personas.buildPersonaConfig(body);
  }
}
