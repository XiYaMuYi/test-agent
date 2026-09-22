export const CONTRACT_SCHEMA_VERSIONS = Object.freeze({
  agentOutput: 'agent-output/v1',
  releaseSnapshot: 'release-snapshot/v1',
  releaseSnapshotV2: 'release-snapshot/v2',
  principal: 'principal/v1',
} as const);

export type ContractSchemaVersion =
  (typeof CONTRACT_SCHEMA_VERSIONS)[keyof typeof CONTRACT_SCHEMA_VERSIONS];

export interface VersionedJsonSchema<T> {
  readonly schemaVersion: ContractSchemaVersion;
  readonly schema: Record<string, unknown>;
  readonly validate: (value: unknown) => value is T;
}

export interface CoachFeedbackData {
  readonly rating: number;
  readonly feedback: string;
  readonly improvements: readonly string[];
  /**
   * true 表示这是同步阶段先落库的“规则兜底临时点评”，异步大模型点评稍后会覆盖它；
   * 轮询接口在 provisional=true 时应继续返回 pending，直到最终版（false/缺省）写回。
   */
  readonly provisional?: boolean;
}

export type CustomerMood = 'positive' | 'neutral' | 'negative';

import type { CustomerStateTransition } from '../customer-state.js';

export interface AgentOutputV1 {
  readonly schemaVersion: 'agent-output/v1';
  readonly replyText: string;
  readonly suggestedAction: 'ask_follow_up' | 'advance' | 'end';
  readonly knowledgeReferences: string[];
  readonly confidence: number;
  /** Optional: learner-facing customer mood label derived from cumulative mood value. */
  readonly customerMood?: CustomerMood;
  /** Optional: rule-based coach evaluation for the learner's latest turn. */
  readonly coachFeedback?: CoachFeedbackData;
  /** Semantic customer-state progression and evidence produced for this turn. */
  readonly stateTransition?: CustomerStateTransition;
}

export interface PrincipalSnapshotV1 {
  readonly schemaVersion: 'principal/v1';
  readonly principalId: string;
  readonly organizationId: string;
  readonly roles: readonly string[];
}

export interface ReleaseSnapshotV1 {
  readonly schemaVersion: 'release-snapshot/v1';
  readonly releaseSnapshotId: string;
  readonly scenarioDraftId: string;
  readonly compiledAt: string;
  readonly title: string;
  readonly knowledgeVersions: readonly string[];
  readonly scoringRules: readonly string[];
  readonly agentConfig: Record<string, unknown>;
}

/**
 * release-snapshot/v2 — 发布时冻结完整配置（spec §5.3）。
 * v2 必须包含合法完整人设，不允许静默回退默认人设。
 */
export interface ReleaseSnapshotV2 {
  readonly schemaVersion: 'release-snapshot/v2';
  readonly releaseSnapshotId: string;
  readonly scenarioDraftId: string;
  readonly compiledAt: string;
  readonly compiledBy: string;
  readonly title: string;
  readonly personaConfig: import('../persona/config.js').PersonaConfig;
  readonly personaSource:
    | { readonly kind: 'template_revision'; readonly templateId: string; readonly revisionId: string; readonly revision: number }
    | { readonly kind: 'inline' };
  readonly knowledgeVersions: readonly string[];
  readonly scoringRules: readonly string[];
  readonly agentConfig: import('../agent-config.js').AgentConfigV1;
  readonly learnerOverridePolicy: import('../learner-override-policy.js').LearnerOverridePolicyV1;
}

export type ReleaseSnapshot = ReleaseSnapshotV1 | ReleaseSnapshotV2;

export function isReleaseSnapshotV2(value: unknown): value is ReleaseSnapshotV2 {
  return typeof value === 'object' && value !== null
    && (value as { readonly schemaVersion?: unknown }).schemaVersion === 'release-snapshot/v2';
}

/** Immutable releases reference knowledge only as `itemId@version`. */
export interface KnowledgeVersionReferenceV1 {
  readonly itemId: string;
  readonly version: string;
}

const knowledgeVersionReferencePattern = /^([A-Za-z0-9][A-Za-z0-9._:-]*)@([A-Za-z0-9][A-Za-z0-9._:-]*)$/;

export function parseKnowledgeVersionReferenceV1(value: string): KnowledgeVersionReferenceV1 | undefined {
  const match = knowledgeVersionReferencePattern.exec(value);
  if (match === null) return undefined;
  return { itemId: match[1]!, version: match[2]! };
}

