import type { HarnessStatus } from '../core/types';
import { jsonSchemas } from '../schemas';
import { OperationsResponseSchema, type OperationsResponse } from '../schemas/llm';
import type { ExplorationState } from '../exploration/ExplorationState';
import { BaseAgent } from './BaseAgent';
import { buildContext, type ContextOptions } from './context';

/**
 * Proposes concepts, metrics, events and rules: the business meaning that has no
 * single physical counterpart. This is where depth beyond tier 3 comes from.
 */
export class ConceptAgent extends BaseAgent {
  readonly name = 'ConceptAgent';

  async propose(
    state: ExplorationState,
    options: ContextOptions = {}
  ): Promise<OperationsResponse> {
    return this.reason<OperationsResponse>({
      promptName: 'ontology/concept-discovery',
      systemPromptName: 'system/base',
      variables: buildContext(state, options),
      schema: OperationsResponseSchema,
      schemaName: 'OntologyOperations',
      jsonSchema: jsonSchemas.operations,
      label: 'concept-discovery',
      iteration: state.iteration,
      state: 'BUILDING' as HarnessStatus,
    });
  }
}
