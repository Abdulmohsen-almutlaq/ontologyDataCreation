import type { OntologyLimits } from '../config/Config';
import type { TerminationReason } from './types';

export class BudgetExceededError extends Error {
  constructor(readonly reason: TerminationReason, message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Hard limits enforced in TypeScript, never delegated to the model.
 *
 * Every correction retry counts as an LLM call: otherwise ONTOLOGY_MAX_LLM_CALLS
 * would understate real spend by however many times a model produced malformed
 * output.
 */
export class Budget {
  llmCalls = 0;
  observationRequests = 0;
  iterations = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly limits: OntologyLimits) {}

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  countLLMCall(): void {
    this.llmCalls += 1;
  }

  countObservationRequest(n = 1): void {
    this.observationRequests += n;
  }

  countIteration(): void {
    this.iterations += 1;
  }

  /** Returns the limit that has been reached, or null if there is room left. */
  exceeded(nodeCount: number, depth: number): TerminationReason | null {
    if (this.iterations >= this.limits.maxIterations) return 'MAX_ITERATIONS';
    if (this.llmCalls >= this.limits.maxLLMCalls) return 'MAX_LLM_CALLS';
    if (this.observationRequests >= this.limits.maxObservationRequests)
      return 'MAX_OBSERVATION_REQUESTS';
    if (nodeCount >= this.limits.maxNodes) return 'MAX_NODES';
    if (depth >= this.limits.maxDepth) return 'MAX_DEPTH';
    if (this.elapsedMs >= this.limits.maxRuntimeMs) return 'MAX_RUNTIME';
    return null;
  }

  assertLLMBudget(): void {
    if (this.llmCalls >= this.limits.maxLLMCalls) {
      throw new BudgetExceededError(
        'MAX_LLM_CALLS',
        `LLM call budget exhausted (${this.limits.maxLLMCalls})`
      );
    }
  }

  assertObservationBudget(): void {
    if (this.observationRequests >= this.limits.maxObservationRequests) {
      throw new BudgetExceededError(
        'MAX_OBSERVATION_REQUESTS',
        `Observation budget exhausted (${this.limits.maxObservationRequests})`
      );
    }
  }

  snapshot() {
    return {
      llmCalls: this.llmCalls,
      observationRequests: this.observationRequests,
      iterations: this.iterations,
      elapsedMs: this.elapsedMs,
    };
  }
}
