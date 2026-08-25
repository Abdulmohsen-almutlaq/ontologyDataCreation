import type { HarnessStatus, ValidationIssue, ValidationResult } from '../core/types';
import type { ExplorationState } from '../exploration/ExplorationState';
import { OntologyValidator } from '../ontology/OntologyValidator';
import { jsonSchemas } from '../schemas';
import { SemanticValidationSchema } from '../schemas/llm';
import { BaseAgent } from './BaseAgent';
import { buildContext } from './context';

/**
 * Semantic validation, layered on top of the deterministic structural validator.
 *
 * The structural validator catches what is malformed; this catches what is
 * merely wrong - a relationship that contradicts the domain, a metric whose
 * definition does not match its name. Its findings are advisory: they become
 * warnings and gaps, and never silently discard committed ontology state.
 */
export class ValidationAgent extends BaseAgent {
  readonly name = 'ValidationAgent';

  constructor(deps: ConstructorParameters<typeof BaseAgent>[0], private readonly structural = new OntologyValidator()) {
    super(deps);
  }

  /** Deterministic pass only. Always safe to call. */
  validateStructure(state: ExplorationState): ValidationResult {
    return this.structural.validate(state.ontology);
  }

  async validateSemantics(state: ExplorationState): Promise<ValidationIssue[]> {
    const response = await this.reason({
      promptName: 'validation/validation',
      systemPromptName: 'system/base',
      variables: buildContext(state),
      schema: SemanticValidationSchema,
      schemaName: 'SemanticValidation',
      jsonSchema: jsonSchemas.semanticValidation,
      label: 'validation',
      iteration: state.iteration,
      state: 'VALIDATING' as HarnessStatus,
    });

    return response.issues.map((i) => ({
      code: 'SEMANTIC_ISSUE',
      severity: i.severity,
      target: i.target,
      message: i.message,
    }));
  }
}
