import { createParamDecorator } from '@nestjs/common';
import { PRINCIPAL_REQUEST_KEY } from '../../identity/identity-context.js';
export const Principal = createParamDecorator((_, context) => {
    const request = context.switchToHttp().getRequest();
    const principal = request[PRINCIPAL_REQUEST_KEY];
    if (principal === undefined) {
        throw new Error('Principal is not available in the request context.');
    }
    return principal;
});
