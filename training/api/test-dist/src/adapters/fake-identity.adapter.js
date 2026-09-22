export class FakeIdentityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'FakeIdentityError';
        this.code = code;
    }
}
const IDENTITY_OUTCOMES = {
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
export class FakeIdentityAdapter {
    async verifyAccessToken(token) {
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
