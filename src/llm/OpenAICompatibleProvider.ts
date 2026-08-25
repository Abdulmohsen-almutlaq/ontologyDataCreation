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

type ConstraintMode = 'json_schema' | 'json_object' | 'none';

/**
 * Any server speaking the OpenAI /chat/completions shape: vLLM, LM Studio,
 * llama.cpp server, OpenAI itself, and most cloud gateways.
 *
 * Servers disagree on `response_format` support, so the constraint is
 * negotiated downwards at runtime: json_schema -> json_object -> none.
 */
class OpenAICompatibleClient implements LLMClient {
  readonly name = 'openai-compatible';
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  private mode: ConstraintMode;

  constructor(private readonly config: LLMConfig, capabilities: LLMCapabilities) {
    this.model = config.model;
    this.capabilities = capabilities;
    this.mode = capabilities.structuredOutput
      ? capabilities.jsonSchema
        ? 'json_schema'
        : 'json_object'
      : 'none';
  }

  private responseFormat(mode: ConstraintMode, schema?: Record<string, unknown>) {
    if (mode === 'json_schema' && schema) {
      return {
        type: 'json_schema',
        json_schema: { name: 'response', schema, strict: false },
      };
    }
    if (mode === 'json_object') return { type: 'json_object' };
    return undefined;
  }

  private downgrade(): boolean {
    if (this.mode === 'json_schema') {
      this.mode = 'json_object';
      return true;
    }
    if (this.mode === 'json_object') {
      this.mode = 'none';
      return true;
    }
    return false;
  }

  async complete(request: LLMRequest): Promise<LLMCompletion> {
    const started = Date.now();
    const url = joinUrl(this.config.baseUrl!, '/chat/completions');
    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;

    const body = (mode: ConstraintMode) => ({
      model: this.model,
      messages: [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        { role: 'user', content: request.prompt },
      ],
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      stream: false,
      response_format: this.responseFormat(mode, request.jsonSchema),
    });

    let res = await postJson({
      url,
      body: body(this.mode),
      headers,
      timeoutMs: this.config.timeoutMs,
      provider: this.name,
    });

    // 400/422 commonly means the server rejected response_format. Step down.
    while (!res.ok && (res.status === 400 || res.status === 422) && this.downgrade()) {
      res = await postJson({
        url,
        body: body(this.mode),
        headers,
        timeoutMs: this.config.timeoutMs,
        provider: this.name,
      });
    }

    if (!res.ok) {
      throw new LLMError(
        `OpenAI-compatible endpoint returned ${res.status}: ${res.text.slice(0, 500)}`,
        this.name
      );
    }

    const text: string = res.json?.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new LLMError('OpenAI-compatible endpoint returned no content', this.name);
    }

    return {
      text,
      model: this.model,
      provider: this.name,
      schemaConstrained: this.mode !== 'none',
      durationMs: Date.now() - started,
      usage: {
        promptTokens: res.json?.usage?.prompt_tokens,
        completionTokens: res.json?.usage?.completion_tokens,
        totalTokens: res.json?.usage?.total_tokens,
      },
    };
  }
}

export const openAICompatibleProvider: LLMProvider = {
  name: 'openai-compatible',
  defaultCapabilities(): LLMCapabilities {
    return {
      structuredOutput: true,
      // Conservative: plain json_object works far more widely than json_schema.
      jsonSchema: false,
      toolCalling: true,
      streaming: true,
      vision: false,
    };
  },
  createClient(config: LLMConfig): LLMClient {
    if (!config.baseUrl) {
      throw new LLMError(
        'openai-compatible provider requires LLM_BASE_URL',
        'openai-compatible'
      );
    }
    return new OpenAICompatibleClient(
      config,
      applyCapabilityOverrides(
        openAICompatibleProvider.defaultCapabilities(config),
        config
      )
    );
  },
};
