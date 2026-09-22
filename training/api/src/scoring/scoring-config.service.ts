import crypto from 'node:crypto';

import type { Pool } from 'pg';

import type { GradingRubric, KnowledgeDependency, ScoringDimension, ScoringTemplate } from '@training/contracts';
import { DEFAULT_GRADING_RUBRIC, DEFAULT_SCORING_DIMENSIONS } from '@training/contracts';

const uuid = () => crypto.randomUUID();

interface DimensionRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  description: string;
  weight: number;
  knowledge_dependencies: string[];
  grading_rubric: GradingRubric;
  keywords: string[];
  llm_prompt: string;
  is_configured: boolean;
  sort_order: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function rowToDimension(row: DimensionRow): ScoringDimension {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    weight: row.weight,
    knowledgeDependencies: row.knowledge_dependencies as KnowledgeDependency[],
    gradingRubric: row.grading_rubric,
    keywords: row.keywords,
    llmPrompt: row.llm_prompt,
    isConfigured: row.is_configured,
    sortOrder: row.sort_order,
    status: row.status as ScoringDimension['status'],
  };
}

export interface DimensionCreateInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly weight?: number;
  readonly knowledgeDependencies?: readonly string[];
  readonly gradingRubric?: GradingRubric;
  readonly keywords?: readonly string[];
  readonly llmPrompt?: string;
  readonly isConfigured?: boolean;
  readonly sortOrder?: number;
}

export interface DimensionUpdateInput extends Partial<DimensionCreateInput> {
  readonly status?: 'active' | 'inactive';
}

/**
 * 评分配置服务。
 *
 * 管理评分维度（权重/分级/知识依赖/关键词/LLM引导语/是否已配置）
 * 和评分模板（一组维度的集合）。
 * 首次访问时自动初始化默认 5 维度 + 默认模板。
 */
export class ScoringConfigService {
  public constructor(private readonly db: Pool) {}

  // ─── 初始化默认维度 ───

