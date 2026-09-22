var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module, RequestMethod } from '@nestjs/common';
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
let AppModule = class AppModule {
    configure(consumer) {
        consumer.apply(TraceMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
    }
};
AppModule = __decorate([
    Module({
        controllers: [HealthController],
        imports: [IdentityModule, ScenarioModule, AssignmentModule, ConversationModule, EvaluationModule, PersonaModule, SessionModule, TemplateModule, LearnerModule],
        providers: [{ provide: APP_FILTER, useClass: OrganizationScopeForbiddenFilter }, { provide: APP_FILTER, useClass: ProblemDetailsFilter }],
    })
], AppModule);
export { AppModule };
