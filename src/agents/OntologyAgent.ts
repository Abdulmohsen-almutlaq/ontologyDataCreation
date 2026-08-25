import type { HarnessStatus } from '../core/types';
import { jsonSchemas } from '../schemas';
import { OperationsResponseSchema, type OperationsResponse } from '../schemas/llm';
import type { ExplorationState } from '../exploration/ExplorationState';
import { BaseAgent } from './BaseAgent';
import { buildContext, type ContextOptions } from './context';

/**
 * Resolves entities and their attributes: assigns semantic roles, identifies
 * identifiers, and merges physical tables that describe one real-world thing.
 */
export class OntologyAgent extends BaseAgent {
  readonly name = 'OntologyAgent';

  async propose(
    state: ExplorationState,
    options: ContextOptions = {}
  ): Promise<OperationsResponse> {
    return this.reason<OperationsResponse>({
      promptName: 'ontology/entity-resolution',
      systemPromptName: 'system/base',
      variables: buildContext(state, options),
      schema: OperationsResponseSchema,
      schemaName: 'OntologyOperations',
      jsonSchema: jsonSchemas.operations,
      label: 'entity-resolution',
      iteration: state.iteration,
      state: 'BUILDING' as HarnessStatus,
    });
  }
}
