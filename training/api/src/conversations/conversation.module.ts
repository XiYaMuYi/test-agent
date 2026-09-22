import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { AiModule } from '../ai/ai.module.js';
import { AgentOrchestrator } from '../ai/agent-orchestrator.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';

@Module({
  imports: [IdentityModule, AiModule],
  controllers: [ConversationController],
  providers: [
    {
      provide: Pool,
      useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }),
    },
    {
      provide: ConversationService,
      useFactory: (database: Pool, orchestrator: AgentOrchestrator) => new ConversationService(database, orchestrator),
      inject: [Pool, AgentOrchestrator],
    },
  ],
  exports: [ConversationService],
})
export class ConversationModule {}