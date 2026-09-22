var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
let PersonaModule = class PersonaModule {
};
PersonaModule = __decorate([
    Module({
        imports: [IdentityModule],
        controllers: [PersonaController, TrainingBootstrapController, ConfigMetaController],
        providers: [PersonaService],
        exports: [PersonaService],
    })
], PersonaModule);
export { PersonaModule };
