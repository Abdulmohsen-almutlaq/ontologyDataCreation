import type { HarnessStatus } from '../core/types';
import type { ExplorationState } from '../exploration/ExplorationState';
import { jsonSchemas } from '../schemas';
import { CompletionSchema } from '../schemas/llm';
import { BaseAgent } from './BaseAgent';
import { buildContext } from './context';

export interface CompletionAssessment {
  sufficient: boolean;
  confidence: number;
  summary: string;
  remainingRisks: string[];
}

/**
 * Final read on the finished ontology: what it says, how far it can be trusted,
 * and what a consumer should still be careful about. Runs once, after the loop
 * has already terminated, so it never influences the stop decision.
 */
export class CompletionAgent extends BaseAgent {
  readonly name = 'CompletionAgent';

  async assess(state: ExplorationState): Promise<CompletionAssessment> {
    return this.reason<CompletionAssessment>({
      promptName: 'validation/completion',
      systemPromptName: 'system/base',
      variables: buildContext(state),
      schema: CompletionSchema,
      schemaName: 'CompletionAssessment',
      jsonSchema: jsonSchemas.completion,
      label: 'completion',
      iteration: state.iteration,
      state: 'COMPLETED' as HarnessStatus,
    });
  }
}