  async ensureDefaultDimensions(organizationId: string): Promise<void> {
    const result = await this.db.query(
      'SELECT COUNT(*)::int AS cnt FROM scoring_dimension WHERE organization_id = $1',
      [organizationId],
    );
    const count = (result.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    if (count > 0) return;

    for (const dim of DEFAULT_SCORING_DIMENSIONS) {
      await this.db.query(
        `INSERT INTO scoring_dimension (
          id, organization_id, code, name, description, weight,
          knowledge_dependencies, grading_rubric, keywords, llm_prompt,
          is_configured, sort_order, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')`,
        [
          uuid(),
          organizationId,
          dim.code,
          dim.name,
          dim.description,
          dim.weight,
          JSON.stringify(dim.knowledgeDependencies),
          JSON.stringify(dim.gradingRubric ?? DEFAULT_GRADING_RUBRIC),
          JSON.stringify(dim.keywords ?? []),
          dim.llmPrompt ?? '',
          dim.isConfigured,
          dim.sortOrder,
        ],
      );
    }

    // 创建默认模板
    const templateId = uuid();
    await this.db.query(
      `INSERT INTO scoring_template (id, organization_id, name, description, is_default, status)
       VALUES ($1,$2,$3,$4,true,'active')`,
      [templateId, organizationId, '默认评分模板', '系统默认 5 维度评分模板，适用于通用销售陪练'],
    );

    // 关联模板-维度
    const dims = await this.listDimensions(organizationId);
    for (const dim of dims) {
      await this.db.query(
        'INSERT INTO scoring_template_dimension (template_id, dimension_id, sort_order) VALUES ($1,$2,$3)',
        [templateId, dim.id, dim.sortOrder],
      );
    }
  }

  // ─── 维度 CRUD ───

  async listDimensions(organizationId: string, includeInactive = false): Promise<readonly ScoringDimension[]> {
    await this.ensureDefaultDimensions(organizationId);
    const where = includeInactive ? 'WHERE organization_id = $1' : "WHERE organization_id = $1 AND status = 'active'";
    const result = await this.db.query(
      `SELECT * FROM scoring_dimension ${where} ORDER BY sort_order ASC`,
      [organizationId],
    );
    return (result.rows as unknown as DimensionRow[]).map(rowToDimension);
  }

  async getDimension(organizationId: string, dimensionId: string): Promise<ScoringDimension | null> {
    const result = await this.db.query(
      'SELECT * FROM scoring_dimension WHERE organization_id = $1 AND id = $2',
      [organizationId, dimensionId],
    );
    const rows = result.rows as unknown as DimensionRow[];
    const first = rows[0];
    return first ? rowToDimension(first) : null;
  }

  async createDimension(organizationId: string, input: DimensionCreateInput): Promise<ScoringDimension> {
    const id = uuid();
    // 运营端不输入编码，系统自动生成：名称拼音转写失败时用 dim_ 前缀 + 短 id
    const code = input.code && input.code.length > 0
      ? input.code
      : `dim_${input.name?.slice(0, 12)?.replace(/[^\w]/g, '_') || 'custom'}_${id.slice(0, 6)}`;
    await this.db.query(
      `INSERT INTO scoring_dimension (
        id, organization_id, code, name, description, weight,
        knowledge_dependencies, grading_rubric, keywords, llm_prompt,
        is_configured, sort_order, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')`,
      [
        id,
        organizationId,
        code,
        input.name,
        input.description ?? '',
        input.weight ?? 20,
        JSON.stringify(input.knowledgeDependencies ?? ['none']),
        JSON.stringify(input.gradingRubric ?? DEFAULT_GRADING_RUBRIC),
        JSON.stringify(input.keywords ?? []),
        input.llmPrompt ?? '',
        input.isConfigured ?? false,
        input.sortOrder ?? 99,
      ],
    );
    const dim = await this.getDimension(organizationId, id);
    if (!dim) throw new Error('Dimension creation failed');
    return dim;
  }

  async updateDimension(organizationId: string, dimensionId: string, input: DimensionUpdateInput): Promise<ScoringDimension> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (input.name !== undefined) { sets.push(`name = $${i++}`); params.push(input.name); }
    if (input.description !== undefined) { sets.push(`description = $${i++}`); params.push(input.description); }
    if (input.weight !== undefined) { sets.push(`weight = $${i++}`); params.push(input.weight); }
    if (input.knowledgeDependencies !== undefined) { sets.push(`knowledge_dependencies = $${i++}`); params.push(JSON.stringify(input.knowledgeDependencies)); }
    if (input.gradingRubric !== undefined) { sets.push(`grading_rubric = $${i++}`); params.push(JSON.stringify(input.gradingRubric)); }
    if (input.keywords !== undefined) { sets.push(`keywords = $${i++}`); params.push(JSON.stringify(input.keywords)); }
    if (input.llmPrompt !== undefined) { sets.push(`llm_prompt = $${i++}`); params.push(input.llmPrompt); }
    if (input.isConfigured !== undefined) { sets.push(`is_configured = $${i++}`); params.push(input.isConfigured); }
    if (input.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); params.push(input.sortOrder); }
    if (input.status !== undefined) { sets.push(`status = $${i++}`); params.push(input.status); }

    if (sets.length === 0) {
      const existing = await this.getDimension(organizationId, dimensionId);
      if (!existing) throw new Error('Dimension not found');
      return existing;
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(organizationId, dimensionId);

    await this.db.query(
      `UPDATE scoring_dimension SET ${sets.join(', ')} WHERE organization_id = $${i++} AND id = $${i}`,
      params,
    );
    const dim = await this.getDimension(organizationId, dimensionId);
    if (!dim) throw new Error('Dimension update failed');
    return dim;
  }

  async deleteDimension(organizationId: string, dimensionId: string): Promise<void> {
    await this.db.query(
      "UPDATE scoring_dimension SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE organization_id = $1 AND id = $2",
      [organizationId, dimensionId],
    );
  }

  // ─── 模板 CRUD ───

