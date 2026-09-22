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
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { TemplateService } from './template.service.js';
const SCOPES = ['platform', 'organization', 'personal'];
class TemplateProblem extends HttpException {
    constructor(code, status, detail) {
        super({
            type: `https://errors.shenshou-princess.local/${code}`,
            title: code,
            status,
            code,
            detail,
        }, status);
    }
}
function readCreateTemplateBody(body) {
    if (typeof body !== 'object' || body === null) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A template payload is required.');
    }
    const candidate = body;
    if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A non-empty title is required.');
    }
    if (typeof candidate.personaConfig !== 'object' || candidate.personaConfig === null) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A personaConfig object is required.');
    }
    return {
        title: candidate.title,
        personaConfig: candidate.personaConfig,
        ...(Array.isArray(candidate.knowledgeVersions) ? { knowledgeVersions: candidate.knowledgeVersions } : {}),
        ...(Array.isArray(candidate.scoringRules) ? { scoringRules: candidate.scoringRules } : {}),
        ...(typeof candidate.agentConfig === 'object' && candidate.agentConfig !== null ? { agentConfig: candidate.agentConfig } : {}),
    };
}
function readScope(scope) {
    if (scope === undefined || scope === '')
        return undefined;
    if (!SCOPES.includes(scope)) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'scope must be platform, organization or personal.');
    }
    return scope;
}
let TemplateController = class TemplateController {
    templates;
    constructor(templates) {
        this.templates = templates;
    }
    async listVisible(principal, scope, productScenario) {
        const resolvedScope = readScope(scope);
        const items = await this.templates.listVisibleTemplates(principal, {
            ...(resolvedScope === undefined ? {} : { scope: resolvedScope }),
            ...(productScenario === undefined || productScenario === '' ? {} : { productScenario }),
        });
        return { items };
    }
    async listMine(principal) {
        const items = await this.templates.listVisibleTemplates(principal, { scope: 'personal' });
        return { items };
    }
    async savePersonal(principal, body) {
        return this.templates.createPersonalTemplate(principal, readCreateTemplateBody(body));
    }
    async listOrganization(principal, status) {
        const items = await this.templates.listOrganizationTemplates(principal, readStatusFilter(status));
        return { items };
    }
    async createOrganization(principal, body) {
        return this.templates.createOrganizationTemplate(principal, readCreateTemplateBody(body));
    }
    async updateOrganization(principal, id, body) {
        return this.templates.updateOrganizationTemplate(principal, id, readUpdateTemplateBody(body));
    }
    async archiveOrganization(principal, id) {
        return this.templates.setOrganizationTemplateStatus(principal, id, 'archived');
    }
    async activateOrganization(principal, id) {
        return this.templates.setOrganizationTemplateStatus(principal, id, 'active');
    }
    async duplicateOrganization(principal, id) {
        return this.templates.duplicateOrganizationTemplate(principal, id);
    }
    async listRevisions(principal, id) {
        const items = await this.templates.listTemplateRevisions(principal, id);
        return { items };
    }
    async listBindings(principal, id) {
        const items = await this.templates.listTemplateScenarioBindings(principal, id);
        return { items };
    }
    async diffRevisions(principal, id, from, to) {
        const fromRevision = Number.parseInt(from, 10);
        const toRevision = Number.parseInt(to, 10);
        if (!Number.isInteger(fromRevision) || !Number.isInteger(toRevision) || fromRevision < 1 || toRevision < 1) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'from and to must be positive revision numbers.');
        }
        if (fromRevision >= toRevision) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'from must be lower than to.');
        }
        const items = await this.templates.diffTemplateRevisions(principal, id, fromRevision, toRevision);
        return { items };
    }
};
__decorate([
    Get('me/templates'),
    UseGuards(PrincipalGuard),
    __param(0, Principal()),
    __param(1, Query('scope')),
    __param(2, Query('productScenario')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "listVisible", null);
__decorate([
    Get(['me/persona-templates', 'training/persona-templates']),
    UseGuards(PrincipalGuard),
    __param(0, Principal()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "listMine", null);
__decorate([
    Post(['me/persona-templates', 'training/persona-templates']),
    UseGuards(PrincipalGuard),
    __param(0, Principal()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "savePersonal", null);
__decorate([
    Get('admin/templates'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Query('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "listOrganization", null);
__decorate([
    Post('admin/templates'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "createOrganization", null);
__decorate([
    Patch('admin/templates/:id'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "updateOrganization", null);
__decorate([
    Post('admin/templates/:id/archive'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "archiveOrganization", null);
__decorate([
    Post('admin/templates/:id/activate'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "activateOrganization", null);
__decorate([
    Post('admin/templates/:id/duplicate'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "duplicateOrganization", null);
__decorate([
    Get('admin/templates/:id/revisions'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "listRevisions", null);
__decorate([
    Get('admin/templates/:id/bindings'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "listBindings", null);
__decorate([
    Get('admin/templates/:id/diff'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Query('from')),
    __param(3, Query('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], TemplateController.prototype, "diffRevisions", null);
TemplateController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [TemplateService])
], TemplateController);
export { TemplateController };
const ADMIN_STATUS_FILTERS = ['active', 'archived', 'all'];
function readStatusFilter(status) {
    if (status === undefined || status === '')
        return 'active';
    if (!ADMIN_STATUS_FILTERS.includes(status)) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'status must be active, archived or all.');
    }
    return status;
}
function readUpdateTemplateBody(body) {
    if (typeof body !== 'object' || body === null) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A template patch payload is required.');
    }
    const candidate = body;
    const patch = {};
    let touched = 0;
    if (candidate.title !== undefined) {
        if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'title must be a non-empty string.');
        }
        patch.title = candidate.title;
        touched += 1;
    }
    if (candidate.personaConfig !== undefined) {
        if (typeof candidate.personaConfig !== 'object' || candidate.personaConfig === null) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'personaConfig must be an object.');
        }
        patch.personaConfig = candidate.personaConfig;
        touched += 1;
    }
    if (candidate.agentConfig !== undefined) {
        if (typeof candidate.agentConfig !== 'object' || candidate.agentConfig === null) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'agentConfig must be an object.');
        }
        patch.agentConfig = candidate.agentConfig;
        touched += 1;
    }
    if (candidate.learnerOverridePolicy !== undefined) {
        if (typeof candidate.learnerOverridePolicy !== 'object' || candidate.learnerOverridePolicy === null) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'learnerOverridePolicy must be an object.');
        }
        patch.learnerOverridePolicy = candidate.learnerOverridePolicy;
        touched += 1;
    }
    if (candidate.knowledgeVersions !== undefined) {
        if (!Array.isArray(candidate.knowledgeVersions)) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'knowledgeVersions must be an array.');
        }
        patch.knowledgeVersions = candidate.knowledgeVersions;
        touched += 1;
    }
    if (candidate.scoringRules !== undefined) {
        if (!Array.isArray(candidate.scoringRules)) {
            throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'scoringRules must be an array.');
        }
        patch.scoringRules = candidate.scoringRules;
        touched += 1;
    }
    if (touched === 0) {
        throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'At least one editable field is required.');
    }
    return patch;
}
