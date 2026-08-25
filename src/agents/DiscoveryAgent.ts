import type { HarnessStatus } from '../core/types';
import { jsonSchemas } from '../schemas';
import { OperationsResponseSchema, type OperationsResponse } from '../schemas/llm';
import type { ExplorationState } from '../exploration/ExplorationState';
import { BaseAgent } from './BaseAgent';
import { buildContext, type ContextOptions } from './context';

/**
 * First pass over a new source: proposes the SEMANTIC entities the data is
 * about, which is deliberately not the same as the list of tables. Join tables,
 * staging copies and audit columns should not become entities just because they
 * exist.
 */
export class DiscoveryAgent extends BaseAgent {
  readonly name = 'DiscoveryAgent';

  async propose(
    state: ExplorationState,
    options: ContextOptions = {}
  ): Promise<OperationsResponse> {
    return this.reason<OperationsResponse>({
      promptName: 'ontology/discovery',
      systemPromptName: 'system/base',
      variables: buildContext(state, options),
      schema: OperationsResponseSchema,
      schemaName: 'OntologyOperations',
      jsonSchema: jsonSchemas.operations,
      label: 'discovery',
      iteration: state.iteration,
      state: 'DISCOVERING' as HarnessStatus,
    });
  }
}
