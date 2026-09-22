import type { CurrentPrincipal } from './identity-context.js';

export class OrganizationScopeForbiddenError extends Error {
  public constructor() {
    super('ORG_SCOPE_FORBIDDEN');
    this.name = 'OrganizationScopeForbiddenError';
  }
}

export function assertOrganizationScope(principal: CurrentPrincipal, organizationId: string): void {
  if (principal.organizationId !== organizationId) {
    throw new OrganizationScopeForbiddenError();
  }
}
