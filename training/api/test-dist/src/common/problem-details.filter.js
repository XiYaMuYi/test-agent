var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { isKnownErrorCode } from '@training/contracts';
import { OrchestratorError } from '../ai/agent-orchestrator.js';
import { isFakeKnowledgeNotFoundError } from '../adapters/fake-knowledge.adapter.js';
import { getUserFacingMessage } from './error-messages.js';
/** Generic Chinese fallback so an unmapped error never leaks an internal string. */
const GENERIC_USER_MESSAGE = '操作未能完成，请稍后重试。';
function userMessageFor(code) {
    return getUserFacingMessage(code) ?? GENERIC_USER_MESSAGE;
}
function mapErrorMessageToStatus(message) {
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
let ProblemDetailsFilter = class ProblemDetailsFilter {
    catch(exception, host) {
        const response = host.switchToHttp().getResponse();
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
        if (isFakeKnowledgeNotFoundError(exception)) {
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
};
ProblemDetailsFilter = __decorate([
    Catch(Error)
], ProblemDetailsFilter);
export { ProblemDetailsFilter };
