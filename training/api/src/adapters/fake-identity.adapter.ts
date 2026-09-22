import type { IdentityProviderPort, VerifiedPrincipal } from '@training/contracts';

export type FakeIdentityErrorCode =
  | 'IDENTITY_TOKEN_EXPIRED'
  | 'IDENTITY_SUBJECT_DISABLED'
  | 'IDENTITY_TOKEN_INVALID';

export class FakeIdentityError extends Error {
  readonly code: FakeIdentityErrorCode;

  constructor(code: FakeIdentityErrorCode, message: string) {
    super(message);
    this.name = 'FakeIdentityError';
    this.code = code;
  }
}

type FakeIdentityOutcome =
  | { readonly kind: 'principal'; readonly principal: VerifiedPrincipal }
  | { readonly kind: 'error'; readonly code: FakeIdentityErrorCode; readonly message: string };

const IDENTITY_OUTCOMES: Readonly<Record<string, FakeIdentityOutcome>> = {
  'fixture:identity:valid': {
    kind: 'principal',
    principal: {
      subjectId: 'streamer-001',
      organizationId: '11111111-1111-1111-1111-111111111111',
      status: 'active',
    },
  },
  'fixture:identity:streamer-organization-a-other': {
    kind: 'principal',
    principal: {
      subjectId: 'streamer-002',
      organizationId: '11111111-1111-1111-1111-111111111111',
      status: 'active',
    },
  },
  'fixture:identity:admin-organization-a': {
    kind: 'principal',
    principal: {
      subjectId: 'admin-001',
      organizationId: '11111111-1111-1111-1111-111111111111',
      status: 'active',
    },
  },
  'fixture:identity:expired': {
    kind: 'error',
    code: 'IDENTITY_TOKEN_EXPIRED',
    message: 'The offline fixture access token is expired.',
  },
  'fixture:identity:disabled': {
    kind: 'error',
    code: 'IDENTITY_SUBJECT_DISABLED',
    message: 'The offline fixture subject is disabled.',
  },
  'fixture:identity:cross-organization': {
    kind: 'principal',
    principal: {
      subjectId: 'admin-002',
      organizationId: '22222222-2222-2222-2222-222222222222',
      status: 'active',
    },
  },
};

export class FakeIdentityAdapter implements IdentityProviderPort {
  async verifyAccessToken(token: string): Promise<VerifiedPrincipal> {
    const outcome = IDENTITY_OUTCOMES[token];

    if (outcome === undefined) {
      throw new FakeIdentityError('IDENTITY_TOKEN_INVALID', 'Unknown offline identity fixture token.');
    }

    if (outcome.kind === 'error') {
      throw new FakeIdentityError(outcome.code, outcome.message);
    }

    return outcome.principal;
  }
}
