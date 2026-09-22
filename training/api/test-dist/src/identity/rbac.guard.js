var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { PRINCIPAL_REQUEST_KEY } from './identity-context.js';
let RbacGuard = class RbacGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    canActivate(context) {
        const requiredRoles = this.reflector.getAllAndOverride(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) ?? [];
        if (requiredRoles.length === 0) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const principal = request[PRINCIPAL_REQUEST_KEY];
        if (principal === undefined) {
            throw new ForbiddenException('Principal context missing.');
        }
        if (!requiredRoles.some((role) => principal.roles.includes(role))) {
            throw new ForbiddenException('Missing required role.');
        }
        return true;
    }
};
RbacGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector])
], RbacGuard);
export { RbacGuard };
