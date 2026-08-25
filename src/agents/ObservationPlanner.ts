import * as crypto from 'node:crypto';
import type { EvidenceRequest, HarnessStatus } from '../core/types';
import type { ExplorationState } from '../exploration/ExplorationState';
import { validateEvidenceRequest } from '../observation/ObservationExecutor';
import { jsonSchemas } from '../schemas';
import { ObservationPlanSchema } from '../schemas/llm';
import { BaseAgent } from './BaseAgent';
import { buildContext } from './context';

export interface ObservationPlanningContext {
  state: ExplorationState;
  focus: string[];
  defaultSchema: string;
  /** hard cap on requests returned from one planning pass */
  maxRequests?: number;
}

/**
 * Decides what to look at next.
 *
 * The model proposes observations; this class filters them to the ones that are
 * well-formed and worth spending budget on. Requests that fail target parsing
 * are dropped here rather than at execution time so a malformed plan costs
 * nothing.
 */
export class ObservationPlanner extends BaseAgent {
  readonly name = 'ObservationPlanner';

  async plan(context: ObservationPlanningContext): Promise<EvidenceRequest[]> {
    const { state, focus, defaultSchema } = context;

    const response = await this.reason({
      promptName: 'exploration/observation-planning',
      systemPromptName: 'system/base',
      variables: buildContext(state, { focus }),
      schema: ObservationPlanSchema,
      schemaName: 'ObservationPlan',
      jsonSchema: jsonSchemas.observationPlan,
      label: 'observation-planning',
      iteration: state.iteration,
      state: 'PLANNING_OBSERVATION' as HarnessStatus,
    });

    const out: EvidenceRequest[] = [];
    const seen = new Set<string>();

    for (const r of response.requests) {
      const request: EvidenceRequest = {
        id: `req_${crypto.randomBytes(4).toString('hex')}`,
        target: r.target,
        observationType: r.observationType,
        reason: r.reason,
        compareTo: r.compareTo,
        limit: r.limit,
      };
      if (validateEvidenceRequest(request, defaultSchema)) continue;
      const key = `${request.observationType}|${request.target}|${request.compareTo ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(request);
      if (out.length >= (context.maxRequests ?? 8)) break;
    }

    return out;
  }
}
