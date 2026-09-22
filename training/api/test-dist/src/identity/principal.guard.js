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
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { IDENTITY_PROVIDER } from './identity.tokens.js';
import { PRINCIPAL_REQUEST_KEY, toCurrentPrincipal } from './identity-context.js';
let PrincipalGuard = class PrincipalGuard {
    identity;
    constructor(identity) {
        this.identity = identity;
    }
    async canActivate(executionContext) {
        const request = executionContext.switchToHttp().getRequest();
        const headerToken = request.headers?.['x-access-token'] ?? request.headers?.['x-token'];
        const localTestAuthEnabled = process.env.LOCAL_TEST_AUTH === 'true';
        const token = typeof headerToken === 'string' && headerToken.length > 0
            ? headerToken
            : localTestAuthEnabled
                ? (process.env.LOCAL_TEST_TOKEN || 'fixture:identity:valid')
                : headerToken;
        if (typeof token !== 'string' || token.length === 0) {
            throw new UnauthorizedException('Missing x-access-token header.');
        }
        const query = request.query ?? {};
        const first = (value) => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
        const openId = first(query.device);
        const deviceId = first(request.headers?.device_id) ?? first(query.device_id);
        const identityContext = {
            ...(openId === undefined ? {} : { openId }),
            ...(deviceId === undefined ? {} : { deviceId }),
        };
        const principal = await this.identity.verifyAccessToken(token, identityContext).catch((error) => {
            throw new UnauthorizedException(error instanceof Error ? error.message : 'Invalid token.');
        });
        request[PRINCIPAL_REQUEST_KEY] = toCurrentPrincipal(principal);
        return true;
    }
};
PrincipalGuard = __decorate([
    Injectable(),
    __param(0, Inject(IDENTITY_PROVIDER)),
    __metadata("design:paramtypes", [Object])
], PrincipalGuard);
export { PrincipalGuard };
