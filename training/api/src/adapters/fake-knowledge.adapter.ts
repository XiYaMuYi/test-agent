import type {
  ApprovedKnowledgeItem,
  KnowledgeProviderPort,
  KnowledgeRef,
} from '@training/contracts';

export interface FakeKnowledgeRecord {
  readonly id: string;
  readonly version: string;
  readonly organizationId: string;
  readonly status: 'approved' | 'draft' | 'rejected';
  readonly content: string;
}

class FakeKnowledgeNotFoundError extends Error {
  readonly code = 'FAKE_KNOWLEDGE_NOT_FOUND';

  constructor(ref: KnowledgeRef) {
    super(`No approved fake knowledge item exists for ${ref.itemId}@${ref.version} in org ${ref.organizationId}.`);
    this.name = 'FakeKnowledgeNotFoundError';
  }
}

export function isFakeKnowledgeNotFoundError(value: unknown): value is FakeKnowledgeNotFoundError {
  return value instanceof FakeKnowledgeNotFoundError;
}

/**
 * Deterministic G1 replacement for the future knowledge-base integration.
 * Records are scoped by organizationId; only explicitly approved entries are served.
 */
export class FakeKnowledgeAdapter implements KnowledgeProviderPort {
  private readonly records: readonly FakeKnowledgeRecord[];

  constructor(
    records: readonly FakeKnowledgeRecord[] = [
      {
        id: 'knowledge-welcome',
        version: 'v1',
        organizationId: '11111111-1111-1111-1111-111111111111',
        status: 'approved',
        content: '欢迎使用神首公主购陪练。',
      },
    ],
  ) {
    this.records = records;
  }

  async getApprovedItem(ref: KnowledgeRef): Promise<ApprovedKnowledgeItem> {
    const record = this.records.find(
      (candidate) =>
        candidate.id === ref.itemId &&
        candidate.version === ref.version &&
        candidate.organizationId === ref.organizationId &&
        candidate.status === 'approved',
    );

    if (record === undefined) {
      throw new FakeKnowledgeNotFoundError(ref);
    }

    return {
      id: record.id,
      version: record.version,
      status: 'approved',
      content: record.content,
    };
  }
}
