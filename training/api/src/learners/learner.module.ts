import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { LearnerController } from './learner.controller.js';
import { LearnerService } from './learner.service.js';

const databasePoolProvider = {
  provide: Pool,
  useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }),
};

@Module({
  imports: [IdentityModule],
  controllers: [LearnerController],
  providers: [
    databasePoolProvider,
    {
      provide: LearnerService,
      useFactory: (database: Pool) => new LearnerService(database),
      inject: [Pool],
    },
  ],
  exports: [LearnerService],
})
export class LearnerModule {}
