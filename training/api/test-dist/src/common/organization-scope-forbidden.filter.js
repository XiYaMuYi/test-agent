var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Catch, HttpStatus } from '@nestjs/common';
import { OrganizationScopeForbiddenError } from '../identity/organization-context.js';
let OrganizationScopeForbiddenFilter = class OrganizationScopeForbiddenFilter {
    catch(_exception, host) {
        const response = host.switchToHttp().getResponse();
        response.status(HttpStatus.FORBIDDEN).json({
            type: 'https://errors.shenshou-princess.local/ORG_SCOPE_FORBIDDEN',
            title: 'Organization scope forbidden',
            status: HttpStatus.FORBIDDEN,
            code: 'ORG_SCOPE_FORBIDDEN',
            detail: 'The requested resource belongs to another organization.',
        });
    }
};
OrganizationScopeForbiddenFilter = __decorate([
    Catch(OrganizationScopeForbiddenError)
], OrganizationScopeForbiddenFilter);
export { OrganizationScopeForbiddenFilter };
