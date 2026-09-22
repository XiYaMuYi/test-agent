import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { TemplateModule } from '../templates/template.module.js';
import { TemplateService } from '../templates/template.service.js';
import { ReleaseSnapshotController } from './release-snapshot.controller.js';
import { ScenarioController } from './scenario.controller.js';
import { ScenarioService } from './scenario.service.js';

const databasePoolProvider = {
  provide: Pool,
  useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }),
};

@Module({
  imports: [IdentityModule, TemplateModule],
  controllers: [ScenarioController, ReleaseSnapshotController],
  providers: [
    databasePoolProvider,
    {
      provide: ScenarioService,
      useFactory: (database: Pool, templates: TemplateService) => new ScenarioService(database, templates),
      inject: [Pool, TemplateService],
    },
  ],
  exports: [ScenarioService],
})
export class ScenarioModule {}
