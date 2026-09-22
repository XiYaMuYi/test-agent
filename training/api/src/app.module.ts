import { Module, RequestMethod, type MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { OrganizationScopeForbiddenFilter } from './common/organization-scope-forbidden.filter.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { TraceMiddleware } from './common/trace.middleware.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { AssignmentModule } from './assignments/assignment.module.js';
import { ScenarioModule } from './scenarios/scenario.module.js';
import { ConversationModule } from './conversations/conversation.module.js';
import { EvaluationModule } from './evaluations/evaluation.module.js';
import { PersonaModule } from './persona/persona.module.js';
import { SessionModule } from './sessions/session.module.js';
import { TemplateModule } from './templates/template.module.js';
import { LearnerModule } from './learners/learner.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { ScoringModule } from './scoring/scoring.module.js';

@Module({
  controllers: [HealthController],
  imports: [IdentityModule, ScenarioModule, AssignmentModule, ConversationModule, EvaluationModule, PersonaModule, SessionModule, TemplateModule, LearnerModule, KnowledgeModule, ScoringModule],
  providers: [{ provide: APP_FILTER, useClass: OrganizationScopeForbiddenFilter }, { provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
