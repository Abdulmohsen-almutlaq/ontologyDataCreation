import type { LLMConfig } from '../config/Config';
import { LLMError, type LLMCapabilities, type LLMClient } from './LLMClient';
import type { LLMProvider } from './LLMProvider';
import { openAICompatibleProvider } from './OpenAICompatibleProvider';

/**
 * DeepSeek speaks the OpenAI /chat/completions shape, so this provider is a
 * thin delegation rather than a second transport: it supplies the base URL,
 * refuses to start without a key, and declares what the chosen model can do.
 *
 * Nothing about DeepSeek is written down here. The endpoint, the models that
 * accept images and the context window are vendor facts that can change
 * without a release, so they arrive through `config.llm.deepseek` and are
 * defaulted in `Config.ts` like every other setting.
 *
 * Deliberately no changes to OpenAICompatibleProvider. That client is the only
 * zero-coverage code in the tree, and restructuring code that cannot be
 * verified here would trade working-but-untested for changed-and-untested.
 */
export const deepseekProvider: LLMProvider = {
  name: 'deepseek',

  defaultCapabilities(config: LLMConfig): LLMCapabilities {
    return {
      ...openAICompatibleProvider.defaultCapabilities(config),
      // DeepSeek documents response_format json_object and does not claim
      // json_schema, so the client starts one rung down its own ladder.
      //
      // json_object additionally requires the literal word "json" somewhere in
      // the prompt, or the request is rejected. Every call here carries
      // prompts/v1/system/base.md, which says "one JSON object and nothing
      // else" — the requirement is met by the system prompt, not by luck, but
      // it is a constraint on editing that file.
      jsonSchema: false,
      vision: config.deepseek.visionModels.includes(config.model),
      maxContextTokens: config.deepseek.maxContextTokens,
    };
  },

  createClient(config: LLMConfig): LLMClient {
    if (!config.apiKey) {
      throw new LLMError('deepseek provider requires LLM_API_KEY', 'deepseek');
    }
    return openAICompatibleProvider.createClient({
      ...config,
      baseUrl: config.baseUrl ?? config.deepseek.baseUrl,
      capabilityOverrides: {
        ...deepseekProvider.defaultCapabilities(config),
        ...config.capabilityOverrides,
      },
    });
  },
};
