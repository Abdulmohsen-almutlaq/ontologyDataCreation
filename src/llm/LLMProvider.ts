import type { LLMConfig } from '../config/Config';
import type { LLMCapabilities, LLMClient } from './LLMClient';

export interface LLMProvider {
  readonly name: string;
  /** capabilities the provider claims by default; env can override them */
  defaultCapabilities(config: LLMConfig): LLMCapabilities;
  createClient(config: LLMConfig): LLMClient;
}

export function applyCapabilityOverrides(
  base: LLMCapabilities,
  config: LLMConfig
): LLMCapabilities {
  const o = config.capabilityOverrides ?? {};
  return {
    structuredOutput: o.structuredOutput ?? base.structuredOutput,
    jsonSchema: o.jsonSchema ?? base.jsonSchema,
    toolCalling: o.toolCalling ?? base.toolCalling,
    streaming: o.streaming ?? base.streaming,
    vision: o.vision ?? base.vision,
    maxContextTokens: o.maxContextTokens ?? base.maxContextTokens,
  };
}
