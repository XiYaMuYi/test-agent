import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import type { DimensionCreateInput, DimensionUpdateInput } from './scoring-config.service.js';
import { ScoringConfigService } from './scoring-config.service.js';

/**
 * 评分配置 API（B 端运营维护）。
 *
 * 评分维度 CRUD + 评分模板查询。
 * 首次访问自动初始化默认 5 维度 + 默认模板。
 */
@Controller('scoring')
@UseGuards(PrincipalGuard)
export class ScoringConfigController {
  public constructor(private readonly scoring: ScoringConfigService) {}

  // ─── 维度 ───

  @Get('dimensions')
  async listDimensions(@Principal() principal: CurrentPrincipal) {
    const dimensions = await this.scoring.listDimensions(principal.organizationId);
    return { dimensions, total: dimensions.length };
  }

  @Get('dimensions/:id')
  async getDimension(@Principal() principal: CurrentPrincipal, @Param('id') id: string) {
    const dimension = await this.scoring.getDimension(principal.organizationId, id);
    if (!dimension) return { error: 'DIMENSION_NOT_FOUND' };
    return { dimension };
  }

  @Post('dimensions')
  async createDimension(@Principal() principal: CurrentPrincipal, @Body() body: DimensionCreateInput) {
    const dimension = await this.scoring.createDimension(principal.organizationId, body);
    return { dimension };
  }

  @Put('dimensions/:id')
  async updateDimension(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: DimensionUpdateInput,
  ) {
    const dimension = await this.scoring.updateDimension(principal.organizationId, id, body);
    return { dimension };
  }

  @Delete('dimensions/:id')
  async deleteDimension(@Principal() principal: CurrentPrincipal, @Param('id') id: string) {
    await this.scoring.deleteDimension(principal.organizationId, id);
    return { success: true };
  }

  // ─── 模板 ───

  @Get('templates')
  async listTemplates(@Principal() principal: CurrentPrincipal) {
    const templates = await this.scoring.listTemplates(principal.organizationId);
    return { templates, total: templates.length };
  }

  @Get('templates/:id/dimensions')
  async getTemplateDimensions(@Principal() principal: CurrentPrincipal, @Param('id') id: string) {
    const dimensions = await this.scoring.getTemplateDimensionConfigs(principal.organizationId, id);
    return { dimensions, total: dimensions.length };
  }

  @Put('templates/:id/dimensions')
  async updateTemplateDimensions(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: { readonly dimensions?: readonly { dimensionId: string; weight?: number | null; sortOrder?: number }[] },
  ) {
    if (!Array.isArray(body.dimensions)) {
      return { error: 'dimensions array is required' };
    }
    const result = await this.scoring.updateTemplateDimensions(principal.organizationId, id, body.dimensions);
    return { dimensions: result, total: result.length };
  }

  @Put('templates/:id')
  async updateTemplate(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: { readonly name?: string; readonly description?: string; readonly evaluationMode?: string; readonly coachCommentPrompt?: string },
  ) {
    const evaluationMode = body.evaluationMode === 'grouped' || body.evaluationMode === 'per_dimension' || body.evaluationMode === 'single'
      ? body.evaluationMode
      : undefined;
    const template = await this.scoring.updateTemplate(principal.organizationId, id, {
      name: body.name,
      description: body.description,
      evaluationMode,
      coachCommentPrompt: body.coachCommentPrompt,
    });
    return { template };
  }
}
