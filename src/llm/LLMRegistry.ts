import type { LLMConfig } from '../config/Config';
import { LLMError, type LLMClient } from './LLMClient';
import type { LLMProvider } from './LLMProvider';
import { mockProvider } from './MockProvider';
import { ollamaProvider } from './OllamaProvider';
import { openAICompatibleProvider } from './OpenAICompatibleProvider';

/**
 * Adding a provider (Anthropic, Bedrock, Azure, vLLM-native, ...) means
 * registering one object here. No ontology, agent or exploration code changes.
 */
export class LLMRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): this {
    this.providers.set(provider.name.toLowerCase(), provider);
    return this;
  }

  has(name: string): boolean {
    return this.providers.has(name.toLowerCase());
  }

  names(): string[] {
    return [...this.providers.keys()].sort();
  }

  get(name: string): LLMProvider {
    const provider = this.providers.get(name.toLowerCase());
    if (!provider) {
      throw new LLMError(
        `Unknown LLM provider "${name}". Registered providers: ${this.names().join(', ')}`,
        name
      );
    }
    return provider;
  }

  createClient(config: LLMConfig): LLMClient {
    return this.get(config.provider).createClient(config);
  }
}

export function defaultRegistry(): LLMRegistry {
  return new LLMRegistry()
    .register(ollamaProvider)
    .register(openAICompatibleProvider)
    .register(mockProvider);
}
