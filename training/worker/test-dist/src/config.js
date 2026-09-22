/**
 * Worker configuration — sourced from environment variables.
 *
 * The worker shares model configuration with the API.  In production both
 * services receive the same env vars via their orchestrator; locally the
 * worker is launched with `--env-file=../api/.env` so a single file is the
 * source of truth.
 *
 * Every accessor falls back to an offline-safe default so the worker can
 * boot (and tests can run) without any .env file present.
 */
/**
 * Read model configuration from `process.env`.  Defaults are intentionally
 * offline-safe: the `fake` provider short-circuits to the rule-based
 * generator and never reaches the network.
 */
export function readModelConfig(env = process.env) {
    const provider = env.MODEL_PROVIDER ?? 'fake';
    return {
        provider,
        baseUrl: env.MODEL_BASE_URL ?? '',
        apiKey: env.MODEL_API_KEY ?? '',
        modelName: env.MODEL_NAME ?? '',
        timeoutMs: Number(env.MODEL_TIMEOUT_MS ?? '30000'),
    };
}
