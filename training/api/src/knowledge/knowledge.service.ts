import crypto from 'node:crypto';

import type { Pool } from 'pg';

import type {
  Contraindication,
  CoreEfficacy,
  KnowledgeMatchResult,
  Product,
  SymptomEfficacyMapping,
} from '@training/contracts';

const uuid = () => crypto.randomUUID();

/** 产品库行（DB 投影） */
interface ProductRow {
  id: string;
  organization_id: string;
  name: string;
  aliases: string[];
  category: string;
  core_efficacies: string[];
  suitable_skin_types: string[];
  suitable_scenarios: string[];
  suitable_audience: string;
  price_range: string;
  key_ingredients: string[];
  key_selling_points: string;
  contraindicated_skin_types: string[];
  contraindicated_audience: string;
  associated_product_ids: string[];
  status: string;
  created_at: Date;
  updated_at: Date;
}

function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    category: row.category as Product['category'],
    coreEfficacies: row.core_efficacies as CoreEfficacy[],
    suitableSkinTypes: row.suitable_skin_types as Product['suitableSkinTypes'],
    suitableScenarios: row.suitable_scenarios as Product['suitableScenarios'],
    suitableAudience: row.suitable_audience,
    priceRange: row.price_range,
    keyIngredients: row.key_ingredients,
    keySellingPoints: row.key_selling_points,
    contraindicatedSkinTypes: row.contraindicated_skin_types as Product['contraindicatedSkinTypes'],
    contraindicatedAudience: row.contraindicated_audience,
    associatedProductIds: row.associated_product_ids,
    status: row.status as Product['status'],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ProductCreateInput {
  readonly organizationId: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly category?: string;
  readonly coreEfficacies?: readonly string[];
  readonly suitableSkinTypes?: readonly string[];
  readonly suitableScenarios?: readonly string[];
  readonly suitableAudience?: string;
  readonly priceRange?: string;
  readonly keyIngredients?: readonly string[];
  readonly keySellingPoints?: string;
  readonly contraindicatedSkinTypes?: readonly string[];
  readonly contraindicatedAudience?: string;
  readonly associatedProductIds?: readonly string[];
}

export interface ProductUpdateInput extends Partial<ProductCreateInput> {
  readonly status?: 'active' | 'inactive';
}

/**
 * 结构化知识库服务。
 *
 * 负责产品库/症状功效映射/禁忌库的 CRUD，以及评分时的知识匹配计算。
 * 所有数据 organization 级别隔离。
 */
export class KnowledgeService {
  public constructor(private readonly db: Pool) {}

  // ─── 产品库 CRUD ───

  async listProducts(organizationId: string, includeInactive = false): Promise<readonly Product[]> {
    const where = includeInactive ? 'WHERE organization_id = $1' : "WHERE organization_id = $1 AND status = 'active'";
    const result = await this.db.query(
      `SELECT * FROM knowledge_product ${where} ORDER BY name ASC`,
      [organizationId],
    );
    return (result.rows as unknown as ProductRow[]).map(rowToProduct);
  }

  async getProduct(organizationId: string, productId: string): Promise<Product | null> {
    const result = await this.db.query(
      'SELECT * FROM knowledge_product WHERE organization_id = $1 AND id = $2',
      [organizationId, productId],
    );
    const rows = result.rows as unknown as ProductRow[];
    const first = rows[0];
    return first ? rowToProduct(first) : null;
  }

