import { Controller, Get, HttpException, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import { LearnerService, type LearnerListQuery } from './learner.service.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function invalidPagination(detail: string): HttpException {
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

function readPagination(limitRaw: string | undefined, offsetRaw: string | undefined): Pick<LearnerListQuery, 'limit' | 'offset'> {
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined && limitRaw !== '') {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      throw invalidPagination(`limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }
    limit = parsed;
  }
  let offset = 0;
  if (offsetRaw !== undefined && offsetRaw !== '') {
    const parsed = Number(offsetRaw);
    if (!Number.isInteger(parsed) || parsed < 0) throw invalidPagination('offset must be a non-negative integer.');
    offset = parsed;
  }
  return { limit, offset };
}

@Controller('admin/learners')
@UseGuards(PrincipalGuard, RbacGuard)
@Roles('admin')
export class LearnerController {
  public constructor(private readonly learners: LearnerService) {}

  @Get()
  async list(
    @Principal() principal: CurrentPrincipal,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<unknown> {
    const pagination = readPagination(limit, offset);
    return this.learners.listLearners(principal, {
      ...pagination,
      ...(typeof q === 'string' && q.trim().length > 0 ? { q: q.trim() } : {}),
    });
  }

  @Get(':id')
  async detail(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    return this.learners.getLearnerDetail(principal, id);
  }
}
