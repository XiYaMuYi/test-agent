import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';

import type { IdentityProviderPort, IdentityRequestContext } from '@training/contracts';

import { IDENTITY_PROVIDER } from './identity.tokens.js';
import { PRINCIPAL_REQUEST_KEY, toCurrentPrincipal } from './identity-context.js';

@Injectable()
export class PrincipalGuard implements CanActivate {
  private readonly identity: IdentityProviderPort;

  public constructor(@Inject(IDENTITY_PROVIDER) identity: IdentityProviderPort) {
    this.identity = identity;
  }

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      query?: Record<string, string | string[] | undefined>;
      [PRINCIPAL_REQUEST_KEY]?: unknown;
    }>();
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
    const first = (value: unknown): string | undefined => Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
    const openId = first(query.device);
    const deviceId = first(request.headers?.device_id) ?? first(query.device_id);
    const identityContext: IdentityRequestContext = {
      ...(openId === undefined ? {} : { openId }),
      ...(deviceId === undefined ? {} : { deviceId }),
    };
    const principal = await this.identity.verifyAccessToken(token, identityContext).catch((error: unknown) => {
      throw new UnauthorizedException(error instanceof Error ? error.message : 'Invalid token.');
    });

    request[PRINCIPAL_REQUEST_KEY] = toCurrentPrincipal(principal);
    return true;
  }
}
