var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let SessionModule = class SessionModule {
};
SessionModule = __decorate([
    Module({
        imports: [IdentityModule, PersonaModule, TemplateModule],
        controllers: [SessionController],
        providers: [
            { provide: Pool, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
            EligibilityService,
            {
                provide: SessionService,
                useFactory: (database, personas, eligibility, templates) => new SessionService(database, personas, eligibility, templates),
                inject: [Pool, PersonaService, EligibilityService, TemplateService],
            },
        ],
        exports: [SessionService],
    })
], SessionModule);
export { SessionModule };