  async listTemplates(organizationId: string): Promise<readonly ScoringTemplate[]> {
    await this.ensureDefaultDimensions(organizationId);
    const result = await this.db.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM assignment a
               WHERE a.organization_id = t.organization_id AND a.scoring_template_id = t.id) AS linked_assignment_count
       FROM scoring_template t
       WHERE t.organization_id = $1 AND t.status = 'active'
       ORDER BY t.is_default DESC, t.name ASC`,
      [organizationId],
    );
    return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      dimensionIds: [], // 单独查询
      isDefault: row.is_default as boolean,
      status: row.status as ScoringTemplate['status'],
      evaluationMode: (row.evaluation_mode as ScoringTemplate['evaluationMode']) ?? 'grouped',
      coachCommentPrompt: (row.coach_comment_prompt as string) ?? '',
      linkedAssignmentCount: (row.linked_assignment_count as number) ?? 0,
    }));
  }

  async getTemplateDimensions(organizationId: string, templateId: string): Promise<readonly ScoringDimension[]> {
    const result = await this.db.query(
      `SELECT d.* FROM scoring_dimension d
       JOIN scoring_template_dimension td ON td.dimension_id = d.id
       WHERE td.template_id = $1 AND d.organization_id = $2 AND d.status = 'active'
       ORDER BY td.sort_order ASC`,
      [templateId, organizationId],
    );
    return (result.rows as unknown as DimensionRow[]).map(rowToDimension);
  }

  /** 获取模板的维度配置（含模板级权重覆盖，NULL 表示用全局权重）。 */
  async getTemplateDimensionConfigs(organizationId: string, templateId: string): Promise<readonly {
    readonly dimensionId: string;
    readonly code: string;
    readonly name: string;
    readonly globalWeight: number;
    readonly templateWeight: number | null;
    readonly effectiveWeight: number;
    readonly sortOrder: number;
  }[]> {
    const result = await this.db.query(
      `SELECT d.id AS dimension_id, d.code, d.name, d.weight AS global_weight,
              td.weight AS template_weight, td.sort_order
       FROM scoring_dimension d
       JOIN scoring_template_dimension td ON td.dimension_id = d.id
       WHERE td.template_id = $1 AND d.organization_id = $2 AND d.status = 'active'
       ORDER BY td.sort_order ASC`,
      [templateId, organizationId],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      dimensionId: String(row.dimension_id),
      code: String(row.code),
      name: String(row.name),
      globalWeight: Number(row.global_weight ?? 0),
      templateWeight: row.template_weight !== null ? Number(row.template_weight) : null,
      effectiveWeight: row.template_weight !== null ? Number(row.template_weight) : Number(row.global_weight ?? 0),
      sortOrder: Number(row.sort_order ?? 0),
    }));
  }

  /** 批量更新模板的维度关联（全量替换：先删后插）。每项可指定模板级权重（NULL=用全局权重）。 */
  async updateTemplateDimensions(organizationId: string, templateId: string, dimensions: readonly {
    readonly dimensionId: string;
    readonly weight?: number | null;
    readonly sortOrder?: number;
  }[]): Promise<readonly { dimensionId: string; effectiveWeight: number }[]> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // 校验模板存在
      const tplCheck = await client.query(
        `SELECT id FROM scoring_template WHERE id = $1 AND organization_id = $2`,
        [templateId, organizationId],
      );
      if (tplCheck.rows.length === 0) throw new Error('Template not found');
      // 全量删除旧关联
      await client.query(
        `DELETE FROM scoring_template_dimension WHERE template_id = $1`,
        [templateId],
      );
      // 插入新关联
      for (let i = 0; i < dimensions.length; i += 1) {
        const dim = dimensions[i];
        if (!dim) continue;
        await client.query(
          `INSERT INTO scoring_template_dimension (template_id, dimension_id, sort_order, weight)
           VALUES ($1, $2, $3, $4)`,
          [templateId, dim.dimensionId, dim.sortOrder ?? i, dim.weight ?? null],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getTemplateDimensionConfigs(organizationId, templateId);
  }

  /** 更新评分模板基础配置：名称、说明、评分策略、教练点评引导语。 */
  async updateTemplate(organizationId: string, templateId: string, input: {
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly evaluationMode?: 'grouped' | 'per_dimension' | 'single' | undefined;
    readonly coachCommentPrompt?: string | undefined;
  }): Promise<ScoringTemplate> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;
    if (input.name !== undefined) { fields.push(`name = $${paramIndex++}`); params.push(input.name); }
    if (input.description !== undefined) { fields.push(`description = $${paramIndex++}`); params.push(input.description ?? ''); }
    if (input.evaluationMode !== undefined) { fields.push(`evaluation_mode = $${paramIndex++}`); params.push(input.evaluationMode); }
    if (input.coachCommentPrompt !== undefined) { fields.push(`coach_comment_prompt = $${paramIndex++}`); params.push(input.coachCommentPrompt ?? ''); }
    if (fields.length === 0) {
      const existing = await this.listTemplates(organizationId);
      const found = existing.find((t) => t.id === templateId);
      if (!found) throw new Error('Template not found');
      return found;
    }
    params.push(organizationId, templateId);
    await this.db.query(
      `UPDATE scoring_template SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $${paramIndex++} AND id = $${paramIndex}`,
      params,
    );
    const updated = await this.listTemplates(organizationId);
    const found = updated.find((t) => t.id === templateId);
    if (!found) throw new Error('Template update failed');
    return found;
  }
}
