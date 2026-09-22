import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import type { ProductCreateInput, ProductUpdateInput } from './knowledge.service.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * 结构化知识库 API（B 端运营维护）。
 *
 * 产品库 CRUD + 症状功效映射 + 禁忌库查询。
 * 所有接口 organization 级别隔离。
 */
@Controller('knowledge')
@UseGuards(PrincipalGuard)
export class KnowledgeController {
  public constructor(private readonly knowledge: KnowledgeService) {}

  // ─── 产品库 ───

  @Get('products')
  async listProducts(
    @Principal() principal: CurrentPrincipal,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const products = await this.knowledge.listProducts(principal.organizationId, includeInactive === 'true');
    return { products, total: products.length };
  }

  @Get('products/:id')
  async getProduct(@Principal() principal: CurrentPrincipal, @Param('id') id: string) {
    const product = await this.knowledge.getProduct(principal.organizationId, id);
    if (!product) return { error: 'PRODUCT_NOT_FOUND' };
    return { product };
  }

  @Post('products')
  async createProduct(@Principal() principal: CurrentPrincipal, @Body() body: ProductCreateInput) {
    const product = await this.knowledge.createProduct({ ...body, organizationId: principal.organizationId });
    return { product };
  }

  @Put('products/:id')
  async updateProduct(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: ProductUpdateInput,
  ) {
    const product = await this.knowledge.updateProduct(principal.organizationId, id, body);
    return { product };
  }

  @Delete('products/:id')
  async deleteProduct(@Principal() principal: CurrentPrincipal, @Param('id') id: string) {
    await this.knowledge.deleteProduct(principal.organizationId, id);
    return { success: true };
  }

  // ─── 症状功效映射 ───

  @Get('symptom-efficacy')
  async listSymptomEfficacy(@Principal() principal: CurrentPrincipal) {
    const mappings = await this.knowledge.listSymptomEfficacy(principal.organizationId);
    return { mappings, total: mappings.length };
  }

  // ─── 禁忌库 ───

  @Get('contraindications')
  async listContraindications(@Principal() principal: CurrentPrincipal) {
    const contraindications = await this.knowledge.listContraindications(principal.organizationId);
    return { contraindications, total: contraindications.length };
  }
}
