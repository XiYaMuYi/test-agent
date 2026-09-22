import type { ApprovedKnowledgeItem, KnowledgeProviderPort, KnowledgeRef } from '@training/contracts';

export interface ExternalKnowledgeConfiguration {
  /**
   * Root of the external knowledge service (the company-deployed weknora).
   * The concrete weknora request/response contract is finalized during
   * integration; {@link ExternalHttpKnowledgeAdapter.buildItemUrl} and
   * {@link ExternalHttpKnowledgeAdapter.parseItem} are the only two seams to
   * adjust then — nothing else in the codebase needs to change.
   */
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

interface KnowledgeFetchInit {
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

interface KnowledgeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type KnowledgeHttpFetchLike = (url: string, init: KnowledgeFetchInit) => Promise<KnowledgeFetchResponse>;

export const defaultKnowledgeHttpFetch: KnowledgeHttpFetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<KnowledgeFetchResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * KnowledgeProviderPort over an external HTTP knowledge service.
 *
 * This is the integration seam for the company-deployed weknora deployment.
 * It stays disabled by default (see readAiProviderConfiguration /
 * KNOWLEDGE_PROVIDER=fake) and only activates when an operator opts in, so the
 * system keeps running offline and in tests until the real contract is wired.
 */
export class ExternalHttpKnowledgeAdapter implements KnowledgeProviderPort {
  public constructor(
    private readonly fetcher: KnowledgeHttpFetchLike,
    private readonly config: ExternalKnowledgeConfiguration,
  ) {}

  public async getApprovedItem(ref: KnowledgeRef): Promise<ApprovedKnowledgeItem> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey !== undefined && this.config.apiKey.length > 0) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }
    const response = await this.fetcher(this.buildItemUrl(ref), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`External knowledge service responded with HTTP ${response.status} for ${ref.itemId}@${ref.version}.`);
    }
    const body = await response.json().catch((): undefined => undefined);
    return this.parseItem(body);
  }

  /**
   * Seam #1 for weknora: translate a knowledge reference into its request URL.
   * Replace this path/query mapping with the real weknora route when known.
   */
  protected buildItemUrl(ref: KnowledgeRef): string {
    const root = this.config.baseUrl.replace(/\/+$/, '');
    const item = encodeURIComponent(ref.itemId);
    const version = encodeURIComponent(ref.version);
    const organization = encodeURIComponent(ref.organizationId);
    return `${root}/items/${item}/versions/${version}?organizationId=${organization}`;
  }

  /**
   * Seam #2 for weknora: normalize the upstream body into an ApprovedKnowledgeItem.
   * Only entries explicitly marked approved and carrying non-empty content are served.
   */
  protected parseItem(body: unknown): ApprovedKnowledgeItem {
    if (!isRecord(body) || body.status !== 'approved' || typeof body.content !== 'string' || body.content.length === 0) {
      throw new Error('External knowledge service did not return an approved item with content.');
    }
    return {
      id: typeof body.id === 'string' ? body.id : '',
      version: typeof body.version === 'string' ? body.version : '',
      status: 'approved',
      content: body.content,
    };
  }
}
