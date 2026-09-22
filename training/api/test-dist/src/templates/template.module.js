var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let TemplateModule = class TemplateModule {
};
TemplateModule = __decorate([
    Module({
        imports: [IdentityModule, PersonaModule],
        controllers: [TemplateController],
        providers: [
            { provide: Pool, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
            {
                provide: TemplateService,
                useFactory: (database, personas) => new TemplateService(database, personas),
                inject: [Pool, PersonaService],
            },
        ],
        exports: [TemplateService],
    })
], TemplateModule);
export { TemplateModule };
