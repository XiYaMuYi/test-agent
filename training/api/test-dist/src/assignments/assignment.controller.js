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
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { AssignmentService, normalizeOverridePatchV1, } from './assignment.service.js';
import { AssignmentProblem } from './eligibility.service.js';
import { SessionService } from '../sessions/session.service.js';
let AssignmentController = class AssignmentController {
    assignments;
    sessions;
    constructor(assignments, sessions) {
        this.assignments = assignments;
        this.sessions = sessions;
    }
    async previewTargets(principal, body) {
        return this.assignments.previewTargets(principal, readTargetPrincipalIds(body));
    }
    async createAssignment(principal, body) {
        return this.assignments.createAssignment(principal, readCreateAssignmentInput(body));
    }
    async listAssignments(principal, status) {
        return this.assignments.listAssignments(principal, readStatusFilter(status));
    }
    async getAssignment(principal, id) {
        return this.assignments.getAssignmentDetail(principal, id);
    }
    async changeStatus(principal, id, body) {
        return this.assignments.transitionStatus(principal, id, readStatusTarget(body));
    }
    /** 更新任务级参数覆盖（任务可编辑；只影响之后新开的会话）。 */
    async updateOverride(principal, id, body) {
        return this.assignments.updateAssignmentOverride(principal, id, readOverridePatch(body));
    }
    async listMyAssignments(principal) {
        return this.assignments.listMyAssignments(principal);
    }
    async startAttempt(principal, assignmentId, idempotencyKey) {
        if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
            throw new AssignmentProblem('IDEMPOTENCY_KEY_REQUIRED', HttpStatus.BAD_REQUEST, 'Idempotency-Key is required to start an attempt.');
        }
        const started = await this.sessions.startAssignedSession(principal, assignmentId, idempotencyKey);
        return { attemptId: started.attemptId, conversationId: started.conversationId };
    }
};
__decorate([
    Post('admin/assignments/preview'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "previewTargets", null);
__decorate([
    Post('admin/assignments'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "createAssignment", null);
__decorate([
    Get('admin/assignments'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Query('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "listAssignments", null);
__decorate([
    Get('admin/assignments/:id'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    __param(0, Principal()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "getAssignment", null);
__decorate([
    Post('admin/assignments/:id/status'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "changeStatus", null);
__decorate([
    Patch('admin/assignments/:id/override'),
    UseGuards(PrincipalGuard, RbacGuard),
    Roles('admin'),
    HttpCode(HttpStatus.OK),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "updateOverride", null);
__decorate([
    Get('me/assignments'),
    UseGuards(PrincipalGuard),
    __param(0, Principal()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "listMyAssignments", null);
__decorate([
    Post('me/assignments/:id/attempts'),
    UseGuards(PrincipalGuard),
    __param(0, Principal()),
    __param(1, Param('id')),
    __param(2, Headers('idempotency-key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AssignmentController.prototype, "startAttempt", null);
AssignmentController = __decorate([
    Controller(),
    __metadata("design:paramtypes", [AssignmentService, SessionService])
], AssignmentController);
export { AssignmentController };
function readTargetPrincipalIds(body) {
    if (typeof body !== 'object' || body === null || !('targetPrincipalIds' in body) || !Array.isArray(body.targetPrincipalIds)
        || body.targetPrincipalIds.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'targetPrincipalIds must contain non-empty principal identifiers.');
    }
    return body.targetPrincipalIds;
}
function readCreateAssignmentInput(body) {
    if (typeof body !== 'object' || body === null) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'An assignment payload is required.');
    }
    const candidate = body;
    const validStatus = candidate.status === 'draft' || candidate.status === 'active' || candidate.status === 'paused' || candidate.status === 'ended';
    const startsAt = typeof candidate.startsAt === 'string' ? new Date(candidate.startsAt) : undefined;
    const endsAt = typeof candidate.endsAt === 'string' ? new Date(candidate.endsAt) : undefined;
    if ((candidate.id !== undefined && (typeof candidate.id !== 'string' || candidate.id.trim().length === 0))
        || typeof candidate.releaseSnapshotId !== 'string' || typeof candidate.name !== 'string'
        || candidate.name.trim().length === 0 || !validStatus || !Number.isInteger(candidate.maxAttempts) || (candidate.maxAttempts ?? 0) <= 0
        || startsAt === undefined || endsAt === undefined || Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf()) || endsAt <= startsAt) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'The assignment payload has invalid fields.');
    }
    const input = {
        releaseSnapshotId: candidate.releaseSnapshotId,
        name: candidate.name,
        status: candidate.status,
        startsAt: candidate.startsAt,
        endsAt: candidate.endsAt,
        maxAttempts: candidate.maxAttempts,
        targetPrincipalIds: readTargetPrincipalIds(candidate),
        overridePatch: normalizeOverridePatchV1(candidate.overridePatch),
    };
    return candidate.id === undefined ? input : { ...input, id: candidate.id };
}
/** 更新覆盖的 body：{ overridePatch?: object | null }；null/缺省=清空覆盖。 */
function readOverridePatch(body) {
    if (typeof body !== 'object' || body === null) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'An override payload is required.');
    }
    const candidate = body.overridePatch;
    return normalizeOverridePatchV1(candidate);
}
const ASSIGNMENT_STATUSES = ['draft', 'active', 'paused', 'ended'];
function readStatusFilter(status) {
    if (status === undefined || status === '')
        return 'all';
    if (status === 'all' || ASSIGNMENT_STATUSES.includes(status)) {
        return status;
    }
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'status must be draft, active, paused, ended or all.');
}
function readStatusTarget(body) {
    if (typeof body !== 'object' || body === null) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A status payload is required.');
    }
    const status = body.status;
    if (typeof status !== 'string' || !ASSIGNMENT_STATUSES.includes(status)) {
        throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'status must be draft, active, paused or ended.');
    }
    return status;
}
