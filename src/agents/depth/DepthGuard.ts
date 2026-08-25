import type { OntologyLimits } from '../../config/Config';
import type { DepthDecisionKind, EvidenceRequest } from '../../core/types';
import type { ExplorationState } from '../../exploration/ExplorationState';
import type { DepthDecisionResponse } from '../../schemas/llm';

/**
 * Chain of Responsibility over the depth decision.
 *
 * The model supplies judgement; these guards supply the constraints. Each is a
 * single named rule that may downgrade the decision and must say why, so the
 * reason a run stopped can be read off the decision itself rather than inferred
 * from a method that quietly rewrote it.
 *
 * Guards run in order and each sees the draft as the previous one left it.
 * A guard never *upgrades* a decision: STOP is terminal, and nothing here can
 * turn a model's decision into more work than it asked for.
 */

export interface DepthGuardContext {
  state: ExplorationState;
  limits: OntologyLimits;
  defaultSchema: string;
  /** the model's untouched reply, for guards that need the original claim */
  response: DepthDecisionResponse;
}

export interface DepthDecisionDraft {
  decision: DepthDecisionKind;
  currentDepth: number;
  targetDepth?: number;
  targetNodes: string[];
  requiredEvidence: EvidenceRequest[];
  /** requests that failed validation, reported rather than silently dropped */
  droppedEvidence: string[];
  /** what each guard changed, appended to the decision's reason */
  notes: string[];
}

export interface DepthGuard {
  readonly name: string;
  check(draft: DepthDecisionDraft, ctx: DepthGuardContext): void;
}

/**
 * Downgrades the draft and records why.
 *
 * STOP is terminal: once any guard has stopped exploration, a later guard
 * cannot restart it. Enforced here rather than left to each guard remembering,
 * because "the chain can only ever reduce work" is the property that makes the
 * order of guards safe to change.
 */
export function override(
  draft: DepthDecisionDraft,
  decision: DepthDecisionKind,
  note: string
): void {
  if (draft.decision === 'STOP') return;
  draft.decision = decision;
  draft.notes.push(note);
}

export class DepthDecisionPolicy {
  constructor(private readonly guards: DepthGuard[]) {}

  get names(): string[] {
    return this.guards.map((g) => g.name);
  }

  run(draft: DepthDecisionDraft, ctx: DepthGuardContext): DepthDecisionDraft {
    for (const guard of this.guards) guard.check(draft, ctx);
    return draft;
  }
}
