import * as crypto from 'node:crypto';
import { MAX_KNOWN_TIER } from '../../core/tiers';
import type { EvidenceRequest, Ontology } from '../../core/types';
import { validateEvidenceRequest } from '../../observation/ObservationExecutor';
import { toId } from '../../ontology/Ontology';
import { DepthDecisionPolicy, override, type DepthGuard } from './DepthGuard';

function knownNodeIds(o: Ontology): Set<string> {
  return new Set<string>([
    ...o.entities.map((e) => e.id),
    ...o.concepts.map((c) => c.id),
    ...o.metrics.map((m) => m.id),
    ...o.events.map((e) => e.id),
    ...o.rules.map((r) => r.id),
  ]);
}

/**
 * Deepening must point at something that exists.
 *
 * A model naming a node it invented is the most common way an ontology grows
 * without gaining meaning, and untargeted deepening — "expand everything" — is
 * how ontologies bloat. Without a real target there is nothing to deepen.
 */
export const phantomTargetGuard: DepthGuard = {
  name: 'phantom-target',
  check(draft, ctx) {
    const known = knownNodeIds(ctx.state.ontology);
    draft.targetNodes = [...new Set(ctx.response.targetNodes.map(toId))].filter((n) =>
      known.has(n)
    );

    if (draft.decision !== 'GO_DEEPER' || draft.targetNodes.length > 0) return;

    override(
      draft,
      'STOP',
      ctx.response.targetNodes.length
        ? `overridden to STOP: target nodes ${ctx.response.targetNodes.join(', ')} are not in the ontology`
        : 'overridden to STOP: GO_DEEPER named no target node'
    );
  },
};

/**
 * Expected value must exceed the complexity it buys.
 *
 * Guarding against over-engineering is the controller's whole purpose, so it
 * cannot be left to the model's own enthusiasm for its next idea.
 */
export const valueVersusCostGuard: DepthGuard = {
  name: 'value-versus-cost',
  check(draft, ctx) {
    if (draft.decision !== 'GO_DEEPER') return;
    if (ctx.response.expectedValue > ctx.response.complexityCost) return;

    override(
      draft,
      'STOP',
      `overridden to STOP: expected value ${ctx.response.expectedValue.toFixed(2)} ` +
        `does not exceed complexity cost ${ctx.response.complexityCost.toFixed(2)}`
    );
  },
};

/**
 * Evidence requests must be executable.
 *
 * Malformed targets are filtered here rather than at execution time, so a bad
 * plan costs no observation budget.
 */
export const evidenceRequestGuard: DepthGuard = {
  name: 'evidence-request',
  check(draft, ctx) {
    for (const request of ctx.response.requiredEvidence) {
      const candidate: EvidenceRequest = {
        id: `req_${crypto.randomBytes(4).toString('hex')}`,
        target: request.target,
        observationType: request.observationType,
        reason: request.reason,
        compareTo: request.compareTo,
        limit: request.limit,
      };
      const problem = validateEvidenceRequest(candidate, ctx.defaultSchema);
      if (problem) draft.droppedEvidence.push(`${request.target}: ${problem}`);
      else draft.requiredEvidence.push(candidate);
    }

    if (draft.decision === 'REQUEST_EVIDENCE' && draft.requiredEvidence.length === 0) {
      override(
        draft,
        'STOP',
        'overridden to STOP: REQUEST_EVIDENCE supplied no valid observation request'
      );
    }
  },
};

/**
 * Depth is bounded by configuration and by the tiers that exist.
 *
 * A request that is not actually deeper than the current state is a refinement
 * wearing the wrong label; treating it as deepening would spin the loop.
 */
export const depthCeilingGuard: DepthGuard = {
  name: 'depth-ceiling',
  check(draft, ctx) {
    if (draft.decision !== 'GO_DEEPER') return;

    const requested = draft.targetDepth ?? draft.currentDepth + 1;
    const capped = Math.min(requested, ctx.limits.maxDepth, MAX_KNOWN_TIER + 1);
    if (capped !== requested) {
      draft.notes.push(`target depth ${requested} capped to ${capped}`);
    }
    draft.targetDepth = capped;

    if (capped <= draft.currentDepth) {
      override(
        draft,
        'REFINE_CURRENT',
        'target depth is not deeper than current depth; refining instead'
      );
    }
  },
};

/** Reports requests that were discarded, so a bad plan is visible in the trace. */
export const evidenceDiagnosticsGuard: DepthGuard = {
  name: 'evidence-diagnostics',
  check(draft) {
    if (!draft.droppedEvidence.length) return;
    draft.notes.push(
      `dropped invalid evidence requests: ${draft.droppedEvidence.join('; ')}`
    );
  },
};

/**
 * Order matters: targets are resolved before they can be judged, evidence is
 * validated before the decision that depends on it, and the ceiling applies
 * only to a decision that survived everything above it.
 */
export function defaultDepthPolicy(): DepthDecisionPolicy {
  return new DepthDecisionPolicy([
    phantomTargetGuard,
    valueVersusCostGuard,
    evidenceRequestGuard,
    depthCeilingGuard,
    evidenceDiagnosticsGuard,
  ]);
}
