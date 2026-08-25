import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { z } from 'zod';

dotenv.config();

/**
 * The ONLY module permitted to read `process.env`.
 * Everything else receives a typed, validated `Config`.
 */

const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const numeric = (fallback: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().finite().min(min));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const EnvSchema = z
  .object({
    NODE_ENV: z.string().optional().default('development'),
    PORT: numeric(3000, 0),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional()
      .default('info'),

    SOURCE_KIND: z.enum(['postgres', 'fixture']).optional().default('postgres'),
    DATABASE_URL: optionalString,
    SOURCE_SCHEMA: z.string().optional().default('public'),
    OBSERVATION_FIXTURE_DIR: z
      .string()
      .optional()
      .default('./tests/fixtures/observation'),

    LLM_PROVIDER: z.string().optional().default('ollama'),
    LLM_MODEL: z.string().min(1, 'LLM_MODEL is required'),
    LLM_BASE_URL: optionalString,
    LLM_API_KEY: optionalString,
    LLM_TEMPERATURE: numeric(0, 0),
    LLM_MAX_TOKENS: numeric(8192, 1),
    LLM_TIMEOUT_MS: numeric(120_000, 1_000),
    LLM_MAX_CORRECTION_RETRIES: numeric(2, 0),
    LLM_MOCK_SCRIPT: optionalString,

    LLM_CAP_STRUCTURED_OUTPUT: boolish.optional(),
    LLM_CAP_JSON_SCHEMA: boolish.optional(),
    LLM_CAP_TOOL_CALLING: boolish.optional(),
    LLM_CAP_STREAMING: boolish.optional(),
    LLM_CAP_VISION: boolish.optional(),
    LLM_CAP_MAX_CONTEXT_TOKENS: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === '' ? undefined : Number(v)))
      .pipe(z.number().int().positive().optional()),

    PROMPTS_DIR: z.string().optional().default('./prompts'),
    PROMPT_VERSION: z.string().optional().default('v1'),

    ONTOLOGY_MAX_DEPTH: numeric(10, 1),
    ONTOLOGY_MAX_ITERATIONS: numeric(25, 1),
    ONTOLOGY_MAX_LLM_CALLS: numeric(100, 1),
    ONTOLOGY_MAX_NODES: numeric(1000, 1),
    ONTOLOGY_MAX_OBSERVATION_REQUESTS: numeric(200, 1),
    ONTOLOGY_MAX_RUNTIME_MS: numeric(900_000, 1_000),

    OUTPUT_DIR: z.string().optional().default('./out'),
    TRACE_ENABLED: boolish.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.SOURCE_KIND === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when SOURCE_KIND=postgres',
      });
    }
    if (env.LLM_PROVIDER === 'mock' && !env.LLM_MOCK_SCRIPT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_MOCK_SCRIPT'],
        message: 'LLM_MOCK_SCRIPT is required when LLM_PROVIDER=mock',
      });
    }
    if (
      (env.LLM_PROVIDER === 'ollama' || env.LLM_PROVIDER === 'openai-compatible') &&
      !env.LLM_BASE_URL
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_BASE_URL'],
        message: `LLM_BASE_URL is required when LLM_PROVIDER=${env.LLM_PROVIDER}`,
      });
    }
  });

export interface CapabilityOverrides {
  structuredOutput?: boolean;
  jsonSchema?: boolean;
  toolCalling?: boolean;
  streaming?: boolean;
  vision?: boolean;
  maxContextTokens?: number;
}

export interface LLMConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxCorrectionRetries: number;
  mockScript?: string;
  capabilityOverrides: CapabilityOverrides;
}

export interface OntologyLimits {
  maxDepth: number;
  maxIterations: number;
  maxLLMCalls: number;
  maxNodes: number;
  maxObservationRequests: number;
  maxRuntimeMs: number;
}

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  source: {
    kind: 'postgres' | 'fixture';
    databaseUrl?: string;
    schema: string;
    fixtureDir: string;
  };
  llm: LLMConfig;
  prompts: {
    dir: string;
    version: string;
  };
  ontology: OntologyLimits;
  output: {
    dir: string;
    traceEnabled: boolean;
  };
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Fail fast: an invalid environment must never reach the harness.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const e = parsed.data;

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    source: {
      kind: e.SOURCE_KIND,
      databaseUrl: e.DATABASE_URL,
      schema: e.SOURCE_SCHEMA,
      fixtureDir: path.resolve(e.OBSERVATION_FIXTURE_DIR),
    },
    llm: {
      provider: e.LLM_PROVIDER,
      model: e.LLM_MODEL,
      baseUrl: e.LLM_BASE_URL,
      apiKey: e.LLM_API_KEY,
      temperature: e.LLM_TEMPERATURE,
      maxTokens: e.LLM_MAX_TOKENS,
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxCorrectionRetries: e.LLM_MAX_CORRECTION_RETRIES,
      mockScript: e.LLM_MOCK_SCRIPT ? path.resolve(e.LLM_MOCK_SCRIPT) : undefined,
      capabilityOverrides: stripUndefined({
        structuredOutput: e.LLM_CAP_STRUCTURED_OUTPUT,
        jsonSchema: e.LLM_CAP_JSON_SCHEMA,
        toolCalling: e.LLM_CAP_TOOL_CALLING,
        streaming: e.LLM_CAP_STREAMING,
        vision: e.LLM_CAP_VISION,
        maxContextTokens: e.LLM_CAP_MAX_CONTEXT_TOKENS,
      }) as CapabilityOverrides,
    },
    prompts: {
      // Resolved from CWD/env, never from __dirname: the compiled output
      // location differs between ts dev, dist/ and the container.
      dir: path.resolve(e.PROMPTS_DIR),
      version: e.PROMPT_VERSION,
    },
    ontology: {
      maxDepth: e.ONTOLOGY_MAX_DEPTH,
      maxIterations: e.ONTOLOGY_MAX_ITERATIONS,
      maxLLMCalls: e.ONTOLOGY_MAX_LLM_CALLS,
      maxNodes: e.ONTOLOGY_MAX_NODES,
      maxObservationRequests: e.ONTOLOGY_MAX_OBSERVATION_REQUESTS,
      maxRuntimeMs: e.ONTOLOGY_MAX_RUNTIME_MS,
    },
    output: {
      dir: path.resolve(e.OUTPUT_DIR),
      traceEnabled: e.TRACE_ENABLED ?? true,
    },
  };
}
