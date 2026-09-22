import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import { RbacGuard } from '../identity/rbac.guard.js';
import {
  AssignmentService,
  type AssignmentStatus,
  type AssignmentStatusFilter,
  type CreateAssignmentInput,
  normalizeOverridePatchV1,
} from './assignment.service.js';
import { AssignmentProblem } from './eligibility.service.js';
import { SessionService } from '../sessions/session.service.js';

@Controller()
export class AssignmentController {
  private readonly assignments: AssignmentService;
  private readonly sessions: SessionService;

  public constructor(assignments: AssignmentService, sessions: SessionService) {
    this.assignments = assignments;
    this.sessions = sessions;
  }

  @Post('admin/assignments/preview')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async previewTargets(@Principal() principal: CurrentPrincipal, @Body() body: { readonly targetPrincipalIds: readonly string[] }): Promise<{ readonly learnerIds: readonly string[] }> {
    return this.assignments.previewTargets(principal, readTargetPrincipalIds(body));
  }

  @Post('admin/assignments')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async createAssignment(@Principal() principal: CurrentPrincipal, @Body() body: CreateAssignmentInput): Promise<{ readonly assignmentId: string }> {
    return this.assignments.createAssignment(principal, readCreateAssignmentInput(body));
  }

  @Get('admin/assignments')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async listAssignments(
    @Principal() principal: CurrentPrincipal,
    @Query('status') status?: string,
  ): Promise<{ readonly items: readonly unknown[] }> {
    return this.assignments.listAssignments(principal, readStatusFilter(status));
  }

  @Get('admin/assignments/:id')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  async getAssignment(@Principal() principal: CurrentPrincipal, @Param('id') id: string): Promise<unknown> {
    return this.assignments.getAssignmentDetail(principal, id);
  }

  @Post('admin/assignments/:id/status')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async changeStatus(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.assignments.transitionStatus(principal, id, readStatusTarget(body));
  }

  /** 更新任务级参数覆盖（任务可编辑；只影响之后新开的会话）。 */
  @Patch('admin/assignments/:id/override')
  @UseGuards(PrincipalGuard, RbacGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async updateOverride(
    @Principal() principal: CurrentPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.assignments.updateAssignmentOverride(principal, id, readOverridePatch(body));
  }

  @Get('me/assignments')
  @UseGuards(PrincipalGuard)
  async listMyAssignments(@Principal() principal: CurrentPrincipal): Promise<{ readonly items: readonly Record<string, unknown>[] }> {
    return this.assignments.listMyAssignments(principal);
  }

  @Post('me/assignments/:id/attempts')
  @UseGuards(PrincipalGuard)
  async startAttempt(
    @Principal() principal: CurrentPrincipal,
    @Param('id') assignmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<{ readonly attemptId: string; readonly conversationId: string }> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new AssignmentProblem('IDEMPOTENCY_KEY_REQUIRED', HttpStatus.BAD_REQUEST, 'Idempotency-Key is required to start an attempt.');
    }
    const started = await this.sessions.startAssignedSession(principal, assignmentId, idempotencyKey);
    return { attemptId: started.attemptId, conversationId: started.conversationId };
  }
}

function readTargetPrincipalIds(body: unknown): readonly string[] {
  if (typeof body !== 'object' || body === null || !('targetPrincipalIds' in body) || !Array.isArray(body.targetPrincipalIds)
    || body.targetPrincipalIds.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'targetPrincipalIds must contain non-empty principal identifiers.');
  }
  return body.targetPrincipalIds;
}

function readCreateAssignmentInput(body: unknown): CreateAssignmentInput {
  if (typeof body !== 'object' || body === null) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'An assignment payload is required.');
  }
  const candidate = body as Partial<CreateAssignmentInput>;
  const validStatus = candidate.status === 'draft' || candidate.status === 'active' || candidate.status === 'paused' || candidate.status === 'ended';
  const startsAt = typeof candidate.startsAt === 'string' ? new Date(candidate.startsAt) : undefined;
  const endsAt = typeof candidate.endsAt === 'string' ? new Date(candidate.endsAt) : undefined;
  if ((candidate.id !== undefined && (typeof candidate.id !== 'string' || candidate.id.trim().length === 0))
    || typeof candidate.releaseSnapshotId !== 'string' || typeof candidate.name !== 'string'
    || candidate.name.trim().length === 0 || !validStatus || !Number.isInteger(candidate.maxAttempts) || (candidate.maxAttempts ?? 0) <= 0
    || startsAt === undefined || endsAt === undefined || Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf()) || endsAt <= startsAt) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'The assignment payload has invalid fields.');
  }
  const input: CreateAssignmentInput = {
    releaseSnapshotId: candidate.releaseSnapshotId!,
    name: candidate.name!,
    status: candidate.status!,
    startsAt: candidate.startsAt!,
    endsAt: candidate.endsAt!,
    maxAttempts: candidate.maxAttempts!,
    targetPrincipalIds: readTargetPrincipalIds(candidate),
    overridePatch: normalizeOverridePatchV1(candidate.overridePatch),
    scoringTemplateId: candidate.scoringTemplateId === undefined ? null : (candidate.scoringTemplateId ?? null),
  };
  return candidate.id === undefined ? input : { ...input, id: candidate.id };
}

/** 更新覆盖的 body：{ overridePatch?: object | null }；null/缺省=清空覆盖。 */
function readOverridePatch(body: unknown): ReturnType<typeof normalizeOverridePatchV1> {
  if (typeof body !== 'object' || body === null) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'An override payload is required.');
  }
  const candidate = (body as { overridePatch?: unknown }).overridePatch;
  return normalizeOverridePatchV1(candidate);
}

const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = ['draft', 'active', 'paused', 'ended'];

function readStatusFilter(status: string | undefined): AssignmentStatusFilter {
  if (status === undefined || status === '') return 'all';
  if (status === 'all' || (ASSIGNMENT_STATUSES as readonly string[]).includes(status)) {
    return status as AssignmentStatusFilter;
  }
  throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'status must be draft, active, paused, ended or all.');
}

function readStatusTarget(body: unknown): AssignmentStatus {
  if (typeof body !== 'object' || body === null) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A status payload is required.');
  }
  const status = (body as { status?: unknown }).status;
  if (typeof status !== 'string' || !(ASSIGNMENT_STATUSES as readonly string[]).includes(status)) {
    throw new AssignmentProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'status must be draft, active, paused or ended.');
  }
  return status as AssignmentStatus;
}
