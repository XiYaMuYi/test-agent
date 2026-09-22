import { Module, type DynamicModule } from '@nestjs/common';
import process from 'node:process';

export interface DatabaseConfiguration {
  readonly connectionString: string;
}

export const DATABASE_CONFIGURATION = Symbol('DATABASE_CONFIGURATION');

/** Reads only local configuration; opening connections remains an explicit runtime operation. */
export function readDatabaseConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DatabaseConfiguration {
  const connectionString = environment.DATABASE_URL?.trim();
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required for database commands.');
  }
  return { connectionString };
}

@Module({})
export class DatabaseModule {
  static forRoot(configuration: DatabaseConfiguration): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: DATABASE_CONFIGURATION, useValue: configuration }],
      exports: [DATABASE_CONFIGURATION],
    };
  }
}
