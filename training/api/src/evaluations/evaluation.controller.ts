import { Controller, Get, HttpException, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { EvaluationService } from './evaluation.service.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function invalidQuery(detail: string): HttpException {
  return new HttpException(
    {
      type: 'https://errors.shenshou-princess.local/SCHEMA_INVALID',
      title: 'SCHEMA_INVALID',
      status: HttpStatus.BAD_REQUEST,
      code: 'SCHEMA_INVALID',
      detail,
    },
    HttpStatus.BAD_REQUEST,
  );
}

function readPagination(limitRaw: string | undefined, offsetRaw: string | undefined): { limit: number; offset: number } {
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined && limitRaw !== '') {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw invalidQuery(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    limit = parsed;
  }
  let offset = 0;
  if (offsetRaw !== undefined && offsetRaw !== '') {
    const parsed = Number(offsetRaw);
    if (!Number.isInteger(parsed) || parsed < 0) throw invalidQuery('offset must be a non-negative integer.');
    offset = parsed;
  }
  return { limit, offset };
}

@Controller()
@UseGuards(PrincipalGuard, RbacGuard)
export class EvaluationController {
  private readonly evaluations: EvaluationService;

  public constructor(evaluations: EvaluationService) {
    this.evaluations = evaluations;
  }

  @Get(['me/evaluations/:conversationId', 'training/evaluations/:conversationId'])
  @Roles('admin', 'streamer')
  async getMine(@Principal() principal: CurrentPrincipal, @Param('conversationId') conversationId: string): Promise<unknown> {
    const report = await this.evaluations.getForLearner(principal, conversationId);
    if (report !== undefined) return report;
    const pending = await this.evaluations.getPendingStatusForLearner(principal, conversationId);
    if (pending !== undefined) return { status: pending };
    throw new Error('EVALUATION_NOT_FOUND');
  }

  @Get('admin/evaluations')
  @Roles('admin')
  async listForOrganization(
    @Principal() principal: CurrentPrincipal,
    @Query('source') source?: string,
    @Query('learnerId') learnerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<unknown> {
    const pagination = readPagination(limit, offset);
    let normalizedSource: 'free' | 'assigned' | undefined;
    if (source !== undefined && source !== '') {
      if (source !== 'free' && source !== 'assigned') throw invalidQuery('source must be either free or assigned.');
      normalizedSource = source;
    }
    return this.evaluations.listAdminEvaluations(principal, {
      ...pagination,
      ...(normalizedSource !== undefined ? { source: normalizedSource } : {}),
      ...(typeof learnerId === 'string' && learnerId.trim().length > 0 ? { learnerId: learnerId.trim() } : {}),
    });
  }

  @Get('admin/conversations/:id')
  @Roles('admin')
  replay(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    return this.evaluations.getConversationReplay(principal, id);
  }
}
