export interface VerifiedPrincipal {
  readonly subjectId: string;
  readonly organizationId: string;
  readonly status: 'active' | 'expired' | 'disabled';
}

/**
 * Marketplace transport metadata required to validate a first-party mini-program
 * token. These values are supplied by the existing signed request wrapper and
 * are never persisted by the training service.
 */
export interface IdentityRequestContext {
  readonly openId?: string;
  readonly deviceId?: string;
}

export interface IdentityProviderPort {
  verifyAccessToken(token: string, context?: IdentityRequestContext): Promise<VerifiedPrincipal>;
}
