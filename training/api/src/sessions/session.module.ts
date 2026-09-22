import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { EligibilityService } from '../assignments/eligibility.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PersonaModule } from '../persona/persona.module.js';
import { PersonaService } from '../persona/persona.service.js';
import { TemplateModule } from '../templates/template.module.js';
import { TemplateService } from '../templates/template.service.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [IdentityModule, PersonaModule, TemplateModule],
  controllers: [SessionController],
  providers: [
    { provide: Pool, useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }) },
    EligibilityService,
    {
      provide: SessionService,
      useFactory: (database: Pool, personas: PersonaService, eligibility: EligibilityService, templates: TemplateService): SessionService =>
        new SessionService(database, personas, eligibility, templates),
      inject: [Pool, PersonaService, EligibilityService, TemplateService],
    },
  ],
  exports: [SessionService],
})
export class SessionModule {}
