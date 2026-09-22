import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { isKnownErrorCode } from '@training/contracts';
import { OrchestratorError } from '../ai/agent-orchestrator.js';
import { isDatabaseKnowledgeNotFoundError } from '../adapters/database-knowledge.adapter.js';
import { isFakeKnowledgeNotFoundError } from '../adapters/fake-knowledge.adapter.js';
import { getUserFacingMessage } from './error-messages.js';

/** Generic Chinese fallback so an unmapped error never leaks an internal string. */
const GENERIC_USER_MESSAGE = '操作未能完成，请稍后重试。';

function userMessageFor(code: string): string {
  return getUserFacingMessage(code) ?? GENERIC_USER_MESSAGE;
}

function mapErrorMessageToStatus(message: string): number {
  switch (message) {
    case 'MESSAGE_IDEMPOTENCY_CONFLICT':
    case 'MESSAGE_SEQUENCE_CONFLICT':
    case 'CONVERSATION_CLOSED':
    case 'SESSION_ALREADY_ACTIVE':
    case 'TEMPLATE_TITLE_CONFLICT':
      return HttpStatus.CONFLICT;
    case 'CONVERSATION_NOT_FOUND':
    case 'EVALUATION_NOT_FOUND':
    case 'TEMPLATE_NOT_FOUND':
    case 'SCENARIO_DRAFT_NOT_FOUND':
    case 'LEARNER_PROFILE_NOT_FOUND':
    case 'FREE_SESSION_TEMPLATE_UNAVAILABLE':
      return HttpStatus.NOT_FOUND;
    case 'ORG_SCOPE_FORBIDDEN':
      return HttpStatus.FORBIDDEN;
    case 'KNOWLEDGE_NOT_AVAILABLE':
    case 'MODEL_SCHEMA_INVALID':
    case 'PERSONA_PRESET_NOT_FOUND':
    case 'PERSONA_CONFIG_INVALID':
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case 'MODEL_TIMEOUT':
      return HttpStatus.REQUEST_TIMEOUT;
    case 'MODEL_UPSTREAM_UNAVAILABLE':
      return HttpStatus.BAD_GATEWAY;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

@Catch(Error)
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        response.status(status).json(exceptionResponse);
        return;
      }
    }

    if (exception instanceof OrchestratorError) {
      const status = mapErrorMessageToStatus(exception.code);
      const userMessage = userMessageFor(exception.code);
      response.status(status).json({
        type: `https://errors.shenshou-princess.local/${exception.code}`,
        title: userMessage,
        status,
        code: exception.code,
        detail: userMessage,
      });
      return;
    }

    if (isFakeKnowledgeNotFoundError(exception) || isDatabaseKnowledgeNotFoundError(exception)) {
      const status = HttpStatus.UNPROCESSABLE_ENTITY;
      const code = 'KNOWLEDGE_NOT_AVAILABLE';
      const userMessage = userMessageFor(code);
      response.status(status).json({
        type: `https://errors.shenshou-princess.local/${code}`,
        title: userMessage,
        status,
        code,
        detail: userMessage,
      });
      return;
    }

    console.error('[ProblemDetailsFilter] Unhandled error:', exception.message, exception.stack);
    const status = mapErrorMessageToStatus(exception.message);
    const code = isKnownErrorCode(exception.message) ? exception.message : 'INVALID_TOKEN';
    const userMessage = userMessageFor(code);
    response.status(status).json({
      type: `https://errors.shenshou-princess.local/${code}`,
      title: userMessage,
      status,
      code,
      detail: userMessage,
    });
  }
}
