import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { ConfigMetaController } from './config-meta.controller.js';
import { PersonaController } from './persona.controller.js';
import { PersonaService } from './persona.service.js';
import { TrainingBootstrapController } from './training-bootstrap.controller.js';

/**
 * Persona (customer profile) domain: fixed presets, snapshot assembly and validation.
 *
 * PersonaService is a pure domain service (no database) and is exported so the
 * session module (T3) can freeze a persona snapshot when a free session starts.
 * Contract: docs/architecture/contracts/c-first-dual-track-contract.md §5.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PersonaController, TrainingBootstrapController, ConfigMetaController],
  providers: [PersonaService],
  exports: [PersonaService],
})
export class PersonaModule {}
