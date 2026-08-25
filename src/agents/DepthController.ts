import { defaultDepthPolicy } from './depth';
import type { DepthDecisionPolicy } from './depth';
import type { OntologyLimits } from '../config/Config';
import type { DepthDecision, HarnessStatus } from '../core/types';
import type { ExplorationState } from '../exploration/ExplorationState';
import { jsonSchemas } from '../schemas';
import { DepthDecisionSchema, type DepthDecisionResponse } from '../schemas/llm';
import { BaseAgent, type AgentDeps } from './BaseAgent';
import { buildContext } from './context';

export interface DepthContext {
  state: ExplorationState;
  limits: OntologyLimits;
  defaultSchema: string;
}

/**
 * The authority on whether exploration continues.
 *
 * The model supplies the judgement — is anything important still unknown, and
 * is knowing it worth the added complexity — and TypeScript supplies the
 * constraints, as an ordered chain of named guards (see ./depth/guards).
 *
 * One thing is never negotiable and never delegated: `currentDepth` comes from
 * the derived depth state, not from the reply. The model may ask to reach a
 * tier; it can never assert that a node is already there.
 */
export class DepthController extends BaseAgent {
  readonly name = 'DepthController';

  constructor(
    deps: AgentDeps,
    private readonly policy: DepthDecisionPolicy = defaultDepthPolicy()
  ) {
    super(deps);
  }

  /** Guards applied to every decision, in order. */
  get guards(): string[] {
    return this.policy.names;
  }

  async decide(context: DepthContext): Promise<DepthDecision> {
    const { state } = context;

    const response = await this.reason<DepthDecisionResponse>({
      promptName: 'exploration/depth-decision',
      systemPromptName: 'system/base',
      variables: buildContext(state, { limits: context.limits }),
      schema: DepthDecisionSchema,
      schemaName: 'DepthDecision',
      jsonSchema: jsonSchemas.depthDecision,
      label: 'depth-decision',
      iteration: state.iteration,
      state: 'DECIDING_DEPTH' as HarnessStatus,
    });

    return this.constrain(response, context);
  }

  /** Runs the guard chain over a raw model reply. */
  constrain(response: DepthDecisionResponse, context: DepthContext): DepthDecision {
    const draft = this.policy.run(
      {
        decision: response.decision,
        // Derived, never read from the reply: depth is earned by structure.
        currentDepth: context.state.depth.globalDepth,
        targetDepth: response.targetDepth,
        targetNodes: [],
        requiredEvidence: [],
        droppedEvidence: [],
        notes: [],
      },
      { ...context, response }
    );

    return {
      decision: draft.decision,
      currentDepth: draft.currentDepth,
      targetDepth: draft.targetDepth,
      targetNodes: draft.targetNodes,
      reason: draft.notes.length
        ? `${response.reason} [${draft.notes.join('; ')}]`
        : response.reason,
      expectedValue: response.expectedValue,
      expectedInformationGain: response.expectedInformationGain,
      uncertainty: response.uncertainty,
      complexityCost: response.complexityCost,
      nextFocus: response.nextFocus,
      requiredEvidence: draft.requiredEvidence,
    };
  }
}
