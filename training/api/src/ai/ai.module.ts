import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import process from 'node:process';

import type { KnowledgeProviderPort, ModelProviderPort } from '@training/contracts';
import { HttpModelAdapter, defaultHttpFetch } from '@training/contracts';

import { DatabaseKnowledgeAdapter } from '../adapters/database-knowledge.adapter.js';
import { ExternalHttpKnowledgeAdapter, defaultKnowledgeHttpFetch } from '../adapters/external-knowledge.adapter.js';
import { FakeKnowledgeAdapter } from '../adapters/fake-knowledge.adapter.js';
import { FakeModelAdapter } from '../adapters/fake-model.adapter.js';
import { readAiProviderConfiguration } from '../adapters/provider-configuration.js';
import { PythonAiAdapter, defaultPythonAiFetch } from '../adapters/python-ai.adapter.js';
import { WeknoraKnowledgeAdapter } from '../adapters/weknora-knowledge.adapter.js';
import { AgentOrchestrator } from './agent-orchestrator.js';

/**
 * Provider selection is environment-driven and defaults to the offline fakes,
 * so a fresh checkout / CI / test run never needs network or a secret.
 *
 * The injection tokens stay the Fake classes on purpose: integration and e2e
 * suites override them via overrideProvider(FakeModelAdapter/FakeKnowledgeAdapter),
 * and those overrides keep working regardless of which concrete adapter the
 * default factory would otherwise build.
 */
function createModelAdapter(): ModelProviderPort {
  const configuration = readAiProviderConfiguration(process.env);
  if (configuration.modelProvider === 'http' && configuration.model !== undefined) {
    return new HttpModelAdapter(defaultHttpFetch, configuration.model);
  }
  if (configuration.modelProvider === 'python' && configuration.pythonAi !== undefined) {
    return new PythonAiAdapter(defaultPythonAiFetch, configuration.pythonAi);
  }
  return new FakeModelAdapter();
}

function createKnowledgeAdapter(database: Pool): KnowledgeProviderPort {
  const configuration = readAiProviderConfiguration(process.env);
  if (configuration.knowledgeProvider === 'database') {
    console.log('[AI] Using database knowledge adapter (knowledge_product table)');
    return new DatabaseKnowledgeAdapter(database);
  }
  if (configuration.knowledgeProvider === 'external' && configuration.externalKnowledge !== undefined) {
    return new ExternalHttpKnowledgeAdapter(defaultKnowledgeHttpFetch, configuration.externalKnowledge);
  }
  if (configuration.knowledgeProvider === 'weknora' && configuration.weknoraKnowledge !== undefined) {
    console.log('[AI] Using weknora knowledge adapter (pending implementation)');
    return new WeknoraKnowledgeAdapter(configuration.weknoraKnowledge);
  }
  // Unconfigured or incomplete weknora env vars degrade to the offline fake so
  // the service keeps running without secrets.
  if (configuration.knowledgeProvider === 'weknora') {
    console.log('[AI] KNOWLEDGE_PROVIDER=weknora but WEKNORA_API_URL/WEKNORA_API_KEY not set — degrading to FakeKnowledgeAdapter');
  }
  return new FakeKnowledgeAdapter();
}

@Module({
  providers: [
    { provide: Pool, useFactory: (): Pool => new Pool({ connectionString: process.env.DATABASE_URL }) },
    {
      provide: FakeKnowledgeAdapter,
      useFactory: createKnowledgeAdapter,
      inject: [Pool],
    },
    { provide: FakeModelAdapter, useFactory: createModelAdapter },
    {
      provide: AgentOrchestrator,
      useFactory: (knowledge: KnowledgeProviderPort, model: ModelProviderPort) => new AgentOrchestrator(knowledge, model),
      inject: [FakeKnowledgeAdapter, FakeModelAdapter],
    },
  ],
  exports: [AgentOrchestrator],
})
export class AiModule {}
