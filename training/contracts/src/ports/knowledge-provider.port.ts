export interface KnowledgeRef {
  readonly itemId: string;
  readonly version: string;
  readonly organizationId: string;
}

export interface ApprovedKnowledgeItem {
  readonly id: string;
  readonly version: string;
  readonly status: 'approved';
  readonly content: string;
}

export interface KnowledgeProviderPort {
  getApprovedItem(ref: KnowledgeRef): Promise<ApprovedKnowledgeItem>;
}
