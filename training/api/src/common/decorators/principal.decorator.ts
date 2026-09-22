import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { PRINCIPAL_REQUEST_KEY, type CurrentPrincipal } from '../../identity/identity-context.js';

export const Principal = createParamDecorator((_: unknown, context: ExecutionContext): CurrentPrincipal => {
  const request = context.switchToHttp().getRequest<{ [PRINCIPAL_REQUEST_KEY]?: CurrentPrincipal }>();
  const principal = request[PRINCIPAL_REQUEST_KEY];

  if (principal === undefined) {
    throw new Error('Principal is not available in the request context.');
  }

  return principal;
});
