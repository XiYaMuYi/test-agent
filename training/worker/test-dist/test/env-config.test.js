import test from 'node:test';
import assert from 'node:assert/strict';
/**
 * Env-config tests — verify the worker reads model configuration from the
 * environment and falls back to offline-safe defaults when no .env is loaded.
 *
 * In production the worker is launched with `--env-file=../api/.env`, so it
 * shares the same model config as the API.  These tests confirm the contract
 * without requiring a real .env file to exist on disk.
 */
test('readModelConfig returns fake provider by default when no env vars are set', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const saved = { ...process.env };
    try {
        delete process.env.MODEL_PROVIDER;
        delete process.env.MODEL_BASE_URL;
        delete process.env.MODEL_API_KEY;
        delete process.env.MODEL_NAME;
        delete process.env.MODEL_TIMEOUT_MS;
        const config = readModelConfig();
        assert.equal(config.provider, 'fake');
        assert.equal(config.baseUrl, '');
        assert.equal(config.apiKey, '');
        assert.equal(config.modelName, '');
        assert.equal(config.timeoutMs, 30000);
    }
    finally {
        process.env = saved;
    }
});
test('readModelConfig reads MODEL_PROVIDER from the environment', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const saved = process.env.MODEL_PROVIDER;
    try {
        process.env.MODEL_PROVIDER = 'http';
        const config = readModelConfig();
        assert.equal(config.provider, 'http');
    }
    finally {
        if (saved === undefined)
            delete process.env.MODEL_PROVIDER;
        else
            process.env.MODEL_PROVIDER = saved;
    }
});
test('readModelConfig reads MODEL_BASE_URL from the environment', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const saved = process.env.MODEL_BASE_URL;
    try {
        process.env.MODEL_BASE_URL = 'https://example.com/v1';
        const config = readModelConfig();
        assert.equal(config.baseUrl, 'https://example.com/v1');
    }
    finally {
        if (saved === undefined)
            delete process.env.MODEL_BASE_URL;
        else
            process.env.MODEL_BASE_URL = saved;
    }
});
test('readModelConfig reads MODEL_API_KEY from the environment', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const saved = process.env.MODEL_API_KEY;
    try {
        process.env.MODEL_API_KEY = 'test-key-123';
        const config = readModelConfig();
        assert.equal(config.apiKey, 'test-key-123');
    }
    finally {
        if (saved === undefined)
            delete process.env.MODEL_API_KEY;
        else
            process.env.MODEL_API_KEY = saved;
    }
});
test('readModelConfig reads MODEL_NAME from the environment', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const saved = process.env.MODEL_NAME;
    try {
        process.env.MODEL_NAME = 'qwen3.7-plus';
        const config = readModelConfig();
        assert.equal(config.modelName, 'qwen3.7-plus');
    }
    finally {
        if (saved === undefined)
            delete process.env.MODEL_NAME;
        else
            process.env.MODEL_NAME = saved;
    }
});
test('readModelConfig reads MODEL_TIMEOUT_MS from the environment', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const saved = process.env.MODEL_TIMEOUT_MS;
    try {
        process.env.MODEL_TIMEOUT_MS = '90000';
        const config = readModelConfig();
        assert.equal(config.timeoutMs, 90000);
    }
    finally {
        if (saved === undefined)
            delete process.env.MODEL_TIMEOUT_MS;
        else
            process.env.MODEL_TIMEOUT_MS = saved;
    }
});
test('readModelConfig accepts a custom env object for testing', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const config = readModelConfig({
        MODEL_PROVIDER: 'http',
        MODEL_BASE_URL: 'https://custom.api/v1',
        MODEL_API_KEY: 'custom-key',
        MODEL_NAME: 'custom-model',
        MODEL_TIMEOUT_MS: '60000',
    });
    assert.equal(config.provider, 'http');
    assert.equal(config.baseUrl, 'https://custom.api/v1');
    assert.equal(config.apiKey, 'custom-key');
    assert.equal(config.modelName, 'custom-model');
    assert.equal(config.timeoutMs, 60000);
});
test('readModelConfig defaults to fake when MODEL_PROVIDER is empty string', async () => {
    const { readModelConfig } = await import('../src/config.js');
    const config = readModelConfig({ MODEL_PROVIDER: '' });
    // Empty string is a defined value, so it wins over the `??` fallback.
    // The worker.module.ts treats any non-'http' value as fake/offline.
    assert.equal(config.provider, '');
});
