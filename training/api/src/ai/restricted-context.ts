import type { KnowledgeRef, PersonaConfig } from '@training/contracts';
import type { ConversationStatus } from '../conversations/conversation-state.js';
import type { CustomerState } from '@training/contracts';

export interface ApprovedKnowledgeEntry {
  readonly ref: KnowledgeRef;
  readonly content: string;
}

/**
 * Knowledge/agent inputs a turn runs with. Assigned sessions pass the immutable
 * release snapshot; a self-configured free session passes an empty context
 * (no approved knowledge, no release snapshot).
 */
export interface SessionKnowledgeContext {
  readonly releaseSnapshotId: string | null;
  readonly knowledgeVersions: readonly string[];
  readonly agentConfig: Record<string, unknown>;
}

export interface RestrictedContext {
  readonly organizationId: string;
  readonly conversationId: string;
  readonly conversationVersion: number;
  readonly conversationStatus: ConversationStatus;
  readonly lastSequence: number;
  readonly releaseSnapshotId: string | null;
  readonly knowledgeVersions: readonly string[];
  readonly agentConfig: Record<string, unknown>;
  readonly approvedKnowledge: readonly ApprovedKnowledgeEntry[];
  readonly recentMessages: readonly { readonly role: 'learner' | 'assistant'; readonly content: string }[];
  readonly canAdvance: boolean;
  readonly personaSnapshot: PersonaConfig | null;
  readonly currentCustomerState?: CustomerState | null;
}
