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

export interface ModelConfig {
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelName: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  readonly maxRetries: number;
}

/**
 * Read model configuration from `process.env`.  Defaults are intentionally
 * offline-safe: the `fake` provider short-circuits to the rule-based
 * generator and never reaches the network.
 */
export function readModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const provider = env.MODEL_PROVIDER ?? 'fake';
  return {
    provider,
    baseUrl: env.MODEL_BASE_URL ?? '',
    apiKey: env.MODEL_API_KEY ?? '',
    modelName: env.MODEL_NAME ?? '',
    timeoutMs: Number(env.MODEL_TIMEOUT_MS ?? '30000'),
    // 评分需要输出包含多维度理由/证据/红线的长 JSON，默认给足 8192 防止截断。
    maxTokens: Number(env.MODEL_MAX_TOKENS ?? '8192'),
    maxRetries: Number(env.MODEL_MAX_RETRIES ?? '2'),
  };
}
