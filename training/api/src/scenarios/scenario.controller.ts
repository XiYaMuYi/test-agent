import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import type { ScenarioPersonaSource } from './release-compiler.js';
import { ScenarioService } from './scenario.service.js';

interface CreateScenarioDraftBody {
  readonly id?: string;
  readonly payload: {
    readonly title: string;
    readonly personaSource?: ScenarioPersonaSource;
    readonly knowledgeVersions: readonly string[];
    readonly scoringRules: readonly string[];
    readonly agentConfig: Record<string, unknown>;
  };
}

interface UpdateScenarioDraftBody {
  readonly title?: string;
  readonly personaSource?: ScenarioPersonaSource;
  readonly knowledgeVersions?: readonly string[];
  readonly scoringRules?: readonly string[];
  readonly agentConfig?: Record<string, unknown>;
}

@Controller('admin/scenarios')
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin')
export class ScenarioController {
  private readonly scenarios: ScenarioService;

  public constructor(scenarios: ScenarioService) {
    this.scenarios = scenarios;
  }

  @Post()
  async createDraft(
    @Principal() principal: CurrentPrincipal,
    @Body() body: CreateScenarioDraftBody,
  ): Promise<{ id: string; status: 'created' }> {
    const { id } = await this.scenarios.createDraft(principal, {
      ...(typeof body.id === 'string' && body.id.trim().length > 0 ? { id: body.id } : {}),
      organizationId: principal.organizationId,
      payload: body.payload,
    });
    return { id, status: 'created' };
  }

  @Get()
  async listDrafts(@Principal() principal: CurrentPrincipal): Promise<{ items: readonly unknown[] }> {
    const items = await this.scenarios.listDrafts(principal);
    return { items };
  }

  @Get(':id')
  async getDraft(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    const draft = await this.scenarios.getDraftForOrganization(principal, id);
    if (draft === undefined) {
      throw new Error('SCENARIO_DRAFT_NOT_FOUND');
    }
    return draft;
  }

  @Patch(':id')
  async updateDraft(@Principal() principal: CurrentPrincipal, @Param('id') id: string, @Body() body: UpdateScenarioDraftBody): Promise<{ status: 'updated' }> {
    await this.scenarios.updateDraft(principal, id, principal.organizationId, body);
    return { status: 'updated' };
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  async validateDraft(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<{ valid: boolean; reason?: string }> {
    const result = await this.scenarios.validateDraft(principal, id);
    return {
      valid: result.valid,
      ...(result.valid ? {} : { reason: result.errors.map((e) => `${e.path}: ${e.reason}`).join('; ') }),
    };
  }

  /** 发布前校验：知识与评分至少各有一项 + 人设来源完整（spec §6.3）。 */
  @Post(':id/publish-preview')
  @HttpCode(HttpStatus.OK)
  async publishPreview(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<{ valid: boolean; reason?: string }> {
    const result = await this.scenarios.validateDraftForRelease(principal, id);
    return {
      valid: result.valid,
      ...(result.valid ? {} : { reason: result.errors.map((e) => `${e.path}: ${e.reason}`).join('; ') }),
    };
  }

  /** 升级场景绑定的模板到最新 revision（spec §6.3）。 */
  @Post(':id/upgrade-template')
  @HttpCode(HttpStatus.OK)
  async upgradeTemplate(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<{ status: 'upgraded' | 'noop' }> {
    const { updated } = await this.scenarios.upgradeDraftToLatestRevision(principal, id);
    return { status: updated ? 'upgraded' : 'noop' };
  }

  @Post(':id/publish')
  async publishDraft(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<{ status: 'published' }> {
    await this.scenarios.publishDraft(principal, id);
    return { status: 'published' };
  }
}