  async createProduct(input: ProductCreateInput): Promise<Product> {
    const id = uuid();
    await this.db.query(
      `INSERT INTO knowledge_product (
        id, organization_id, name, aliases, category, core_efficacies,
        suitable_skin_types, suitable_scenarios, suitable_audience, price_range, key_ingredients,
        key_selling_points, contraindicated_skin_types, contraindicated_audience, associated_product_ids
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        input.organizationId,
        input.name,
        JSON.stringify(input.aliases ?? []),
        input.category ?? '其他',
        JSON.stringify(input.coreEfficacies ?? []),
        JSON.stringify(input.suitableSkinTypes ?? []),
        JSON.stringify(input.suitableScenarios ?? []),
        input.suitableAudience ?? '',
        input.priceRange ?? '',
        JSON.stringify(input.keyIngredients ?? []),
        input.keySellingPoints ?? '',
        JSON.stringify(input.contraindicatedSkinTypes ?? []),
        input.contraindicatedAudience ?? '',
        JSON.stringify(input.associatedProductIds ?? []),
      ],
    );
    const product = await this.getProduct(input.organizationId, id);
    if (!product) throw new Error('Product creation failed');
    return product;
  }

  async updateProduct(organizationId: string, productId: string, input: ProductUpdateInput): Promise<Product> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    const addSet = (column: string, value: unknown) => {
      sets.push(`${column} = $${paramIndex++}`);
      params.push(value);
    };

    if (input.name !== undefined) addSet('name', input.name);
    if (input.aliases !== undefined) addSet('aliases', JSON.stringify(input.aliases));
    if (input.category !== undefined) addSet('category', input.category);
    if (input.coreEfficacies !== undefined) addSet('core_efficacies', JSON.stringify(input.coreEfficacies));
    if (input.suitableSkinTypes !== undefined) addSet('suitable_skin_types', JSON.stringify(input.suitableSkinTypes));
    if (input.suitableScenarios !== undefined) addSet('suitable_scenarios', JSON.stringify(input.suitableScenarios));
    if (input.suitableAudience !== undefined) addSet('suitable_audience', input.suitableAudience);
    if (input.priceRange !== undefined) addSet('price_range', input.priceRange);
    if (input.keyIngredients !== undefined) addSet('key_ingredients', JSON.stringify(input.keyIngredients));
    if (input.keySellingPoints !== undefined) addSet('key_selling_points', input.keySellingPoints);
    if (input.contraindicatedSkinTypes !== undefined) addSet('contraindicated_skin_types', JSON.stringify(input.contraindicatedSkinTypes));
    if (input.contraindicatedAudience !== undefined) addSet('contraindicated_audience', input.contraindicatedAudience);
    if (input.associatedProductIds !== undefined) addSet('associated_product_ids', JSON.stringify(input.associatedProductIds));
    if (input.status !== undefined) addSet('status', input.status);

    if (sets.length === 0) {
      const existing = await this.getProduct(organizationId, productId);
      if (!existing) throw new Error('Product not found');
      return existing;
    }

    addSet('updated_at', new Date());
    params.push(organizationId, productId);

    await this.db.query(
      `UPDATE knowledge_product SET ${sets.join(', ')} WHERE organization_id = $${paramIndex++} AND id = $${paramIndex}`,
      params,
    );
    const product = await this.getProduct(organizationId, productId);
    if (!product) throw new Error('Product update failed');
    return product;
  }

  async deleteProduct(organizationId: string, productId: string): Promise<void> {
    await this.db.query(
      "UPDATE knowledge_product SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE organization_id = $1 AND id = $2",
      [organizationId, productId],
    );
  }

  // ─── 症状功效映射 CRUD ───

  async listSymptomEfficacy(organizationId: string): Promise<readonly SymptomEfficacyMapping[]> {
    const result = await this.db.query(
      "SELECT * FROM knowledge_symptom_efficacy WHERE organization_id = $1 AND status = 'active' ORDER BY severity_weight DESC",
      [organizationId],
    );
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      customerExpressions: row.customer_expressions as string[],
      efficacyNeed: row.efficacy_need as CoreEfficacy,
      severityWeight: Number(row.severity_weight),
      status: row.status as SymptomEfficacyMapping['status'],
    }));
  }

  // ─── 禁忌库 CRUD ───

  async listContraindications(organizationId: string): Promise<readonly Contraindication[]> {
    const result = await this.db.query(
      "SELECT * FROM knowledge_contraindication WHERE organization_id = $1 AND status = 'active' ORDER BY severity DESC",
      [organizationId],
    );
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      customerCondition: row.customer_condition as string,
      forbiddenProductIds: row.forbidden_product_ids as string[],
      forbiddenIngredients: row.forbidden_ingredients as string[],
      reason: row.reason as string,
      severity: row.severity as Contraindication['severity'],
      status: row.status as Contraindication['status'],
    }));
  }

  // ─── 知识匹配引擎（评分核心） ───

  /**
   * 根据对话记录和客户画像，计算知识匹配结果。
   * 这是 LLM 评分的事实依据，LLM 不得违背。
   */
  async computeKnowledgeMatch(
    organizationId: string,
    transcript: readonly { role: string; content: string }[],
    personaConfig?: { skinType?: string; age?: number; occupation?: string },
  ): Promise<KnowledgeMatchResult> {
    const products = await this.listProducts(organizationId);
    const symptomMappings = await this.listSymptomEfficacy(organizationId);
    const contraindications = await this.listContraindications(organizationId);

    const learnerText = transcript
      .filter((m) => m.role === 'learner')
      .map((m) => m.content)
      .join(' ');
    const assistantText = transcript
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join(' ');

    // 1. 识别学员话术中提到的产品
    type MentionedProduct = { productId: string; productName: string; matchedByName: string };
    const mentionedProducts: MentionedProduct[] = [];
    for (const product of products) {
      const allNames = [product.name, ...product.aliases];
      for (const name of allNames) {
        if (name && learnerText.includes(name)) {
          mentionedProducts.push({ productId: product.id, productName: product.name, matchedByName: name });
          break;
        }
      }
    }

    // 2. 客户表达 → 功效需求映射
    type EfficacyNeed = { expression: string; efficacyNeed: CoreEfficacy; severityWeight: number };
    const customerEfficacyNeeds: EfficacyNeed[] = [];
    for (const mapping of symptomMappings) {
      for (const expression of mapping.customerExpressions) {
        if (expression && assistantText.includes(expression)) {
          customerEfficacyNeeds.push({
            expression,
            efficacyNeed: mapping.efficacyNeed,
            severityWeight: mapping.severityWeight,
          });
          break;
        }
      }
    }

    // 3. 产品对症度
    const neededEfficacies = new Set<CoreEfficacy>(customerEfficacyNeeds.map((n: EfficacyNeed) => n.efficacyNeed));
    type ProductMatch = { productId: string; productName: string; coveredNeeds: CoreEfficacy[]; missedNeeds: CoreEfficacy[]; matchScore: number };
    const productEfficacyMatch: ProductMatch[] = [];
    for (const mentioned of mentionedProducts) {
      const product = products.find((p) => p.id === mentioned.productId);
      if (!product) continue;
      const covered = product.coreEfficacies.filter((e: CoreEfficacy) => neededEfficacies.has(e));
      const missed = [...neededEfficacies].filter((e: CoreEfficacy) => !product.coreEfficacies.includes(e));
      const matchScore = neededEfficacies.size > 0 ? Math.round((covered.length / neededEfficacies.size) * 100) : 50;
      productEfficacyMatch.push({
        productId: product.id,
        productName: product.name,
        coveredNeeds: covered,
        missedNeeds: missed,
        matchScore,
      });
    }

    // 4. 禁忌命中
    type ContraHit = { customerCondition: string; productName: string; reason: string; severity: Contraindication['severity'] };
    const contraindicationHits: ContraHit[] = [];
    const customerSkin = personaConfig?.skinType ?? '';
    for (const ci of contraindications) {
      // 检查客户条件是否匹配（肤质/人群关键词）
      const conditionMatch =
        (customerSkin && ci.customerCondition.includes(customerSkin)) ||
        (personaConfig?.age !== undefined && ci.customerCondition.includes(String(personaConfig.age))) ||
        assistantText.includes(ci.customerCondition);
      if (!conditionMatch) continue;
      for (const mentioned of mentionedProducts) {
        if (ci.forbiddenProductIds.includes(mentioned.productId)) {
          contraindicationHits.push({
            customerCondition: ci.customerCondition,
            productName: mentioned.productName,
            reason: ci.reason,
            severity: ci.severity,
          });
        }
      }
      // 检查禁止成分
      for (const ingredient of ci.forbiddenIngredients) {
        if (ingredient && learnerText.includes(ingredient)) {
          contraindicationHits.push({
            customerCondition: ci.customerCondition,
            productName: `（成分：${ingredient}）`,
            reason: ci.reason,
            severity: ci.severity,
          });
        }
      }
    }

    // 5. 连带推荐检测
    const recommendedProductIds = mentionedProducts.map((m) => m.productId);
    const suggestedAssociations: string[] = [];
    for (const mentioned of mentionedProducts) {
      const product = products.find((p) => p.id === mentioned.productId);
      if (!product) continue;
      for (const assocId of product.associatedProductIds) {
        if (!recommendedProductIds.includes(assocId)) {
          const assocProduct = products.find((p) => p.id === assocId);
          if (assocProduct) suggestedAssociations.push(assocProduct.name);
        }
      }
    }

    return {
      mentionedProducts,
      customerEfficacyNeeds,
      productEfficacyMatch,
      contraindicationHits,
      associationRecommendation: {
        hasAssociation: suggestedAssociations.length === 0 || recommendedProductIds.length > 1,
        recommendedProductIds,
        suggestedAssociations: [...new Set(suggestedAssociations)],
      },
    };
  }
}



