export const defaultKnowledgeHttpFetch = (url, init) => fetch(url, init);
function isRecord(value) {
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
export class ExternalHttpKnowledgeAdapter {
    fetcher;
    config;
    constructor(fetcher, config) {
        this.fetcher = fetcher;
        this.config = config;
    }
    async getApprovedItem(ref) {
        const headers = {};
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
        const body = await response.json().catch(() => undefined);
        return this.parseItem(body);
    }
    /**
     * Seam #1 for weknora: translate a knowledge reference into its request URL.
     * Replace this path/query mapping with the real weknora route when known.
     */
    buildItemUrl(ref) {
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
    parseItem(body) {
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
