import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [KnowledgeController],
  providers: [
    { provide: Pool, useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }) },
    {
      provide: KnowledgeService,
      useFactory: (database: Pool): KnowledgeService => new KnowledgeService(database),
      inject: [Pool],
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
