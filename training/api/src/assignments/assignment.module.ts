import { Module } from '@nestjs/common';
import process from 'node:process';
import { Pool } from 'pg';

import { IdentityModule } from '../identity/identity.module.js';
import { SessionModule } from '../sessions/session.module.js';
import { AssignmentController } from './assignment.controller.js';
import { AssignmentService } from './assignment.service.js';

const databasePoolProvider = {
  provide: Pool,
  useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }),
};

@Module({
  imports: [IdentityModule, SessionModule],
  controllers: [AssignmentController],
  providers: [
    databasePoolProvider,
    {
      provide: AssignmentService,
      useFactory: (database: Pool): AssignmentService => new AssignmentService(database),
      inject: [Pool],
    },
  ],
})
export class AssignmentModule {}
