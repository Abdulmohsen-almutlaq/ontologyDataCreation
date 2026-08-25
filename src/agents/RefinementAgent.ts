import type { HarnessStatus } from '../core/types';
import { jsonSchemas } from '../schemas';
import { OperationsResponseSchema, type OperationsResponse } from '../schemas/llm';
import type { ExplorationState } from '../exploration/ExplorationState';
import { BaseAgent } from './BaseAgent';
import { buildContext, type ContextOptions } from './context';

/**
 * Sharpens what already exists instead of adding to it: disambiguates concepts,
 * corrects wrong assertions, merges duplicates, downgrades overstated claims.
 */
export class RefinementAgent extends BaseAgent {
  readonly name = 'RefinementAgent';

  async propose(
    state: ExplorationState,
    options: ContextOptions = {}
  ): Promise<OperationsResponse> {
    return this.reason<OperationsResponse>({
      promptName: 'validation/refinement',
      systemPromptName: 'system/base',
      variables: buildContext(state, options),
      schema: OperationsResponseSchema,
      schemaName: 'OntologyOperations',
      jsonSchema: jsonSchemas.operations,
      label: 'refinement',
      iteration: state.iteration,
      state: 'REFINING' as HarnessStatus,
    });
  }
}
