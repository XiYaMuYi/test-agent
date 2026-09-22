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
import { Body, Controller, Headers, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Principal } from '../common/decorators/principal.decorator.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { SessionService } from './session.service.js';
export class SessionProblem extends HttpException {
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
const DIFFICULTIES = [1, 2, 3, 4];
function isPersonaInput(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    return typeof candidate.ageCardId === 'string'
        && typeof candidate.productScenarioId === 'string'
        && typeof candidate.difficulty === 'number'
        && DIFFICULTIES.includes(candidate.difficulty)
        && (candidate.psychologyCardIds === undefined || Array.isArray(candidate.psychologyCardIds));
}
function readFreeBody(body) {
    if (typeof body !== 'object' || body === null) {
        throw new SessionProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A free-session payload is required.');
    }
    const candidate = body;
    const hasPersona = isPersonaInput(candidate.persona);
    const hasTemplate = typeof candidate.templateId === 'string' && candidate.templateId.trim().length > 0;
    if (!hasPersona && !hasTemplate) {
        throw new SessionProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'Provide either a valid persona selection or a visible templateId.');
    }
    const mode = candidate.mode;
    if (mode !== undefined && mode !== 'practice' && mode !== 'exam') {
        throw new SessionProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'mode must be practice or exam.');
    }
    return {
        ...(hasPersona ? { persona: candidate.persona } : {}),
        ...(hasTemplate ? { templateId: candidate.templateId } : {}),
        ...(mode === 'practice' || mode === 'exam' ? { mode } : {}),
    };
}
let SessionController = class SessionController {
    sessions;
    constructor(sessions) {
        this.sessions = sessions;
    }
    async startFreeSession(principal, idempotencyKey, body) {
        if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
            throw new SessionProblem('IDEMPOTENCY_KEY_REQUIRED', HttpStatus.BAD_REQUEST, 'Idempotency-Key is required to start a free session.');
        }
        return this.sessions.startFreeSession(principal, readFreeBody(body), idempotencyKey);
    }
};
__decorate([
    Post('free'),
    UseGuards(PrincipalGuard),
    __param(0, Principal()),
    __param(1, Headers('idempotency-key')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], SessionController.prototype, "startFreeSession", null);
SessionController = __decorate([
    Controller(['me/sessions', 'training/sessions']),
    __metadata("design:paramtypes", [SessionService])
], SessionController);
export { SessionController };
