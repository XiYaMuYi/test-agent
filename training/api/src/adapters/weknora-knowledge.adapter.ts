import type { ApprovedKnowledgeItem, KnowledgeProviderPort, KnowledgeRef } from '@training/contracts';

export interface WeknoraKnowledgeConfiguration {
  /** Root URL, e.g. http://host.docker.internal:8081. */
  readonly baseUrl: string;
  /** WeKnora workspace API key sent as X-API-Key. */
  readonly apiKey: string;
  /** Optional default KB UUIDs. A ref.itemId is used when this is empty. */
  readonly knowledgeBaseIds?: readonly string[];
  readonly timeoutMs?: number;
}

/**
 * KnowledgeProviderPort skeleton for the company-deployed weknora service.
 *
 * WeKnora retrieval adapter matching the deployed AI solution contract:
 * POST /api/v1/knowledge-search, X-API-Key, query + knowledge_base_ids.
 * A release ref is preserved as itemId@version; WeKnora passages are returned
 * as the approved content consumed by the existing orchestrator.
 */
export class WeknoraKnowledgeAdapter implements KnowledgeProviderPort {
  public constructor(private readonly config: WeknoraKnowledgeConfiguration) {}

  public async getApprovedItem(ref: KnowledgeRef): Promise<ApprovedKnowledgeItem> {
    const ids = this.config.knowledgeBaseIds?.filter(Boolean) ?? [];
    const knowledgeBaseIds = ids.length > 0 ? ids : [ref.itemId];
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/api/v1/knowledge-search`, {
      method: 'POST',
      headers: { 'X-API-Key': this.config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${ref.itemId}@${ref.version}`,
        knowledge_base_ids: knowledgeBaseIds,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error(`WeKnora knowledge search returned HTTP ${response.status}.`);
    const body: unknown = await response.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || (body as { success?: unknown }).success !== true) {
      throw new Error('WeKnora knowledge search returned an unsuccessful response.');
    }
    const items = (body as { data?: unknown }).data;
    if (!Array.isArray(items) || items.length === 0) throw new Error(`WeKnora returned no approved content for ${ref.itemId}@${ref.version}.`);
    const passages = items.slice(0, 5).filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(item => typeof item.content === 'string' ? item.content.trim() : '').filter(Boolean);
    if (passages.length === 0) throw new Error(`WeKnora returned no content for ${ref.itemId}@${ref.version}.`);
    return { id: ref.itemId, version: ref.version, status: 'approved', content: passages.join('\n\n') };
  }
}
