import assert from 'node:assert/strict';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import { z } from 'zod';
import { Budget } from '../src/core/Budget';
import { MockClient, mockProvider } from '../src/llm/MockProvider';
import { defaultRegistry } from '../src/llm/LLMRegistry';
import { extractJson, StructuredGenerator } from '../src/llm/StructuredGenerator';
import { PromptLoader } from '../src/prompts/PromptLoader';
import { ROOT, testConfig } from './helpers';

const limits = {
  maxDepth: 10,
  maxIterations: 25,
  maxLLMCalls: 100,
  maxNodes: 1000,
  maxObservationRequests: 200,
  maxRuntimeMs: 900_000,
};

function generator(entries: any[], maxCorrectionRetries = 2) {
  const budget = new Budget(limits);
  const client = new MockClient({ entries }, 'scripted', {
    structuredOutput: false,
    jsonSchema: false,
    toolCalling: false,
    streaming: false,
    vision: false,
  });
  const llm = new StructuredGenerator({
    client,
    budget,
    promptLoader: new PromptLoader({ dir: path.join(ROOT, 'prompts'), version: 'v1' }),
    maxCorrectionRetries,
  });
  return { llm, budget, client };
}

const Shape = z.object({ ok: z.boolean(), count: z.number().default(0) });

describe('provider registry', () => {
  test('switching providers changes nothing but the client', () => {
    const registry = defaultRegistry();
    assert.deepEqual(registry.names(), ['mock', 'ollama', 'openai-compatible']);

    const ollama = registry.createClient(
      testConfig('stop-early', {
        LLM_PROVIDER: 'ollama',
        LLM_BASE_URL: 'http://localhost:11434',
      }).llm
    );
    assert.equal(ollama.name, 'ollama');
    assert.equal(ollama.capabilities.jsonSchema, true);

    const openai = registry.createClient(
      testConfig('stop-early', {
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'http://localhost:8000/v1',
        LLM_API_KEY: 'local',
      }).llm
    );
    assert.equal(openai.name, 'openai-compatible');
    assert.equal(
      openai.capabilities.jsonSchema,
      false,
      'json_schema support is not assumed for arbitrary compatible servers'
    );
  });

  test('an unknown provider is rejected with the registered names', () => {
    assert.throws(
      () => defaultRegistry().get('gemini'),
      /Unknown LLM provider "gemini".*mock, ollama, openai-compatible/s
    );
  });

  test('capability overrides beat the provider default', () => {
    const client = mockProvider.createClient(
      testConfig('stop-early', { LLM_CAP_STRUCTURED_OUTPUT: 'true' }).llm
    );
    assert.equal(client.capabilities.structuredOutput, true);
  });

  test('a provider missing its base url fails at construction', () => {
    assert.throws(
      () =>
        defaultRegistry()
          .get('ollama')
          .createClient({ ...testConfig('stop-early').llm, baseUrl: undefined }),
      /requires LLM_BASE_URL/
    );
  });
});

describe('json extraction', () => {
  test('reads a bare object', () => {
    assert.equal(extractJson('{"a":1}'), '{"a":1}');
  });
  test('reads through a fence and a preamble', () => {
    assert.equal(
      extractJson('Sure!\n```json\n{"a": 1}\n```\nHope that helps'),
      '{"a": 1}'
    );
  });
  test('ignores a reasoning block', () => {
    assert.equal(extractJson('<think>{"not": "this"}</think>{"a":2}'), '{"a":2}');
  });
  test('is not confused by braces inside strings', () => {
    assert.equal(extractJson('{"a":"} not the end {"}'), '{"a":"} not the end {"}');
  });
  test('returns null when there is no JSON', () => {
    assert.equal(extractJson('I cannot help with that.'), null);
  });
});

describe('structured generation', () => {
  test('validates output regardless of provider capability', async () => {
    const { llm } = generator([{ label: 't', response: { ok: true, count: 3 } }]);
    const res = await llm.generate({
      label: 't',
      prompt: 'x',
      schema: Shape,
      schemaName: 'Shape',
    });
    assert.deepEqual(res.value, { ok: true, count: 3 });
  });

  test('recovers from malformed output through the correction prompt', async () => {
    const { llm, budget } = generator([
      { label: 't', raw: 'here you go, no json at all' },
      { label: 't', response: { ok: true } },
    ]);
    const res = await llm.generate({
      label: 't',
      prompt: 'x',
      schema: Shape,
      schemaName: 'Shape',
    });
    assert.equal(res.value.ok, true);
    assert.equal(res.calls, 2);
    assert.equal(budget.llmCalls, 2, 'the correction retry is charged to the budget');
  });

  test('gives up after the configured number of retries', async () => {
    const { llm, budget } = generator(
      [
        { label: 't', raw: 'nope' },
        { label: 't', raw: 'still nope' },
      ],
      1
    );
    await assert.rejects(
      llm.generate({ label: 't', prompt: 'x', schema: Shape, schemaName: 'Shape' }),
      /failed to produce valid Shape after 2 attempt/
    );
    assert.equal(budget.llmCalls, 2);
  });

  test('schema violations are reported field by field to the model', async () => {
    const { llm, client } = generator([
      { label: 't', response: { ok: 'yes' } },
      { label: 't', response: { ok: false } },
    ]);
    await llm.generate({ label: 't', prompt: 'x', schema: Shape, schemaName: 'Shape' });
    assert.match(client.calls[1].prompt, /ok: Expected boolean/);
  });

  test('the budget stops generation before the call is made', async () => {
    const { llm, budget } = generator([{ label: 't', response: { ok: true } }]);
    budget.llmCalls = limits.maxLLMCalls;
    await assert.rejects(
      llm.generate({ label: 't', prompt: 'x', schema: Shape, schemaName: 'Shape' }),
      /LLM call budget exhausted/
    );
  });

  test('a transport failure propagates', async () => {
    const { llm } = generator([{ label: 't', error: 'connection refused' }]);
    await assert.rejects(
      llm.generate({ label: 't', prompt: 'x', schema: Shape, schemaName: 'Shape' }),
      /connection refused/
    );
  });
});
