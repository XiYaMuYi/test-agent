import type { HttpModelConfiguration } from '@training/contracts';
import type { ExternalKnowledgeConfiguration } from './external-knowledge.adapter.js';
import type { WeknoraKnowledgeConfiguration } from './weknora-knowledge.adapter.js';
import type { PythonAiConfiguration } from './python-ai.adapter.js';

export type ModelProviderKind = 'fake' | 'http' | 'python';
export type KnowledgeProviderKind = 'fake' | 'external' | 'weknora' | 'database';

export interface AiProviderConfiguration {
  readonly modelProvider: ModelProviderKind;
  readonly model: HttpModelConfiguration | undefined;
  readonly pythonAi: PythonAiConfiguration | undefined;
  readonly knowledgeProvider: KnowledgeProviderKind;
  readonly externalKnowledge: ExternalKnowledgeConfiguration | undefined;
  readonly weknoraKnowledge: WeknoraKnowledgeConfiguration | undefined;
}

const DEFAULT_MODEL_TIMEOUT_MS = 30_000;
const DEFAULT_KNOWLEDGE_TIMEOUT_MS = 10_000;

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    throw new Error(`${name} is required when the corresponding real provider is selected.`);
  }
  return trimmed;
}

function readPositiveTimeout(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds.`);
  }
  return parsed;
}

function readModelProvider(env: Readonly<Record<string, string | undefined>>): {
  readonly kind: ModelProviderKind;
  readonly model: HttpModelConfiguration | undefined;
  readonly pythonAi: PythonAiConfiguration | undefined;
} {
  const configuredKind = env.MODEL_PROVIDER?.trim();
  if ((!configuredKind || configuredKind.length === 0) && env.NODE_ENV === 'production') {
    throw new Error('MODEL_PROVIDER is required in production; use "python" for the prompt-driven simulation engine.');
  }
  const kind = (configuredKind || 'fake') as ModelProviderKind;
  if (kind !== 'fake' && kind !== 'http' && kind !== 'python') {
    throw new Error(`MODEL_PROVIDER must be "fake", "http" or "python" (got "${env.MODEL_PROVIDER}").`);
  }
  if (kind === 'fake') return { kind, model: undefined, pythonAi: undefined };
  if (kind === 'python') {
    return {
      kind,
      model: undefined,
      pythonAi: {
        baseUrl: required(env.PYTHON_AI_BASE_URL, 'PYTHON_AI_BASE_URL'),
        internalToken: required(env.PYTHON_AI_TOKEN, 'PYTHON_AI_TOKEN'),
        timeoutMs: readPositiveTimeout(env.PYTHON_AI_TIMEOUT_MS, 'PYTHON_AI_TIMEOUT_MS', DEFAULT_MODEL_TIMEOUT_MS),
      },
    };
  }
  return {
    kind,
    pythonAi: undefined,
    model: {
      baseUrl: required(env.MODEL_BASE_URL, 'MODEL_BASE_URL'),
      apiKey: required(env.MODEL_API_KEY, 'MODEL_API_KEY'),
      model: required(env.MODEL_NAME, 'MODEL_NAME'),
      timeoutMs: readPositiveTimeout(env.MODEL_TIMEOUT_MS, 'MODEL_TIMEOUT_MS', DEFAULT_MODEL_TIMEOUT_MS),
      // 推理模型默认关闭思维链以保证实时性；只有显式 MODEL_ENABLE_THINKING=true 才开启。
      enableThinking: env.MODEL_ENABLE_THINKING?.trim() === 'true',
    },
  };
}

function readKnowledgeProvider(env: Readonly<Record<string, string | undefined>>): {
  readonly kind: KnowledgeProviderKind;
  readonly externalKnowledge: ExternalKnowledgeConfiguration | undefined;
  readonly weknoraKnowledge: WeknoraKnowledgeConfiguration | undefined;
} {
  const kind = (env.KNOWLEDGE_PROVIDER?.trim() || 'fake') as KnowledgeProviderKind;
  if (kind !== 'fake' && kind !== 'external' && kind !== 'weknora' && kind !== 'database') {
    throw new Error(`KNOWLEDGE_PROVIDER must be "fake", "external", "weknora" or "database" (got "${env.KNOWLEDGE_PROVIDER}").`);
  }
  if (kind === 'fake' || kind === 'database') return { kind, externalKnowledge: undefined, weknoraKnowledge: undefined };
  if (kind === 'external') {
    const apiKey = env.EXTERNAL_KNOWLEDGE_API_KEY?.trim();
    return {
      kind,
      externalKnowledge: {
        baseUrl: required(env.EXTERNAL_KNOWLEDGE_BASE_URL, 'EXTERNAL_KNOWLEDGE_BASE_URL'),
        ...(apiKey !== undefined && apiKey.length > 0 ? { apiKey } : {}),
        timeoutMs: readPositiveTimeout(
          env.EXTERNAL_KNOWLEDGE_TIMEOUT_MS,
          'EXTERNAL_KNOWLEDGE_TIMEOUT_MS',
          DEFAULT_KNOWLEDGE_TIMEOUT_MS,
        ),
      },
      weknoraKnowledge: undefined,
    };
  }
  // kind === 'weknora'
  const baseUrl = (env.WEKNORA_API_URL ?? env.KNOWLEDGE_BASE_URL)?.trim();
  const token = (env.WEKNORA_API_KEY ?? env.KNOWLEDGE_TOKEN)?.trim();
  if (baseUrl === undefined || baseUrl.length === 0 || token === undefined || token.length === 0) {
    // Fall back silently — the caller will degrade to FakeKnowledgeAdapter
    // so that missing weknora credentials never crash the whole service.
    return { kind, externalKnowledge: undefined, weknoraKnowledge: undefined };
  }
  return {
    kind,
    externalKnowledge: undefined,
    weknoraKnowledge: {
      baseUrl,
      apiKey: token,
      knowledgeBaseIds: (env.WEKNORA_KNOWLEDGE_BASE_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean),
      timeoutMs: readPositiveTimeout(env.WEKNORA_SEARCH_TIMEOUT_MS, 'WEKNORA_SEARCH_TIMEOUT_MS', DEFAULT_KNOWLEDGE_TIMEOUT_MS),
    },
  };
}

/**
 * Reads provider selection from the local environment.
 *
 * Defaults to the offline fakes so that tests, CI and a fresh checkout run
 * without any network or secret. Selecting a real provider fails fast with a
 * precise message when its required configuration is missing.
 */
export function readAiProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AiProviderConfiguration {
  const model = readModelProvider(environment);
  const knowledge = readKnowledgeProvider(environment);
  return {
    modelProvider: model.kind,
    model: model.model,
    pythonAi: model.pythonAi,
    knowledgeProvider: knowledge.kind,
    externalKnowledge: knowledge.externalKnowledge,
    weknoraKnowledge: knowledge.weknoraKnowledge,
  };
}
