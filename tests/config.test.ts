import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { loadConfig } from '../src/config/Config';
import { testEnv } from './helpers';

describe('configuration', () => {
  test('loads a valid environment', () => {
    const config = loadConfig(testEnv('stop-early'));
    assert.equal(config.llm.provider, 'mock');
    assert.equal(config.source.kind, 'fixture');
    assert.equal(config.ontology.maxIterations, 25, 'falls back to the documented default');
    assert.ok(config.prompts.dir.endsWith('prompts'));
  });

  test('fails fast when LLM_MODEL is missing', () => {
    const env = testEnv('stop-early');
    delete env.LLM_MODEL;
    assert.throws(() => loadConfig(env), /LLM_MODEL/);
  });

  test('requires DATABASE_URL when the source is postgres', () => {
    const env = testEnv('stop-early', { SOURCE_KIND: 'postgres' });
    assert.throws(() => loadConfig(env), /DATABASE_URL is required/);
  });

  test('requires a base url for a network provider', () => {
    const env = testEnv('stop-early', { LLM_PROVIDER: 'ollama' });
    delete env.LLM_BASE_URL;
    assert.throws(() => loadConfig(env), /LLM_BASE_URL is required/);
  });

  test('requires a script for the mock provider', () => {
    const env = testEnv('stop-early');
    delete env.LLM_MOCK_SCRIPT;
    assert.throws(() => loadConfig(env), /LLM_MOCK_SCRIPT is required/);
  });

  test('rejects an out-of-range numeric limit', () => {
    assert.throws(
      () => loadConfig(testEnv('stop-early', { ONTOLOGY_MAX_ITERATIONS: '0' })),
      /ONTOLOGY_MAX_ITERATIONS/
    );
  });

  test('capability overrides are read from the environment', () => {
    const config = loadConfig(
      testEnv('stop-early', {
        LLM_CAP_JSON_SCHEMA: 'false',
        LLM_CAP_MAX_CONTEXT_TOKENS: '8000',
      })
    );
    assert.equal(config.llm.capabilityOverrides.jsonSchema, false);
    assert.equal(config.llm.capabilityOverrides.maxContextTokens, 8000);
    assert.equal(
      config.llm.capabilityOverrides.structuredOutput,
      undefined,
      'unset overrides must not shadow the provider default'
    );
  });

  test('completion temperature is unset by default, unlike LLM_TEMPERATURE', () => {
    const config = loadConfig(testEnv('stop-early'));
    assert.equal(config.llm.temperature, 0, 'LLM_TEMPERATURE always has a fallback');
    assert.equal(
      config.llm.completionTemperature,
      undefined,
      'no fallback - "unset" must stay distinguishable from "set to 0"'
    );
  });

  test('LLM_COMPLETION_TEMPERATURE overrides only the completion call site', () => {
    const config = loadConfig(
      testEnv('stop-early', { LLM_COMPLETION_TEMPERATURE: '0.5' })
    );
    assert.equal(config.llm.completionTemperature, 0.5);
    assert.equal(config.llm.temperature, 0, 'the global default is untouched');
  });
});
