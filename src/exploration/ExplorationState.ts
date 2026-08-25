import type {
  DepthDecision,
  DepthState,
  EvidenceRequest,
  ExplorationStep,
  Gap,
  HarnessStatus,
  Observation,
  Ontology,
  TerminationReason,
  ValidationResult,
} from '../core/types';
import { emptyOntology } from '../ontology/Ontology';

export interface ExplorationState {
  runId: string;
  status: HarnessStatus;
  terminationReason?: TerminationReason;

  ontology: Ontology;
  depth: DepthState;

  /** node ids that have been the target of at least one exploration step */
  exploredNodes: Set<string>;
  /** node ids that exist but have never been targeted */
  unexploredNodes: Set<string>;

  unresolvedGaps: Gap[];
  pendingEvidence: EvidenceRequest[];
  observations: Observation[];

  explorationHistory: ExplorationStep[];
  decisions: DepthDecision[];
  lastValidation?: ValidationResult;

  iteration: number;
  llmCalls: number;
  observationRequests: number;
}

export function createState(runId: string, datasetName: string): ExplorationState {
  return {
    runId,
    status: 'INITIALIZING',
    ontology: emptyOntology(datasetName),
    depth: { globalDepth: 0, nodeDepths: {}, branchDepths: {} },
    exploredNodes: new Set(),
    unexploredNodes: new Set(),
    unresolvedGaps: [],
    pendingEvidence: [],
    observations: [],
    explorationHistory: [],
    decisions: [],
    iteration: 0,
    llmCalls: 0,
    observationRequests: 0,
  };
}

/**
 * Stall detection.
 *
 * "The loop must not continue simply because another iteration is possible."
 * Max-iterations alone does not deliver that: a model that keeps answering
 * GO_DEEPER on an unchanged node will happily burn the entire budget. A turn
 * that neither changed the ontology nor produced new evidence, or a decision
 * that repeats a previous (decision, targets, evidence) signature, means the
 * loop has stopped learning.
 */
export function decisionSignature(decision: DepthDecision): string {
  const nodes = [...(decision.targetNodes ?? [])].sort().join(',');
  const evidence = [...(decision.requiredEvidence ?? [])]
    .map((e) => `${e.observationType}:${e.target}:${e.compareTo ?? ''}`)
    .sort()
    .join(',');
  // targetDepth is part of the signature: deepening `revenue` to tier 4 and
  // then to tier 5 is progress, not a repeat.
  return `${decision.decision}|${decision.targetDepth ?? ''}|${nodes}|${evidence}`;
}

export interface StallInput {
  operationsApplied: number;
  newObservations: number;
  signature: string;
  previousSignatures: string[];
}

export function detectStall(input: StallInput): string | null {
  if (input.previousSignatures.includes(input.signature)) {
    return `Decision signature "${input.signature}" repeats an earlier iteration`;
  }
  if (input.operationsApplied === 0 && input.newObservations === 0) {
    return 'Iteration applied no operations and gathered no new evidence';
  }
  return null;
}

export function refreshNodeSets(state: ExplorationState): void {
  const ids = [
    ...state.ontology.entities.map((e) => e.id),
    ...state.ontology.concepts.map((c) => c.id),
    ...state.ontology.metrics.map((m) => m.id),
    ...state.ontology.events.map((e) => e.id),
    ...state.ontology.rules.map((r) => r.id),
  ];
  state.unexploredNodes = new Set(ids.filter((id) => !state.exploredNodes.has(id)));
}

export function formatHistory(history: ExplorationStep[], limit = 10): string {
  if (!history.length) return '  (first iteration)';
  return history
    .slice(-limit)
    .map(
      (s) =>
        `  #${s.iteration} ${s.action} [${s.targetNodes.join(', ') || 'all'}] ` +
        `depth ${s.previousDepth} -> ${s.resultingDepth}: ${s.reason}`
    )
    .join('\n');
}

export function formatGaps(gaps: Gap[]): string {
  if (!gaps.length) return '  (none)';
  return gaps
    .map((g) => `  - [${g.severity}] ${g.type} @ ${g.target}: ${g.reason}`)
    .join('\n');
}
