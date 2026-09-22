export class OrganizationScopeForbiddenError extends Error {
    constructor() {
        super('ORG_SCOPE_FORBIDDEN');
        this.name = 'OrganizationScopeForbiddenError';
    }
}
export function assertOrganizationScope(principal, organizationId) {
    if (principal.organizationId !== organizationId) {
        throw new OrganizationScopeForbiddenError();
    }
}
