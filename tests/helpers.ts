import * as path from 'node:path';
import { loadConfig, type Config } from '../src/config/Config';
import { createLogger } from '../src/config/logger';
import { OntologyHarness, type OntologyResult } from '../src/OntologyHarness';

/** Repo root. Tests run from the project directory; __dirname would point into
 *  the compiled output, which is exactly the mistake PROMPTS_DIR exists to avoid. */
export const ROOT = process.cwd();

/**
 * Builds a config the same way production does - through loadConfig and its Zod
 * validation - but pointed at the scripted provider and the fixture observer.
 * Tests therefore exercise the real registry, the real prompt loader and the
 * real control loop; only the two external systems are substituted.
 */
export function testEnv(
  script: string,
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SOURCE_KIND: 'fixture',
    OBSERVATION_FIXTURE_DIR: path.join(ROOT, 'tests/fixtures/observation'),
    SOURCE_SCHEMA: 'public',
    LLM_PROVIDER: 'mock',
    LLM_MODEL: 'scripted',
    LLM_MOCK_SCRIPT: path.join(ROOT, 'tests/fixtures/llm', `${script}.json`),
    PROMPTS_DIR: path.join(ROOT, 'prompts'),
    PROMPT_VERSION: 'v1',
    OUTPUT_DIR: path.join(ROOT, 'tests/.out'),
    TRACE_ENABLED: 'true',
    ...overrides,
  };
}

export function testConfig(
  script: string,
  overrides: Record<string, string> = {}
): Config {
  return loadConfig(testEnv(script, overrides));
}

export interface RunOptions {
  semanticValidation?: boolean;
  llmGapAnalysis?: boolean;
  completionAssessment?: boolean;
}

export async function runScripted(
  script: string,
  overrides: Record<string, string> = {},
  options: RunOptions = {}
): Promise<OntologyResult> {
  const config = testConfig(script, overrides);
  const harness = new OntologyHarness({
    config,
    logger: createLogger('silent'),
    llmGapAnalysis: options.llmGapAnalysis ?? true,
    // Off by default: each optional pass needs its own scripted entries.
    semanticValidation: options.semanticValidation ?? false,
    completionAssessment: options.completionAssessment ?? true,
  });
  return harness.run(OntologyHarness.sourceFromConfig(config));
}

export function depthOf(result: OntologyResult, node: string): number {
  return result.depth.nodeDepths[node] ?? 0;
}
