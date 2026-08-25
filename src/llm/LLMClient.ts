import type { ZodType, ZodTypeDef } from 'zod';

export interface LLMCapabilities {
  /** provider can constrain generation to a shape at all */
  structuredOutput: boolean;
  /** provider accepts a full JSON Schema (stricter than plain "json mode") */
  jsonSchema: boolean;
  toolCalling: boolean;
  streaming: boolean;
  vision: boolean;
  maxContextTokens?: number;
}

export interface LLMRequest {
  /** provider-agnostic label for tracing; real providers ignore it, the
   *  deterministic mock provider routes on it */
  label?: string;
  /** rendered system prompt */
  system?: string;
  /** rendered user prompt */
  prompt: string;
  /** JSON Schema describing the expected reply, when one is known */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LLMCompletion {
  text: string;
  model: string;
  provider: string;
  usage?: LLMUsage;
  /** true when the provider applied a native schema constraint */
  schemaConstrained: boolean;
  durationMs: number;
}

export interface LLMResponse<T> {
  value: T;
  raw: string;
  model: string;
  provider: string;
  /** how many completions were consumed, including correction retries */
  calls: number;
  usage?: LLMUsage;
}

/**
 * Transport-level client. Providers implement this and nothing else;
 * validation, correction retries and budgeting live above it.
 */
export interface LLMClient {
  readonly name: string;
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  complete(request: LLMRequest): Promise<LLMCompletion>;
}

/**
 * The interface the agents actually use (spec section 5). Generic over the
 * expected payload; the schema is supplied by the caller so that raw output is
 * never trusted regardless of provider capability.
 */
export interface StructuredLLM {
  generate<T>(request: StructuredRequest<T>): Promise<LLMResponse<T>>;
}

export interface StructuredRequest<T> {
  /** label identifying the call site, e.g. "depth-decision" */
  label: string;
  system?: string;
  prompt: string;
  /** Input type is left open: schemas with defaults have an input type that
   *  differs from their output, and only the output is what callers consume. */
  schema: ZodType<T, ZodTypeDef, any>;
  /** name used in traces and correction prompts */
  schemaName: string;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastRaw: string
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}
