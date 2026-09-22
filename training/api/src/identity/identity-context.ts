import type { VerifiedPrincipal } from '@training/contracts';

export interface CurrentPrincipal {
  readonly principalId: string;
  readonly organizationId: string;
  readonly roles: readonly ('admin' | 'streamer')[];
  readonly status: VerifiedPrincipal['status'];
}

export const PRINCIPAL_REQUEST_KEY = Symbol('current-principal');

export function toCurrentPrincipal(principal: VerifiedPrincipal): CurrentPrincipal {
  return {
    principalId: principal.subjectId,
    organizationId: principal.organizationId,
    roles: principal.subjectId.startsWith('admin-') ? ['admin'] : ['streamer'],
    status: principal.status,
  };
}
