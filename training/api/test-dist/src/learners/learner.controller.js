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
import { LearnerService } from './learner.service.js';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
function invalidPagination(detail) {
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
            throw invalidPagination(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
        }
        limit = parsed;
    }
    let offset = 0;
    if (offsetRaw !== undefined && offsetRaw !== '') {
        const parsed = Number(offsetRaw);
        if (!Number.isInteger(parsed) || parsed < 0)
            throw invalidPagination('offset must be a non-negative integer.');
        offset = parsed;
    }
    return { limit, offset };
}
let LearnerController = class LearnerController {
    learners;
    constructor(learners) {
        this.learners = learners;
    }
    async list(principal, q, limit, offset) {
        const pagination = readPagination(limit, offset);
        return this.learners.listLearners(principal, {
            ...pagination,
            ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim() } : {}),
        });
    }
    async detail(principal, id) {
        return this.learners.getLearnerDetail(principal, id);
    }
};
__decorate([
    Get(),
    __param(0, Principal()),
    __param(1, Query('q')),
    __param(2, Query('limit')),
    __param(3, Query('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], LearnerController.prototype, "list", null);
__decorate([
    Get(':id'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LearnerController.prototype, "detail", null);
LearnerController = __decorate([
    Controller('admin/learners'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __metadata("design:paramtypes", [LearnerService])
], LearnerController);
export { LearnerController };
