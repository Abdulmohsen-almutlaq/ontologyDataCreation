import * as crypto from 'node:crypto';
import type {
  AssertionStatus,
  Evidence,
  EvidenceRequest,
  Ontology,
  OntologyOperationType,
  SourceReference,
} from '../../core/types';
import type { OperationInput } from '../../schemas/llm';

/**
 * Command-handler dispatch for ontology operations.
 *
 * Operations are Commands: the reasoning layer emits them, and the engine
 * decides how — and whether — each is carried out. One handler per operation
 * type replaces a single 13-case switch, so a new operation is a new file plus
 * a registration line rather than another branch in a method nobody wants to
 * touch.
 *
 * Handlers may mutate the candidate ontology and report a rejection. They must
 * NOT validate or commit: atomicity (clone → apply → validate → commit or roll
 * back) belongs to OntologyEngine.apply and is meaningless if a handler can
 * decide for itself that the batch is acceptable.
 */

/** Narrows the operation union to the single member a handler owns. */
export type OperationOf<T extends OntologyOperationType> = Extract<
  OperationInput,
  { type: T }
>;

export interface OperationRejection {
  code: string;
  reason: string;
}

/** `null` means the operation was applied. */
export type HandlerResult = OperationRejection | null;

export interface OperationHandler<T extends OntologyOperationType = OntologyOperationType> {
  readonly type: T;
  apply(operation: OperationOf<T>, batch: ApplyBatch): HandlerResult;
}

/** A handler erased to the union, as stored in the registry. */
export type AnyOperationHandler = {
  readonly type: OntologyOperationType;
  apply(operation: OperationInput, batch: ApplyBatch): HandlerResult;
};

/**
 * Registers a handler for one operation type.
 *
 * The single cast in this function is what keeps every handler body strongly
 * typed against its own union member: `type` and the callback's parameter are
 * bound to the same literal T, so the map lookup in the engine cannot route an
 * operation to the wrong handler without a compile error at registration.
 */
export function defineHandler<T extends OntologyOperationType>(
  type: T,
  apply: (operation: OperationOf<T>, batch: ApplyBatch) => HandlerResult
): AnyOperationHandler {
  return {
    type,
    apply: (operation, batch) => apply(operation as OperationOf<T>, batch),
  };
}

export const applied: HandlerResult = null;

export function rejected(code: string, reason: string): OperationRejection {
  return { code, reason };
}

/* ------------------------------------------------------------- context */

export interface EvidenceRef {
  locator: string;
  summary?: string;
  status?: AssertionStatus;
  observationId?: string;
}

export interface SourceRef {
  locator: string;
  kind?: SourceReference['kind'];
}

/** The shape a grounding check cares about, whatever carries it. */
export interface GroundedAssertion {
  status?: AssertionStatus;
  confidence?: number;
  evidence?: unknown[];
}

/**
 * Everything a handler is allowed to touch during one batch.
 *
 * Passed explicitly rather than closed over, so a handler can be constructed
 * and tested on its own instead of only through the engine.
 */
export interface ApplyBatch {
  /** the candidate ontology; handlers mutate this, never the live one */
  readonly ontology: Ontology;
  readonly iteration: number;
  /** confidence at or above which an assertion must carry evidence */
  readonly evidenceThreshold: number;

  /** Queues an observation request; does not mutate the ontology. */
  requestObservation(request: Omit<EvidenceRequest, 'id'>): void;

  evidence(refs: EvidenceRef[] | undefined): Evidence[];
  sources(refs: SourceRef[] | undefined): SourceReference[];

  /**
   * The epistemic contract, checked before anything is written: inference must
   * never be recorded as observation, and confidence must be paid for with
   * evidence. Returns a reason when the assertion breaks it.
   */
  groundingProblem(assertion: GroundedAssertion): string | null;
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}${counter}`;
}

export class ApplyBatchContext implements ApplyBatch {
  readonly requests: EvidenceRequest[] = [];

  constructor(
    readonly ontology: Ontology,
    readonly iteration: number,
    readonly evidenceThreshold: number
  ) {}

  requestObservation(request: Omit<EvidenceRequest, 'id'>): void {
    this.requests.push({ ...request, id: newId('req') });
  }

  evidence(refs: EvidenceRef[] | undefined): Evidence[] {
    return (refs ?? []).map((r) => ({
      id: newId('ev'),
      locator: r.locator,
      summary: r.summary ?? '',
      status: r.status ?? 'OBSERVED',
      observationId: r.observationId,
      createdAtIteration: this.iteration,
    }));
  }

  sources(refs: SourceRef[] | undefined): SourceReference[] {
    return (refs ?? []).map((r) => ({ locator: r.locator, kind: r.kind ?? 'other' }));
  }

  groundingProblem(assertion: GroundedAssertion): string | null {
    const evidence = assertion.evidence ?? [];
    if (assertion.status === 'OBSERVED' && evidence.length === 0) {
      return 'status OBSERVED requires evidence';
    }
    if (
      typeof assertion.confidence === 'number' &&
      assertion.confidence >= this.evidenceThreshold &&
      evidence.length === 0
    ) {
      return `confidence ${assertion.confidence} requires evidence (threshold ${this.evidenceThreshold})`;
    }
    return null;
  }
}

/* ------------------------------------------------------------ registry */

export class OperationRegistry {
  private readonly handlers = new Map<OntologyOperationType, AnyOperationHandler>();

  register(handler: AnyOperationHandler): this {
    this.handlers.set(handler.type, handler);
    return this;
  }

  registerAll(handlers: AnyOperationHandler[]): this {
    for (const handler of handlers) this.register(handler);
    return this;
  }

  handlerFor(type: OntologyOperationType): AnyOperationHandler | undefined {
    return this.handlers.get(type);
  }

  supportedTypes(): OntologyOperationType[] {
    return [...this.handlers.keys()].sort();
  }
}
