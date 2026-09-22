import { Catch, type ArgumentsHost, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { OrganizationScopeForbiddenError } from '../identity/organization-context.js';

@Catch(OrganizationScopeForbiddenError)
export class OrganizationScopeForbiddenFilter implements ExceptionFilter {
  catch(_exception: OrganizationScopeForbiddenError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.FORBIDDEN).json({
      type: 'https://errors.shenshou-princess.local/ORG_SCOPE_FORBIDDEN',
      title: 'Organization scope forbidden',
      status: HttpStatus.FORBIDDEN,
      code: 'ORG_SCOPE_FORBIDDEN',
      detail: 'The requested resource belongs to another organization.',
    });
  }
}
