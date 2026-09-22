export interface StartedPostgresContainer {
  getConnectionUri(): string;
  stop(): Promise<void>;
}

export interface PostgresContainerFactory {
  start(): Promise<StartedPostgresContainer>;
}

export interface StartedPostgresTestSupport {
  connectionUri: string;
  stop(): Promise<void>;
}

export class TestcontainersUnavailableError extends Error {
  public constructor(cause?: unknown) {
    super(
      'Testcontainers PostgreSQL is unavailable. Install it with "pnpm add -D testcontainers --filter @training/api" and ensure Docker Desktop is running with PostgreSQL images available.',
      { cause },
    );
    this.name = 'TestcontainersUnavailableError';
  }
}

export interface PostgresTestSupportOptions {
  loadContainerFactory?: () => Promise<PostgresContainerFactory>;
}

/**
 * Boundary for integration tests. The default loader is intentionally dynamic so
 * unit tests do not require Docker or the testcontainers package to be installed.
 */
export function createPostgresTestSupport(
  options: PostgresTestSupportOptions = {},
): { start(): Promise<StartedPostgresTestSupport> } {
  const loadContainerFactory = options.loadContainerFactory ?? loadDefaultContainerFactory;

  return {
    async start(): Promise<StartedPostgresTestSupport> {
      let factory: PostgresContainerFactory;
      try {
        factory = await loadContainerFactory();
      } catch (error) {
        throw new TestcontainersUnavailableError(error);
      }

      let container: StartedPostgresContainer;
      try {
        container = await factory.start();
      } catch (error) {
        throw new TestcontainersUnavailableError(error);
      }

      let stopped = false;
      return {
        connectionUri: container.getConnectionUri(),
        async stop(): Promise<void> {
          if (stopped) return;
          stopped = true;
          await container.stop();
        },
      };
    },
  };
}

async function loadDefaultContainerFactory(): Promise<PostgresContainerFactory> {
  try {
    const dynamicImport = Function('specifier', 'return import(specifier);') as (
      specifier: string,
    ) => Promise<{ PostgreSqlContainer: new (image?: string) => { start(): Promise<StartedPostgresContainer> } }>;
    const testcontainers = await dynamicImport('@testcontainers/postgresql');
    const container = new testcontainers.PostgreSqlContainer('postgres:16-alpine');
    return { start: () => container.start() };
  } catch (error) {
    throw new TestcontainersUnavailableError(error);
  }
}
