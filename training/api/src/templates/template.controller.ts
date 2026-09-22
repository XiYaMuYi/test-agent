import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import type { AdminTemplateStatusFilter, CreateTemplateInput, TemplateScope, UpdateOrganizationTemplateInput } from './template.service.js';
import { TemplateService } from './template.service.js';

const SCOPES: readonly TemplateScope[] = ['platform', 'organization', 'personal'];

class TemplateProblem extends HttpException {
  public constructor(code: string, status: HttpStatus, detail: string) {
    super({
      type: `https://errors.shenshou-princess.local/${code}`,
      title: code,
      status,
      code,
      detail,
    }, status);
  }
}

function readCreateTemplateBody(body: unknown): CreateTemplateInput {
  if (typeof body !== 'object' || body === null) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A template payload is required.');
  }
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A non-empty title is required.');
  }
  if (typeof candidate.personaConfig !== 'object' || candidate.personaConfig === null) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A personaConfig object is required.');
  }
  return {
    title: candidate.title,
    personaConfig: candidate.personaConfig,
    ...(Array.isArray(candidate.knowledgeVersions) ? { knowledgeVersions: candidate.knowledgeVersions } : {}),
    ...(Array.isArray(candidate.scoringRules) ? { scoringRules: candidate.scoringRules } : {}),
    ...(typeof candidate.agentConfig === 'object' && candidate.agentConfig !== null ? { agentConfig: candidate.agentConfig as Record<string, unknown> } : {}),
  };
}

function readScope(scope: string | undefined): TemplateScope | undefined {
  if (scope === undefined || scope === '') return undefined;
  if (!(SCOPES as readonly string[]).includes(scope)) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'scope must be platform, organization or personal.');
  }
  return scope as TemplateScope;
}

@Controller()
export class TemplateController {
  public constructor(private readonly templates: TemplateService) {}

  @Get('me/templates')
  @UseGuards(PrincipalGuard)
  async listVisible(
    @Principal() principal: CurrentPrincipal,
    @Query('scope') scope?: string,
    @Query('productScenario') productScenario?: string,
  ): Promise<{ readonly items: readonly unknown[] }> {
    const resolvedScope = readScope(scope);
    const items = await this.templates.listVisibleTemplates(principal, {
      ...(resolvedScope === undefined ? {} : { scope: resolvedScope }),
      ...(productScenario === undefined || productScenario === '' ? {} : { productScenario }),
    });
    return { items };
  }

  @Get(['me/persona-templates', 'training/persona-templates'])
  @UseGuards(PrincipalGuard)
  async listMine(@Principal() principal: CurrentPrincipal): Promise<{ readonly items: readonly unknown[] }> {
    const items = await this.templates.listVisibleTemplates(principal, { scope: 'personal' });
    return { items };
  }

  @Post(['me/persona-templates', 'training/persona-templates'])
  @UseGuards(PrincipalGuard)
  async savePersonal(@Principal() principal: CurrentPrincipal, @Body() body: unknown): Promise<unknown> {
    return this.templates.createPersonalTemplate(principal, readCreateTemplateBody(body));
  }

  @Get('admin/templates')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async listOrganization(
    @Principal() principal: CurrentPrincipal,
    @Query('status') status?: string,
  ): Promise<{ readonly items: readonly unknown[] }> {
    const items = await this.templates.listOrganizationTemplates(principal, readStatusFilter(status));
    return { items };
  }

  @Post('admin/templates')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async createOrganization(@Principal() principal: CurrentPrincipal, @Body() body: unknown): Promise<unknown> {
    return this.templates.createOrganizationTemplate(principal, readCreateTemplateBody(body));
  }

  @Patch('admin/templates/:id')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async updateOrganization(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.templates.updateOrganizationTemplate(principal, id, readUpdateTemplateBody(body));
  }

  @Post('admin/templates/:id/archive')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async archiveOrganization(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    return this.templates.setOrganizationTemplateStatus(principal, id, 'archived');
  }

  @Post('admin/templates/:id/activate')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async activateOrganization(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    return this.templates.setOrganizationTemplateStatus(principal, id, 'active');
  }

  @Post('admin/templates/:id/duplicate')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async duplicateOrganization(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    return this.templates.duplicateOrganizationTemplate(principal, id);
  }

