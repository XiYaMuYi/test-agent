import crypto from 'node:crypto';

import type { AgentConfigV1, LearnerOverridePolicyV1, PersonaConfig } from '@training/contracts';

/**
 * 场景草稿的人设来源（spec §5.2）：两种互斥方式。
 * - template_revision：绑定指定组织模板 revision（发布时从该 revision 冻结人设）
 * - inline：草稿内保存完整独立 personaConfig
 */
export type ScenarioPersonaSource =
  | { readonly kind: 'template_revision'; readonly templateId: string; readonly revisionId: string; readonly revision: number }
  | { readonly kind: 'inline'; readonly personaConfig: PersonaConfig };

export interface ScenarioDraftInput {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly payload: {
    readonly title: string;
    readonly knowledgeVersions: readonly string[];
    readonly scoringRules: readonly string[];
    readonly agentConfig: Record<string, unknown>;
    /** 人设来源：缺省表示旧 v1 草稿，发布时要求先补齐（spec §10.6）。 */
    readonly personaSource?: ScenarioPersonaSource;
  };
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

/** v2 发布快照（spec §5.3）：完整冻结，自包含，可复现。 */
export interface ReleaseSnapshotV2 {
  readonly schemaVersion: 'release-snapshot/v2';
  readonly releaseSnapshotId: string;
  readonly scenarioDraftId: string;
  readonly compiledAt: string;
  readonly compiledBy: string;
  readonly title: string;
  readonly personaConfig: PersonaConfig;
  readonly personaSource:
    | { readonly kind: 'template_revision'; readonly templateId: string; readonly revisionId: string; readonly revision: number }
    | { readonly kind: 'inline' };
  readonly knowledgeVersions: readonly string[];
  readonly scoringRules: readonly string[];
  readonly agentConfig: AgentConfigV1;
  readonly learnerOverridePolicy: LearnerOverridePolicyV1;
}

/** 兼容旧的 v1 编译（仅测试与历史路径使用）。 */
export function compileReleaseSnapshot(draft: ScenarioDraftInput): ReleaseSnapshotV1 {
  return {
    schemaVersion: 'release-snapshot/v1',
    releaseSnapshotId: crypto.randomUUID(),
    scenarioDraftId: draft.id,
    compiledAt: new Date().toISOString(),
    title: draft.payload.title,
    knowledgeVersions: draft.payload.knowledgeVersions,
    scoringRules: draft.payload.scoringRules,
    agentConfig: draft.payload.agentConfig,
  };
}

export interface CompileReleaseSnapshotV2Input {
  readonly draft: ScenarioDraftInput;
  readonly compiledBy: string;
  readonly personaConfig: PersonaConfig;
  readonly personaSource: ScenarioPersonaSource;
  readonly agentConfig: AgentConfigV1;
  readonly learnerOverridePolicy: LearnerOverridePolicyV1;
}

/** 发布时解析并冻结完整配置为 v2 快照（spec §4、§5.3）。 */
export function compileReleaseSnapshotV2(input: CompileReleaseSnapshotV2Input): ReleaseSnapshotV2 {
  const { draft, compiledBy, personaConfig, personaSource, agentConfig, learnerOverridePolicy } = input;
  const source: ReleaseSnapshotV2['personaSource'] =
    personaSource.kind === 'inline'
      ? { kind: 'inline' }
      : {
          kind: 'template_revision',
          templateId: personaSource.templateId,
          revisionId: personaSource.revisionId,
          revision: personaSource.revision,
        };
  return {
    schemaVersion: 'release-snapshot/v2',
    releaseSnapshotId: crypto.randomUUID(),
    scenarioDraftId: draft.id,
    compiledAt: new Date().toISOString(),
    compiledBy,
    title: draft.payload.title,
    personaConfig,
    personaSource: source,
    knowledgeVersions: draft.payload.knowledgeVersions,
    scoringRules: draft.payload.scoringRules,
    agentConfig,
    learnerOverridePolicy,
  };
}
