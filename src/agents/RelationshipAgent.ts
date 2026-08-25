import type { HarnessStatus } from '../core/types';
import { jsonSchemas } from '../schemas';
import { OperationsResponseSchema, type OperationsResponse } from '../schemas/llm';
import type { ExplorationState } from '../exploration/ExplorationState';
import { BaseAgent } from './BaseAgent';
import { buildContext, type ContextOptions } from './context';

/**
 * Proposes relationships between entities, grounded in declared foreign keys or
 * measured value overlap rather than in column naming alone.
 */
export class RelationshipAgent extends BaseAgent {
  readonly name = 'RelationshipAgent';

  async propose(
    state: ExplorationState,
    options: ContextOptions = {}
  ): Promise<OperationsResponse> {
    return this.reason<OperationsResponse>({
      promptName: 'ontology/relationship-detection',
      systemPromptName: 'system/base',
      variables: buildContext(state, options),
      schema: OperationsResponseSchema,
      schemaName: 'OntologyOperations',
      jsonSchema: jsonSchemas.operations,
      label: 'relationship-detection',
      iteration: state.iteration,
      state: 'BUILDING' as HarnessStatus,
    });
  }
}
