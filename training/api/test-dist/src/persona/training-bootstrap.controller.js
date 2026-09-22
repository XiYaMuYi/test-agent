var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { PersonaService } from './persona.service.js';
let TrainingBootstrapController = class TrainingBootstrapController {
    personas;
    constructor(personas) {
        this.personas = personas;
    }
    getBootstrap() {
        return { enabled: process.env.TRAINING_ENABLED !== 'false', ...this.personas.getPresetCatalog() };
    }
};
__decorate([
    Get('bootstrap'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], TrainingBootstrapController.prototype, "getBootstrap", null);
TrainingBootstrapController = __decorate([
    Controller('training'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin', 'streamer'),
    __metadata("design:paramtypes", [PersonaService])
], TrainingBootstrapController);
export { TrainingBootstrapController };
