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
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { ScenarioService } from './scenario.service.js';
let ScenarioController = class ScenarioController {
    scenarios;
    constructor(scenarios) {
        this.scenarios = scenarios;
    }
    async createDraft(principal, body) {
        const { id } = await this.scenarios.createDraft(principal, {
            ...(typeof body.id === 'string' && body.id.trim().length > 0 ? { id: body.id } : {}),
            organizationId: principal.organizationId,
            payload: body.payload,
        });
        return { id, status: 'created' };
    }
    async listDrafts(principal) {
        const items = await this.scenarios.listDrafts(principal);
        return { items };
    }
    async getDraft(principal, id) {
        const draft = await this.scenarios.getDraftForOrganization(principal, id);
        if (draft === undefined) {
            throw new Error('SCENARIO_DRAFT_NOT_FOUND');
        }
        return draft;
    }
    async updateDraft(principal, id, body) {
        await this.scenarios.updateDraft(principal, id, principal.organizationId, body);
        return { status: 'updated' };
    }
    async validateDraft(principal, id) {
        const result = await this.scenarios.validateDraft(principal, id);
        return {
            valid: result.valid,
            ...(result.valid ? {} : { reason: result.errors.map((e) => `${e.path}: ${e.reason}`).join('; ') }),
        };
    }
    /** 发布前校验：知识与评分至少各有一项 + 人设来源完整（spec §6.3）。 */
    async publishPreview(principal, id) {
        const result = await this.scenarios.validateDraftForRelease(principal, id);
        return {
            valid: result.valid,
            ...(result.valid ? {} : { reason: result.errors.map((e) => `${e.path}: ${e.reason}`).join('; ') }),
        };
    }
    /** 升级场景绑定的模板到最新 revision（spec §6.3）。 */
    async upgradeTemplate(principal, id) {
        const { updated } = await this.scenarios.upgradeDraftToLatestRevision(principal, id);
        return { status: updated ? 'upgraded' : 'noop' };
    }
    async publishDraft(principal, id) {
        await this.scenarios.publishDraft(principal, id);
        return { status: 'published' };
    }
};
__decorate([
    Post(),
    __param(0, Principal()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "createDraft", null);
__decorate([
    Get(),
    __param(0, Principal()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "listDrafts", null);
__decorate([
    Get(':id'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "getDraft", null);
__decorate([
    Patch(':id'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "updateDraft", null);
__decorate([
    Post(':id/validate'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "validateDraft", null);
__decorate([
    Post(':id/publish-preview'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "publishPreview", null);
__decorate([
    Post(':id/upgrade-template'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "upgradeTemplate", null);
__decorate([
    Post(':id/publish'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ScenarioController.prototype, "publishDraft", null);
ScenarioController = __decorate([
    Controller('admin/scenarios'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __metadata("design:paramtypes", [ScenarioService])
], ScenarioController);
export { ScenarioController };
