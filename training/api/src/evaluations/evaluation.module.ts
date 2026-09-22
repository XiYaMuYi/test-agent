import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationService } from './evaluation.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [EvaluationController],
  providers: [
    { provide: Pool, useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }) },
    { provide: EvaluationService, useFactory: (database: Pool) => new EvaluationService(database), inject: [Pool] },
  ],
})
export class EvaluationModule {}
