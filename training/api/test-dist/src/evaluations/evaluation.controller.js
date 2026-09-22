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
import { Controller, Get, HttpException, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { EvaluationService } from './evaluation.service.js';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
function invalidQuery(detail) {
    return new HttpException({
        type: 'https://errors.shenshou-princess.local/SCHEMA_INVALID',
        title: 'SCHEMA_INVALID',
        status: HttpStatus.BAD_REQUEST,
        code: 'SCHEMA_INVALID',
        detail,
    }, HttpStatus.BAD_REQUEST);
}
function readPagination(limitRaw, offsetRaw) {
    let limit = DEFAULT_LIMIT;
    if (limitRaw !== undefined && limitRaw !== '') {
        const parsed = Number(limitRaw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
            throw invalidQuery(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
        }
        limit = parsed;
    }
    let offset = 0;
    if (offsetRaw !== undefined && offsetRaw !== '') {
        const parsed = Number(offsetRaw);
        if (!Number.isInteger(parsed) || parsed < 0)
            throw invalidQuery('offset must be a non-negative integer.');
        offset = parsed;
    }
    return { limit, offset };
}
let EvaluationController = class EvaluationController {
    evaluations;
    constructor(evaluations) {
        this.evaluations = evaluations;
    }
    async getMine(principal, conversationId) {
        const report = await this.evaluations.getForLearner(principal, conversationId);
        if (report !== undefined)
            return report;
        const pending = await this.evaluations.getPendingStatusForLearner(principal, conversationId);
        if (pending !== undefined)
            return { status: pending };
        throw new Error('EVALUATION_NOT_FOUND');
    }
    async listForOrganization(principal, source, learnerId, limit, offset) {
        const pagination = readPagination(limit, offset);
        let normalizedSource;
        if (source !== undefined && source !== '') {
            if (source !== 'free' && source !== 'assigned')
                throw invalidQuery('source must be either free or assigned.');
            normalizedSource = source;
        }
        return this.evaluations.listAdminEvaluations(principal, {
            ...pagination,
            ...(normalizedSource !== undefined ? { source: normalizedSource } : {}),
            ...(typeof learnerId === 'string' && learnerId.trim().length > 0 ? { learnerId: learnerId.trim() } : {}),
        });
    }
    replay(principal, id) {
        return this.evaluations.getConversationReplay(principal, id);
    }
};
__decorate([
    Get(['me/evaluations/:conversationId', 'training/evaluations/:conversationId']),
    Roles('admin', 'streamer'),
    __param(0, Principal()),
    __param(1, Param('conversationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], EvaluationController.prototype, "getMine", null);
__decorate([
    Get('admin/evaluations'),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Query('source')),
    __param(2, Query('learnerId')),
    __param(3, Query('limit')),
    __param(4, Query('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], EvaluationController.prototype, "listForOrganization", null);
__decorate([
    Get('admin/conversations/:id'),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], EvaluationController.prototype, "replay", null);
EvaluationController = __decorate([
    Controller(),
    UseGuards(PrincipalGuard, RbacGuard),
    __metadata("design:paramtypes", [EvaluationService])
], EvaluationController);
export { EvaluationController };
