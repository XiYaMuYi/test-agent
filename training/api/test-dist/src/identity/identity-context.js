export const PRINCIPAL_REQUEST_KEY = Symbol('current-principal');
export function toCurrentPrincipal(principal) {
    return {
        principalId: principal.subjectId,
        organizationId: principal.organizationId,
        roles: principal.subjectId.startsWith('admin-') ? ['admin'] : ['streamer'],
        status: principal.status,
    };
}
