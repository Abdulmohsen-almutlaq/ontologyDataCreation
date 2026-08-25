import type { LLMConfig } from '../config/Config';
import {
  LLMError,
  type LLMCapabilities,
  type LLMClient,
  type LLMCompletion,
  type LLMRequest,
} from './LLMClient';
import { applyCapabilityOverrides, type LLMProvider } from './LLMProvider';
import { joinUrl, postJson } from './http';

/**
 * Ollama native chat API.
 *
 * `format` accepts either the string "json" or a JSON Schema object on recent
 * builds. Older builds reject the object form, so a schema-constrained call
 * that fails is retried unconstrained rather than throwing: the structured
 * layer validates with Zod either way.
 */
class OllamaClient implements LLMClient {
  readonly name = 'ollama';
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  private schemaConstraintSupported = true;

  constructor(private readonly config: LLMConfig, capabilities: LLMCapabilities) {
    this.model = config.model;
    this.capabilities = capabilities;
  }

  async complete(request: LLMRequest): Promise<LLMCompletion> {
    const started = Date.now();
    const useSchema =
      this.capabilities.structuredOutput &&
      this.schemaConstraintSupported &&
      !!request.jsonSchema;

    const build = (withSchema: boolean) => ({
      model: this.model,
      stream: false,
      messages: [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        { role: 'user', content: request.prompt },
      ],
      format: withSchema
        ? this.capabilities.jsonSchema
          ? request.jsonSchema
          : 'json'
        : undefined,
      options: {
        temperature: request.temperature ?? this.config.temperature,
        num_predict: request.maxTokens ?? this.config.maxTokens,
      },
    });

    const url = joinUrl(this.config.baseUrl!, '/api/chat');
    let res = await postJson({
      url,
      body: build(useSchema),
      timeoutMs: this.config.timeoutMs,
      provider: this.name,
    });

    if (!res.ok && useSchema) {
      // The constraint is an optimisation; degrade instead of failing.
      this.schemaConstraintSupported = false;
      res = await postJson({
        url,
        body: build(false),
        timeoutMs: this.config.timeoutMs,
        provider: this.name,
      });
    }

    if (!res.ok) {
      throw new LLMError(
        `Ollama returned ${res.status}: ${res.text.slice(0, 500)}`,
        this.name
      );
    }

    const text: string = res.json?.message?.content ?? '';
    if (!text) {
      throw new LLMError('Ollama returned an empty completion', this.name);
    }

    return {
      text,
      model: this.model,
      provider: this.name,
      schemaConstrained: useSchema && this.schemaConstraintSupported,
      durationMs: Date.now() - started,
      usage: {
        promptTokens: res.json?.prompt_eval_count,
        completionTokens: res.json?.eval_count,
      },
    };
  }
}

export const ollamaProvider: LLMProvider = {
  name: 'ollama',
  defaultCapabilities(): LLMCapabilities {
    return {
      structuredOutput: true,
      jsonSchema: true,
      toolCalling: false,
      streaming: true,
      vision: false,
    };
  },
  createClient(config: LLMConfig): LLMClient {
    if (!config.baseUrl) {
      throw new LLMError('ollama provider requires LLM_BASE_URL', 'ollama');
    }
    return new OllamaClient(
      config,
      applyCapabilityOverrides(ollamaProvider.defaultCapabilities(config), config)
    );
  },
};
