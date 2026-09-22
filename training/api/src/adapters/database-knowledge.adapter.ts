import type { Pool } from 'pg';

import type {
  ApprovedKnowledgeItem,
  KnowledgeProviderPort,
  KnowledgeRef,
} from '@training/contracts';

/**
 * 从结构化知识库（knowledge_product 表）加载已审核产品知识。
 * 替代 FakeKnowledgeAdapter 的硬编码假数据，让 B 端配置的产品知识真正生效。
 *
 * 版本约定：knowledge_product 表无 version 字段，统一约定默认版本为 "1"。
 * 发布快照中的引用格式为 `${productId}@1`。
 */
export class DatabaseKnowledgeAdapter implements KnowledgeProviderPort {
  constructor(private readonly database: Pool) {}

  async getApprovedItem(ref: KnowledgeRef): Promise<ApprovedKnowledgeItem> {
    // 版本校验：约定默认版本为 "1"
    if (ref.version !== '1' && ref.version !== 'latest') {
      throw new DatabaseKnowledgeNotFoundError(ref, `unsupported version: ${ref.version}`);
    }

    const { rows } = await this.database.query<{
      id: string;
      name: string;
      category: string | null;
      aliases: unknown;
      core_efficacies: unknown;
      suitable_skin_types: unknown;
      suitable_audience: string | null;
      price_range: string | null;
      key_ingredients: unknown;
      key_selling_points: string | null;
      contraindicated_skin_types: unknown;
      contraindicated_audience: string | null;
      status: string;
    }>(
      `SELECT id, name, category, aliases, core_efficacies, suitable_skin_types,
              suitable_audience, price_range, key_ingredients, key_selling_points,
              contraindicated_skin_types, contraindicated_audience, status
       FROM knowledge_product
       WHERE id = $1 AND organization_id = $2`,
      [ref.itemId, ref.organizationId],
    );

    const record = rows[0];
    if (record === undefined) {
      throw new DatabaseKnowledgeNotFoundError(ref, 'product not found');
    }
    if (record.status !== 'active') {
      throw new DatabaseKnowledgeNotFoundError(ref, `product status is ${record.status}, not active`);
    }

    const content = this.buildContent(record);
    return {
      id: record.id,
      version: '1',
      status: 'approved',
      content,
    };
  }

  private buildContent(record: {
    name: string;
    category: string | null;
    aliases: unknown;
    core_efficacies: unknown;
    suitable_skin_types: unknown;
    suitable_audience: string | null;
    price_range: string | null;
    key_ingredients: unknown;
    key_selling_points: string | null;
    contraindicated_skin_types: unknown;
    contraindicated_audience: string | null;
  }): string {
    const lines: string[] = [];
    lines.push(`产品名称：${record.name}`);
    if (record.category) lines.push(`产品分类：${record.category}`);
    if (this.isStringArray(record.aliases) && record.aliases.length > 0) {
      lines.push(`产品别名：${record.aliases.join('、')}`);
    }
    if (this.isStringArray(record.core_efficacies) && record.core_efficacies.length > 0) {
      lines.push(`核心功效：${record.core_efficacies.join('、')}`);
    }
    if (this.isStringArray(record.suitable_skin_types) && record.suitable_skin_types.length > 0) {
      lines.push(`适用肤质：${record.suitable_skin_types.join('、')}`);
    }
    if (record.suitable_audience) lines.push(`适用人群：${record.suitable_audience}`);
    if (record.price_range) lines.push(`价格区间：${record.price_range}`);
    if (this.isStringArray(record.key_ingredients) && record.key_ingredients.length > 0) {
      lines.push(`核心成分：${record.key_ingredients.join('、')}`);
    }
    if (record.key_selling_points) lines.push(`核心卖点：${record.key_selling_points}`);
    if (this.isStringArray(record.contraindicated_skin_types) && record.contraindicated_skin_types.length > 0) {
      lines.push(`禁忌肤质：${record.contraindicated_skin_types.join('、')}`);
    }
    if (record.contraindicated_audience) lines.push(`禁忌人群：${record.contraindicated_audience}`);
    return lines.join('\n');
  }

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
  }
}

export class DatabaseKnowledgeNotFoundError extends Error {
  readonly code = 'DATABASE_KNOWLEDGE_NOT_FOUND';
  constructor(ref: KnowledgeRef, detail: string) {
    super(`No approved knowledge product for ${ref.itemId}@${ref.version} in org ${ref.organizationId}: ${detail}`);
    this.name = 'DatabaseKnowledgeNotFoundError';
  }
}

export function isDatabaseKnowledgeNotFoundError(value: unknown): value is DatabaseKnowledgeNotFoundError {
  return value instanceof DatabaseKnowledgeNotFoundError;
}
