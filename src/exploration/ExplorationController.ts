import { SemanticTier } from '../core/tiers';
import type {
  DepthDecision,
  EvidenceRequest,
  ExplorationAction,
  Observation,
} from '../core/types';
import type { ConceptAgent } from '../agents/ConceptAgent';
import type { ObservationPlanner } from '../agents/ObservationPlanner';
import type { OntologyAgent } from '../agents/OntologyAgent';
import type { RefinementAgent } from '../agents/RefinementAgent';
import type { RelationshipAgent } from '../agents/RelationshipAgent';
import type { OntologyEngine } from '../ontology/OntologyEngine';
import type { ObservationExecutor } from '../observation/ObservationExecutor';
import type { OperationsResponse } from '../schemas/llm';
import type { Trace } from '../trace/Trace';
import { refreshNodeSets, type ExplorationState } from './ExplorationState';

export interface ExplorationAgents {
  ontology: OntologyAgent;
  relationship: RelationshipAgent;
  concept: ConceptAgent;
  refinement: RefinementAgent;
  planner: ObservationPlanner;
}

export interface ExplorationControllerOptions {
  agents: ExplorationAgents;
  engine: OntologyEngine;
  observations: ExecutorLike;
  trace: Trace;
  defaultSchema: string;
  maxRequestsPerStep?: number;
}

type ExecutorLike = Pick<ObservationExecutor, 'run' | 'executedKeys'>;

export interface StepOutcome {
  action: ExplorationAction;
  operationsApplied: number;
  operationsRejected: number;
  newObservations: number;
  rolledBack: boolean;
}

/**
 * Executes one exploration step once the depth controller has decided what to
 * do. Deliberately narrow: it gathers evidence for the chosen targets, routes
 * reasoning to the agent that matches the requested depth, and commits the
 * resulting operations through the engine.
 *
 * Routing by target tier is what keeps exploration targeted. Asking the concept
 * agent to deepen "Revenue" does not touch Customer or Product, so their
 * branches stay at the depth they earned.
 */
export class ExplorationController {
  constructor(private readonly options: ExplorationControllerOptions) {}

  async execute(
    state: ExplorationState,
    decision: DepthDecision
  ): Promise<StepOutcome> {
    const previousDepth = state.depth.globalDepth;
    const focus = decision.targetNodes ?? [];
    const action = this.actionFor(decision);

    /* ---- 1. gather evidence for the focused targets ---- */
    let requests: EvidenceRequest[] = decision.requiredEvidence ?? [];
    if (requests.length === 0 && action !== 'REFINE') {
      requests = await this.options.agents.planner.plan({
        state,
        focus,
        defaultSchema: this.options.defaultSchema,
        maxRequests: this.options.maxRequestsPerStep ?? 6,
      });
    }

    const fresh = await this.runObservations(state, requests);

    /* ---- 2. reason over the focused slice ---- */
    const response = await this.reasonFor(decision, state, fresh);

    /* ---- 3. commit through the engine ---- */
    const result = this.options.engine.apply(state.ontology, response.operations, {
      iteration: state.iteration,
    });

    state.ontology = result.ontology;
    state.depth = result.depth;
    state.lastValidation = result.validation;

    this.options.trace.record({
      iteration: state.iteration,
      state: 'BUILDING',
      agent: 'ExplorationController',
      ontologyOperations: {
        applied: result.applied.length,
        rejected: result.rejected,
        rolledBack: result.rolledBack,
      },
      observationsRequested: requests,
      observationsReturned: fresh.map((o) => ({ id: o.id, ok: o.ok, target: o.target })),
      validation: result.validation,
      depthDecision: decision,
      durationMs: 0,
    });

    /* ---- 4. queue any observations the model asked for mid-reasoning ---- */
    state.pendingEvidence = result.evidenceRequests;

    for (const node of focus) state.exploredNodes.add(node);
    refreshNodeSets(state);

    state.explorationHistory.push({
      iteration: state.iteration,
      action,
      targetNodes: focus,
      previousDepth,
      resultingDepth: state.depth.globalDepth,
      reason: decision.reason,
      evidenceUsed: fresh.map((o) => o.id),
      ontologyChanges: result.applied,
      confidence: response.confidence,
    });

    return {
      action,
      operationsApplied: result.applied.length,
      operationsRejected: result.rejected.length,
      newObservations: fresh.length,
      rolledBack: result.rolledBack,
    };
  }

  async runObservations(
    state: ExplorationState,
    requests: EvidenceRequest[]
  ): Promise<Observation[]> {
    const fresh: Observation[] = [];
    for (const request of requests) {
      const before = this.options.observations.executedKeys.length;
      const observation = await this.options.observations.run(request, state.iteration);
      const isNew = this.options.observations.executedKeys.length > before;
      if (isNew) {
        state.observations.push(observation);
        fresh.push(observation);
      }
    }
    return fresh;
  }

  private actionFor(decision: DepthDecision): ExplorationAction {
    switch (decision.decision) {
      case 'GO_DEEPER':
        return 'EXPAND';
      case 'REFINE_CURRENT':
        return 'REFINE';
      case 'REQUEST_EVIDENCE':
        return 'OBSERVE';
      default:
        return 'STOP';
    }
  }

  /**
   * Routes to the agent that owns the requested tier. Depth is not one agent
   * being asked to "try harder": tier 3 is a relationship question, tier 4+ is
   * a business-meaning question, and they need different prompts.
   */
  private async reasonFor(
    decision: DepthDecision,
    state: ExplorationState,
    fresh: Observation[]
  ): Promise<OperationsResponse> {
    const options = {
      focus: decision.targetNodes ?? [],
      observations: fresh.length ? fresh : state.observations.slice(-6),
    };
    const agents = this.options.agents;

    if (decision.decision === 'REFINE_CURRENT') {
      return agents.refinement.propose(state, options);
    }

    const target = decision.targetDepth ?? state.depth.globalDepth + 1;
    if (target <= SemanticTier.ATTRIBUTE) return agents.ontology.propose(state, options);
    if (target === SemanticTier.RELATIONSHIP) {
      return agents.relationship.propose(state, options);
    }
    return agents.concept.propose(state, options);
  }
}
