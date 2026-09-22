import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { PersonaModule } from '../persona/persona.module.js';
import { PersonaService } from '../persona/persona.service.js';
import { TemplateController } from './template.controller.js';
import { TemplateService } from './template.service.js';

/**
 * Training-template domain: platform/organization/personal three-layer supply and
 * learner visibility. Exports TemplateService so SessionModule can resolve a
 * free-session template against the same visibility matrix.
 * Contract: docs/architecture/contracts/c-first-dual-track-contract.md §3.2, §7.
 */
@Module({
  imports: [IdentityModule, PersonaModule],
  controllers: [TemplateController],
  providers: [
    { provide: Pool, useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }) },
    {
      provide: TemplateService,
      useFactory: (database: Pool, personas: PersonaService): TemplateService => new TemplateService(database, personas),
      inject: [Pool, PersonaService],
    },
  ],
  exports: [TemplateService],
})
export class TemplateModule {}
