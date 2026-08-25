import * as fs from 'node:fs';
import type { LLMConfig } from '../config/Config';
import {
  LLMError,
  type LLMCapabilities,
  type LLMClient,
  type LLMCompletion,
  type LLMRequest,
} from './LLMClient';
import { applyCapabilityOverrides, type LLMProvider } from './LLMProvider';

interface ScriptEntry {
  /** call-site label this entry answers, e.g. "depth-decision" */
  label: string;
  /** JSON payload returned verbatim, or a raw string for malformed-output tests */
  response?: unknown;
  raw?: string;
  /** simulate a transport failure */
  error?: string;
  /** reusable: never consumed, used when the queue for a label runs dry */
  fallback?: boolean;
}

interface Script {
  name?: string;
  description?: string;
  entries: ScriptEntry[];
}

/**
 * Deterministic scripted provider.
 *
 * This is NOT a test-only shim bolted on the side: it is registered in the same
 * registry as the real providers and reached through the same
 * config/capability/validation path. It is what makes the harness runnable and
 * its exploration behaviour assertable without a live model.
 */
export class MockClient implements LLMClient {
  readonly name = 'mock';
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  private readonly queues = new Map<string, ScriptEntry[]>();
  private readonly fallbacks = new Map<string, ScriptEntry>();
  readonly calls: Array<{ label: string; prompt: string; temperature?: number }> = [];

  constructor(script: Script, model: string, capabilities: LLMCapabilities) {
    this.model = model;
    this.capabilities = capabilities;
    for (const entry of script.entries) {
      if (entry.fallback) {
        this.fallbacks.set(entry.label, entry);
        continue;
      }
      const q = this.queues.get(entry.label) ?? [];
      q.push(entry);
      this.queues.set(entry.label, q);
    }
  }

  static fromFile(file: string, model: string, capabilities: LLMCapabilities) {
    let script: Script;
    try {
      script = JSON.parse(fs.readFileSync(file, 'utf-8')) as Script;
    } catch (err) {
      throw new LLMError(`Unable to read mock script ${file}`, 'mock', err);
    }
    if (!Array.isArray(script.entries)) {
      throw new LLMError(`Mock script ${file} has no "entries" array`, 'mock');
    }
    return new MockClient(script, model, capabilities);
  }

  async complete(request: LLMRequest): Promise<LLMCompletion> {
    const label = request.label ?? 'default';
    this.calls.push({ label, prompt: request.prompt, temperature: request.temperature });

    const queue = this.queues.get(label);
    const entry = (queue && queue.shift()) ?? this.fallbacks.get(label);
    if (!entry) {
      throw new LLMError(
        `Mock script has no remaining entry for label "${label}"`,
        'mock'
      );
    }
    if (entry.error) {
      throw new LLMError(entry.error, 'mock');
    }

    const text =
      entry.raw !== undefined ? entry.raw : JSON.stringify(entry.response ?? {});

    return {
      text,
      model: this.model,
      provider: this.name,
      schemaConstrained: false,
      durationMs: 0,
    };
  }
}

export const mockProvider: LLMProvider = {
  name: 'mock',
  defaultCapabilities(): LLMCapabilities {
    return {
      structuredOutput: false,
      jsonSchema: false,
      toolCalling: false,
      streaming: false,
      vision: false,
    };
  },
  createClient(config: LLMConfig): LLMClient {
    if (!config.mockScript) {
      throw new LLMError('mock provider requires LLM_MOCK_SCRIPT', 'mock');
    }
    return MockClient.fromFile(
      config.mockScript,
      config.model,
      applyCapabilityOverrides(mockProvider.defaultCapabilities(config), config)
    );
  },
};
