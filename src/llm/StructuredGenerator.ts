import type { ZodType, ZodTypeDef } from 'zod';
import type { Budget } from '../core/Budget';
import type { PromptLoader } from '../prompts/PromptLoader';
import {
  StructuredOutputError,
  type LLMClient,
  type LLMResponse,
  type StructuredLLM,
  type StructuredRequest,
} from './LLMClient';

export interface StructuredGeneratorOptions {
  client: LLMClient;
  budget: Budget;
  promptLoader: PromptLoader;
  maxCorrectionRetries: number;
  onCall?: (event: LLMCallEvent) => void;
}

export interface LLMCallEvent {
  label: string;
  schemaName: string;
  attempt: number;
  ok: boolean;
  provider: string;
  model: string;
  durationMs: number;
  schemaConstrained: boolean;
  error?: string;
  raw: string;
}

/**
 * Extracts the first balanced JSON object/array from arbitrary model output.
 * Handles ```json fences, chatty preambles, and reasoning-model <think> blocks.
 */
export function extractJson(text: string): string | null {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();

  const start = t.search(/[{[]/);
  if (start === -1) return null;

  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Turns a raw text client into a schema-guaranteed one.
 *
 * Native schema constraint (when the provider has it) is only an optimisation:
 * output is always parsed and Zod-validated here. On failure the model gets a
 * bounded number of correction attempts driven by `system/correction.md`, and
 * every attempt is charged to the LLM budget.
 */
export class StructuredGenerator implements StructuredLLM {
  constructor(private readonly opts: StructuredGeneratorOptions) {}

  get client(): LLMClient {
    return this.opts.client;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<LLMResponse<T>> {
    const maxAttempts = 1 + Math.max(0, this.opts.maxCorrectionRetries);
    let prompt = request.prompt;
    // Dropped after the first failure: if a native schema constraint is what
    // produced the bad output, re-applying it makes the retry unwinnable.
    let jsonSchema = request.jsonSchema;
    let lastRaw = '';
    let lastError = 'unknown error';
    let calls = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Budget is checked before every attempt, corrections included.
      this.opts.budget.assertLLMBudget();
      this.opts.budget.countLLMCall();
      calls++;

      const completion = await this.opts.client.complete({
        label: request.label,
        system: request.system,
        prompt,
        jsonSchema,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      });
      lastRaw = completion.text;

      const candidate = extractJson(completion.text);
      let parsedJson: unknown;
      if (candidate === null) {
        lastError = 'response contained no JSON object';
      } else {
        try {
          parsedJson = JSON.parse(candidate);
          const result = (request.schema as ZodType<T, ZodTypeDef, any>).safeParse(parsedJson);
          if (result.success) {
            this.opts.onCall?.({
              label: request.label,
              schemaName: request.schemaName,
              attempt,
              ok: true,
              provider: completion.provider,
              model: completion.model,
              durationMs: completion.durationMs,
              schemaConstrained: completion.schemaConstrained,
              raw: completion.text,
            });
            return {
              value: result.data,
              raw: completion.text,
              model: completion.model,
              provider: completion.provider,
              calls,
              usage: completion.usage,
            };
          }
          lastError = result.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ');
        } catch (err) {
          lastError = `invalid JSON: ${(err as Error).message}`;
        }
      }

      this.opts.onCall?.({
        label: request.label,
        schemaName: request.schemaName,
        attempt,
        ok: false,
        provider: completion.provider,
        model: completion.model,
        durationMs: completion.durationMs,
        schemaConstrained: completion.schemaConstrained,
        error: lastError,
        raw: completion.text,
      });

      if (attempt < maxAttempts) {
        const correction = await this.opts.promptLoader.render('system/correction', {
          SCHEMA_NAME: request.schemaName,
          VALIDATION_ERRORS: lastError,
          PREVIOUS_OUTPUT: completion.text.slice(0, 4000),
          ORIGINAL_TASK: request.prompt.slice(0, 6000),
        });
        prompt = correction.rendered;
        jsonSchema = undefined;
      }
    }

    throw new StructuredOutputError(
      `Model failed to produce valid ${request.schemaName} after ${maxAttempts} attempt(s): ${lastError}`,
      maxAttempts,
      lastRaw
    );
  }
}
