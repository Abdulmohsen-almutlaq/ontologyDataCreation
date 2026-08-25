import type {
  DepthState,
  EvidenceRequest,
  Ontology,
  ValidationResult,
} from '../core/types';
import type { OperationInput } from '../schemas/llm';
import { deriveDepthState } from './depth';
import { cloneOntology } from './Ontology';
import { OntologyValidator } from './OntologyValidator';
import {
  ApplyBatchContext,
  defaultOperationRegistry,
  type OperationRegistry,
} from './operations';

export interface RejectedOperation {
  operation: OperationInput;
  code: string;
  reason: string;
}

export interface ApplyResult {
  /** the ontology to keep: the updated one, or the original if the batch was rejected */
  ontology: Ontology;
  applied: OperationInput[];
  rejected: RejectedOperation[];
  /** observation requests extracted from REQUEST_OBSERVATION operations */
  evidenceRequests: EvidenceRequest[];
  validation: ValidationResult;
  /** true when validation failed and the whole batch was rolled back */
  rolledBack: boolean;
  depth: DepthState;
}

export interface ApplyContext {
  iteration: number;
  /** confidence at or above which an assertion must carry evidence */
  evidenceRequiredAbove?: number;
}

const DEFAULT_EVIDENCE_THRESHOLD = 0.7;

/**
 * Applies model-proposed operations to the ontology.
 *
 * The reasoning layer never mutates state directly; it emits operations, and
 * this engine decides what is legal. Individual operations are carried out by
 * registered handlers (see ./operations), which leaves this class responsible
 * for the one thing that cannot be delegated: **atomicity**.
 *
 *   clone -> let handlers mutate the copy -> validate the candidate
 *         -> commit, or discard the whole batch
 *
 * A batch that would leave the ontology inconsistent is rejected in full and
 * the live ontology is returned untouched. That guarantee is why handlers get
 * no access to the validator and cannot commit: if any one of them could decide
 * a result was acceptable, the guarantee would be gone.
 */
export class OntologyEngine {
  constructor(
    private readonly validator: OntologyValidator,
    private readonly registry: OperationRegistry = defaultOperationRegistry()
  ) {}

  /** Operation types this engine will carry out. */
  supportedOperations(): string[] {
    return this.registry.supportedTypes();
  }

  apply(
    ontology: Ontology,
    operations: OperationInput[],
    ctx: ApplyContext
  ): ApplyResult {
    const batch = new ApplyBatchContext(
      cloneOntology(ontology),
      ctx.iteration,
      ctx.evidenceRequiredAbove ?? DEFAULT_EVIDENCE_THRESHOLD
    );

    const applied: OperationInput[] = [];
    const rejected: RejectedOperation[] = [];

    for (const operation of operations) {
      const handler = this.registry.handlerFor(operation.type);
      if (!handler) {
        rejected.push({
          operation,
          code: 'UNSUPPORTED_OPERATION',
          reason: `No handler registered for "${operation.type}"`,
        });
        continue;
      }
      try {
        const rejection = handler.apply(operation, batch);
        if (rejection) rejected.push({ operation, ...rejection });
        else applied.push(operation);
      } catch (err) {
        // A handler throwing is a bug, not a refusal: it must not take the run
        // down mid-batch, and the validator still guards the result.
        rejected.push({
          operation,
          code: 'APPLY_ERROR',
          reason: (err as Error).message,
        });
      }
    }

    const validation = this.validator.validate(batch.ontology);
    if (!validation.valid) {
      return this.rollback(ontology, rejected, applied, validation);
    }

    return {
      ontology: batch.ontology,
      applied,
      rejected,
      evidenceRequests: batch.requests,
      validation,
      rolledBack: false,
      // Depth is recomputed from the committed ontology, never taken from the LLM.
      depth: deriveDepthState(batch.ontology),
    };
  }

  /** An invalid candidate never becomes live state. */
  private rollback(
    original: Ontology,
    rejected: RejectedOperation[],
    wouldHaveApplied: OperationInput[],
    validation: ValidationResult
  ): ApplyResult {
    return {
      ontology: original,
      applied: [],
      rejected: [
        ...rejected,
        ...wouldHaveApplied.map((operation) => ({
          operation,
          code: 'BATCH_ROLLED_BACK',
          reason: 'Batch discarded because the resulting ontology failed validation',
        })),
      ],
      evidenceRequests: [],
      validation,
      rolledBack: true,
      depth: deriveDepthState(original),
    };
  }
}
