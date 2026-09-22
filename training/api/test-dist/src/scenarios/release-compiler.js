import crypto from 'node:crypto';
/** 兼容旧的 v1 编译（仅测试与历史路径使用）。 */
export function compileReleaseSnapshot(draft) {
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
/** 发布时解析并冻结完整配置为 v2 快照（spec §4、§5.3）。 */
export function compileReleaseSnapshotV2(input) {
    const { draft, compiledBy, personaConfig, personaSource, agentConfig, learnerOverridePolicy } = input;
    const source = personaSource.kind === 'inline'
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