export function isKnowledgeVersionReferenceV1(value: unknown): value is string {
  return typeof value === 'string' && parseKnowledgeVersionReferenceV1(value) !== undefined;
}

const agentOutputSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'replyText', 'suggestedAction', 'knowledgeReferences', 'confidence'],
};

const principalSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'principalId', 'organizationId', 'roles'],
};

const releaseSnapshotSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'releaseSnapshotId', 'scenarioDraftId', 'compiledAt', 'title', 'knowledgeVersions', 'scoringRules', 'agentConfig'],
};

function createVersionedSchema<T>(schemaVersion: ContractSchemaVersion, schema: Record<string, unknown>): VersionedJsonSchema<T> {
  return {
    schemaVersion,
    schema,
    validate(value: unknown): value is T {
      return typeof value === 'object' && value !== null;
    },
  };
}

export function loadAgentOutputSchemaV1(): VersionedJsonSchema<AgentOutputV1> {
  return createVersionedSchema<AgentOutputV1>('agent-output/v1', agentOutputSchema);
}

export function loadPrincipalSchemaV1(): VersionedJsonSchema<PrincipalSnapshotV1> {
  return createVersionedSchema<PrincipalSnapshotV1>('principal/v1', principalSchema);
}

export function loadReleaseSnapshotSchemaV1(): VersionedJsonSchema<ReleaseSnapshotV1> {
  return createVersionedSchema<ReleaseSnapshotV1>('release-snapshot/v1', releaseSnapshotSchema);
}

const releaseSnapshotV2Schema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion', 'releaseSnapshotId', 'scenarioDraftId', 'compiledAt', 'compiledBy',
    'title', 'personaConfig', 'personaSource', 'knowledgeVersions', 'scoringRules',
    'agentConfig', 'learnerOverridePolicy',
  ],
};

export function loadReleaseSnapshotSchemaV2(): VersionedJsonSchema<ReleaseSnapshotV2> {
  return createVersionedSchema<ReleaseSnapshotV2>('release-snapshot/v2', releaseSnapshotV2Schema);
}

export const CONTRACT_SCHEMA_IDS = Object.freeze({
  agentRequest: 'https://schemas.training.local/agent-request/v1',
  agentResponse: 'https://schemas.training.local/agent-response/v1',
} as const);

export type RegisteredContractSchemaName = keyof typeof CONTRACT_SCHEMA_IDS;

export interface RegisteredJsonSchema {
  readonly version: 'v1';
  readonly id: (typeof CONTRACT_SCHEMA_IDS)[RegisteredContractSchemaName];
  readonly schema: Readonly<Record<string, unknown>>;
}

export class ContractSchemaNotFoundError extends Error {
  readonly name = 'ContractSchemaNotFoundError';

  constructor(version: string, name: string) {
    super(`No registered contract schema exists for ${name}/${version}.`);
  }
}

const schemaNameToRegistryKey = Object.freeze({
  'agent-request': 'agentRequest',
  'agent-response': 'agentResponse',
} as const);

const registeredSchemas: Readonly<Record<RegisteredContractSchemaName, RegisteredJsonSchema>> = Object.freeze({
  agentRequest: Object.freeze({
    version: 'v1',
    id: CONTRACT_SCHEMA_IDS.agentRequest,
    schema: Object.freeze({
      $id: CONTRACT_SCHEMA_IDS.agentRequest,
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['sessionId', 'prompt']),
      properties: Object.freeze({
        sessionId: Object.freeze({ type: 'string' }),
        prompt: Object.freeze({ type: 'string' }),
      }),
    }),
  }),
  agentResponse: Object.freeze({
    version: 'v1',
    id: CONTRACT_SCHEMA_IDS.agentResponse,
    schema: Object.freeze({
      $id: CONTRACT_SCHEMA_IDS.agentResponse,
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['content', 'modelVersion']),
      properties: Object.freeze({
        content: Object.freeze({ type: 'string' }),
        modelVersion: Object.freeze({ type: 'string' }),
      }),
    }),
  }),
});

/** Returns only immutable, explicitly registered v1 transport schemas. */
export function loadVersionedJsonSchema(version: string, name: string): RegisteredJsonSchema {
  const registryKey = schemaNameToRegistryKey[name as keyof typeof schemaNameToRegistryKey];
  if (version !== 'v1' || registryKey === undefined) {
    throw new ContractSchemaNotFoundError(version, name);
  }
  return registeredSchemas[registryKey];
}