  @Get('admin/templates/:id/revisions')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async listRevisions(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<{ readonly items: readonly unknown[] }> {
    const items = await this.templates.listTemplateRevisions(principal, id);
    return { items };
  }

  @Get('admin/templates/:id/bindings')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async listBindings(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<{ readonly items: readonly unknown[] }> {
    const items = await this.templates.listTemplateScenarioBindings(principal, id);
    return { items };
  }

  @Get('admin/templates/:id/diff')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async diffRevisions(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<{ readonly items: readonly unknown[] }> {
    const fromRevision = Number.parseInt(from, 10);
    const toRevision = Number.parseInt(to, 10);
    if (!Number.isInteger(fromRevision) || !Number.isInteger(toRevision) || fromRevision < 1 || toRevision < 1) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'from and to must be positive revision numbers.');
    }
    if (fromRevision >= toRevision) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'from must be lower than to.');
    }
    const items = await this.templates.diffTemplateRevisions(principal, id, fromRevision, toRevision);
    return { items };
  }
}

const ADMIN_STATUS_FILTERS: readonly AdminTemplateStatusFilter[] = ['active', 'archived', 'all'];

function readStatusFilter(status: string | undefined): AdminTemplateStatusFilter {
  if (status === undefined || status === '') return 'active';
  if (!(ADMIN_STATUS_FILTERS as readonly string[]).includes(status)) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'status must be active, archived or all.');
  }
  return status as AdminTemplateStatusFilter;
}

function readUpdateTemplateBody(body: unknown): UpdateOrganizationTemplateInput {
  if (typeof body !== 'object' || body === null) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A template patch payload is required.');
  }
  const candidate = body as Record<string, unknown>;
  const patch: {
    title?: string;
    personaConfig?: unknown;
    agentConfig?: Record<string, unknown>;
    learnerOverridePolicy?: unknown;
    knowledgeVersions?: readonly unknown[];
    scoringRules?: readonly unknown[];
    recommendedScoringTemplateIds?: readonly string[];
  } = {};
  let touched = 0;
  if (candidate.title !== undefined) {
    if (typeof candidate.title !== 'string' || candidate.title.trim().length === 0) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'title must be a non-empty string.');
    }
    patch.title = candidate.title;
    touched += 1;
  }
  if (candidate.personaConfig !== undefined) {
    if (typeof candidate.personaConfig !== 'object' || candidate.personaConfig === null) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'personaConfig must be an object.');
    }
    patch.personaConfig = candidate.personaConfig;
    touched += 1;
  }
  if (candidate.agentConfig !== undefined) {
    if (typeof candidate.agentConfig !== 'object' || candidate.agentConfig === null) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'agentConfig must be an object.');
    }
    patch.agentConfig = candidate.agentConfig as Record<string, unknown>;
    touched += 1;
  }
  if (candidate.learnerOverridePolicy !== undefined) {
    if (typeof candidate.learnerOverridePolicy !== 'object' || candidate.learnerOverridePolicy === null) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'learnerOverridePolicy must be an object.');
    }
    patch.learnerOverridePolicy = candidate.learnerOverridePolicy;
    touched += 1;
  }
  if (candidate.knowledgeVersions !== undefined) {
    if (!Array.isArray(candidate.knowledgeVersions)) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'knowledgeVersions must be an array.');
    }
    patch.knowledgeVersions = candidate.knowledgeVersions;
    touched += 1;
  }
  if (candidate.scoringRules !== undefined) {
    if (!Array.isArray(candidate.scoringRules)) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'scoringRules must be an array.');
    }
    patch.scoringRules = candidate.scoringRules;
    touched += 1;
  }
  if (candidate.recommendedScoringTemplateIds !== undefined) {
    if (!Array.isArray(candidate.recommendedScoringTemplateIds) || !candidate.recommendedScoringTemplateIds.every((x) => typeof x === 'string')) {
      throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'recommendedScoringTemplateIds must be a string array.');
    }
    patch.recommendedScoringTemplateIds = candidate.recommendedScoringTemplateIds;
    touched += 1;
  }
  if (touched === 0) {
    throw new TemplateProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'At least one editable field is required.');
  }
  return patch;
}
