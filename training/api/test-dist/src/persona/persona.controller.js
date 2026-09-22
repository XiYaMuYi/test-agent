var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { PersonaService } from './persona.service.js';
/**
 * Read-only persona setup endpoints for the C-end mini program:
 *   GET  /me/persona/presets — fixed age/psychology/difficulty/scenario options
 *   POST /me/persona/preview  — build + validate a frozen PersonaConfig snapshot (no persistence)
 *
 * Personal-template persistence arrives with the training_template (T7) step.
 */
let PersonaController = class PersonaController {
    personas;
    constructor(personas) {
        this.personas = personas;
    }
    getPresets() {
        return this.personas.getPresetCatalog();
    }
    preview(_principal, body) {
        return this.personas.buildPersonaConfig(body);
    }
};
__decorate([
    Get('presets'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], PersonaController.prototype, "getPresets", null);
__decorate([
    Post('preview'),
    __param(0, Principal()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Object)
], PersonaController.prototype, "preview", null);
PersonaController = __decorate([
    Controller(['me/persona', 'training/persona']),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin', 'streamer'),
    __metadata("design:paramtypes", [PersonaService])
], PersonaController);
export { PersonaController };
