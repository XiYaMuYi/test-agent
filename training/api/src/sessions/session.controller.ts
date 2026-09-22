import { Body, Controller, Headers, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { Principal } from '../common/decorators/principal.decorator.js';
import type { CurrentPrincipal } from '../identity/identity-context.js';
import { PrincipalGuard } from '../identity/principal.guard.js';
import type { BuildPersonaInput } from '../persona/persona.service.js';
import { SessionService, type StartFreeSessionInput } from './session.service.js';

export class SessionProblem extends HttpException {
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

const DIFFICULTIES = [1, 2, 3, 4];

function isPersonaInput(value: unknown): value is BuildPersonaInput {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const hasAgeCard = typeof candidate.ageCardId === 'string' && candidate.ageCardId.length > 0;
  const hasCohort = typeof candidate.customerCohort === 'string' && candidate.customerCohort.length > 0;
  return (hasAgeCard || hasCohort)
    && typeof candidate.productScenarioId === 'string'
    && typeof candidate.difficulty === 'number'
    && DIFFICULTIES.includes(candidate.difficulty as number)
    && (candidate.psychologyCardIds === undefined || Array.isArray(candidate.psychologyCardIds));
}

function readFreeBody(body: unknown): StartFreeSessionInput {
  if (typeof body !== 'object' || body === null) {
    throw new SessionProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'A free-session payload is required.');
  }
  const candidate = body as Record<string, unknown>;
  const hasPersona = isPersonaInput(candidate.persona);
  const hasTemplate = typeof candidate.templateId === 'string' && candidate.templateId.trim().length > 0;
  if (!hasPersona && !hasTemplate) {
    throw new SessionProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'Provide either a valid persona selection or a visible templateId.');
  }
  const mode = candidate.mode;
  if (mode !== undefined && mode !== 'practice' && mode !== 'exam') {
    throw new SessionProblem('SCHEMA_INVALID', HttpStatus.BAD_REQUEST, 'mode must be practice or exam.');
  }
  return {
    ...(hasPersona ? { persona: candidate.persona as BuildPersonaInput } : {}),
    ...(hasTemplate ? { templateId: candidate.templateId as string } : {}),
    ...(mode === 'practice' || mode === 'exam' ? { mode } : {}),
  };
}

@Controller(['me/sessions', 'training/sessions'])
export class SessionController {
  public constructor(private readonly sessions: SessionService) {}

  @Post('free')
  @UseGuards(PrincipalGuard)
  async startFreeSession(
    @Principal() principal: CurrentPrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<unknown> {
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new SessionProblem('IDEMPOTENCY_KEY_REQUIRED', HttpStatus.BAD_REQUEST, 'Idempotency-Key is required to start a free session.');
    }
    return this.sessions.startFreeSession(principal, readFreeBody(body), idempotencyKey);
  }
}
