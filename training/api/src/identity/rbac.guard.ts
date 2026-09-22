import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { PRINCIPAL_REQUEST_KEY, type CurrentPrincipal } from './identity-context.js';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly reflector: Reflector;

  constructor(reflector: Reflector) {
    this.reflector = reflector;
  }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<readonly ('admin' | 'streamer')[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ [PRINCIPAL_REQUEST_KEY]?: CurrentPrincipal }>();
    const principal = request[PRINCIPAL_REQUEST_KEY];

    if (principal === undefined) {
      throw new ForbiddenException('Principal context missing.');
    }

    if (!requiredRoles.some((role) => principal.roles.includes(role))) {
      throw new ForbiddenException('Missing required role.');
    }

    return true;
  }
}
