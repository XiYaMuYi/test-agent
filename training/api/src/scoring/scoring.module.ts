import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { ScoringConfigController } from './scoring-config.controller.js';
import { ScoringConfigService } from './scoring-config.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [ScoringConfigController],
  providers: [
    { provide: Pool, useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }) },
    {
      provide: ScoringConfigService,
      useFactory: (database: Pool): ScoringConfigService => new ScoringConfigService(database),
      inject: [Pool],
    },
  ],
  exports: [ScoringConfigService],
})
export class ScoringModule {}
