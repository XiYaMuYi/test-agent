export class TestcontainersUnavailableError extends Error {
    constructor(cause) {
        super('Testcontainers PostgreSQL is unavailable. Install it with "pnpm add -D testcontainers --filter @training/api" and ensure Docker Desktop is running with PostgreSQL images available.', { cause });
        this.name = 'TestcontainersUnavailableError';
    }
}
/**
 * Boundary for integration tests. The default loader is intentionally dynamic so
 * unit tests do not require Docker or the testcontainers package to be installed.
 */
export function createPostgresTestSupport(options = {}) {
    const loadContainerFactory = options.loadContainerFactory ?? loadDefaultContainerFactory;
    return {
        async start() {
            let factory;
            try {
                factory = await loadContainerFactory();
            }
            catch (error) {
                throw new TestcontainersUnavailableError(error);
            }
            let container;
            try {
                container = await factory.start();
            }
            catch (error) {
                throw new TestcontainersUnavailableError(error);
            }
            let stopped = false;
            return {
                connectionUri: container.getConnectionUri(),
                async stop() {
                    if (stopped)
                        return;
                    stopped = true;
                    await container.stop();
                },
            };
        },
    };
}
async function loadDefaultContainerFactory() {
    try {
        const dynamicImport = Function('specifier', 'return import(specifier);');
        const testcontainers = await dynamicImport('@testcontainers/postgresql');
        const container = new testcontainers.PostgreSqlContainer('postgres:16-alpine');
        return { start: () => container.start() };
    }
    catch (error) {
        throw new TestcontainersUnavailableError(error);
    }
}
