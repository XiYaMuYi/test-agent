import type { PersonaConfig } from '@training/contracts';
import type { CustomerState, ConversationEndReason } from '@training/contracts';

export type ConversationStatus = 'created' | 'active' | 'awaiting_model' | 'completed' | 'ended' | 'failed';

export interface ConversationSnapshot {
  readonly id: string;
  readonly organizationId: string;
  readonly status: ConversationStatus;
  readonly version: number;
  readonly lastSequence: number;
  /** Assigned track only; null for free sessions. */
  readonly trainingAttemptId: string | null;
  /** Assigned track only; null for self-configured free sessions. */
  readonly releaseSnapshotId: string | null;
  /** Unified session root that owns this conversation for both tracks. */
  readonly trainingSessionId: string;
  readonly sourceType: 'free' | 'assigned';
  /** Frozen PersonaConfig for the session that owns this conversation. */
  readonly personaSnapshot: PersonaConfig | null;
  /** Persisted AI opening, or an empty learner-first marker for wait_learner mode. */
  readonly openingResponse?: {
    readonly opening?: string;
    readonly learnerFirst?: boolean;
  } | null;
  readonly initialCustomerState?: CustomerState | null;
  readonly currentCustomerState?: CustomerState | null;
  readonly endReason?: ConversationEndReason | null;
}

export interface MessageInput {
  readonly clientMessageId: string;
  readonly sequence: number;
  readonly content: string;
}

export interface MessageDecision {
  readonly kind: 'accepted' | 'replay' | 'idempotency_conflict' | 'sequence_conflict' | 'closed';
  readonly reason?: string;
}

export function canEndConversation(status: ConversationStatus): boolean {
  return status === 'created' || status === 'active' || status === 'awaiting_model';
}

export function decideMessage(conversation: ConversationSnapshot, input: MessageInput, existing?: { readonly clientMessageId: string; readonly sequence: number; readonly content: string; readonly requestHash: string }): MessageDecision {
  if (existing !== undefined) {
    const sameBody = existing.sequence === input.sequence && existing.content === input.content;
    return sameBody ? { kind: 'replay' } : { kind: 'idempotency_conflict', reason: 'MESSAGE_IDEMPOTENCY_CONFLICT' };
  }

  if (conversation.status === 'completed' || conversation.status === 'ended' || conversation.status === 'failed') {
    return { kind: 'closed', reason: 'Conversation is closed.' };
  }

  if (conversation.status === 'awaiting_model') {
    return { kind: 'sequence_conflict', reason: 'MESSAGE_SEQUENCE_CONFLICT' };
  }

  if (input.sequence !== conversation.lastSequence + 1) {
    return { kind: 'sequence_conflict', reason: 'MESSAGE_SEQUENCE_CONFLICT' };
  }

  return { kind: 'accepted' };
}
