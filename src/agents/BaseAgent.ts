import type { ZodType, ZodTypeDef } from 'zod';
import type { HarnessStatus } from '../core/types';
import type { StructuredGenerator } from '../llm/StructuredGenerator';
import type { PromptLoader } from '../prompts/PromptLoader';
import { hashContext, type Trace } from '../trace/Trace';

export interface AgentDeps {
  llm: StructuredGenerator;
  prompts: PromptLoader;
  trace: Trace;
  onMissingVariables?: (prompt: string, missing: string[]) => void;
  /** per-call-site temperature override; return undefined to use the global default */
  temperatureFor?: (label: string) => number | undefined;
}

export interface ReasonArgs<T> {
  promptName: string;
  systemPromptName?: string;
  variables: Record<string, string | number | undefined>;
  schema: ZodType<T, ZodTypeDef, any>;
  schemaName: string;
  jsonSchema?: Record<string, unknown>;
  label: string;
  iteration: number;
  state: HarnessStatus;
}

/**
 * Shared plumbing for every agent: render an external prompt, generate a
 * schema-validated response, and write a trace entry that ties the result back
 * to the exact prompt version and model that produced it.
 *
 * Agents contain no prompt text. All wording lives under prompts/<version>/.
 */
export abstract class BaseAgent {
  abstract readonly name: string;

  constructor(protected readonly deps: AgentDeps) {}

  protected async reason<T>(args: ReasonArgs<T>): Promise<T> {
    const started = Date.now();
    const system = args.systemPromptName
      ? await this.deps.prompts.render(args.systemPromptName, args.variables)
      : undefined;
    const prompt = await this.deps.prompts.render(args.promptName, args.variables);
    const missing = [...prompt.missingVariables, ...(system?.missingVariables ?? [])];
    if (missing.length) {
      this.deps.onMissingVariables?.(args.promptName, missing);
    }

    try {
      const response = await this.deps.llm.generate<T>({
        label: args.label,
        system: system?.rendered,
        prompt: prompt.rendered,
        schema: args.schema,
        schemaName: args.schemaName,
        jsonSchema: args.jsonSchema,
        temperature: this.deps.temperatureFor?.(args.label),
      });

      this.deps.trace.record({
        iteration: args.iteration,
        state: args.state,
        agent: this.name,
        promptName: prompt.name,
        promptVersion: prompt.version,
        promptHash: prompt.hash,
        provider: response.provider,
        model: response.model,
        inputContextHash: hashContext(prompt.rendered),
        decision: response.value,
        durationMs: Date.now() - started,
      });

      return response.value;
    } catch (err) {
      this.deps.trace.record({
        iteration: args.iteration,
        state: args.state,
        agent: this.name,
        promptName: prompt.name,
        promptVersion: prompt.version,
        promptHash: prompt.hash,
        inputContextHash: hashContext(prompt.rendered),
        error: (err as Error).message,
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }
}
