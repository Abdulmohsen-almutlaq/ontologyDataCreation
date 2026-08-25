import type {
  Assertable,
  Ontology,
  ValidationIssue,
} from '../../core/types';
import { toId } from '../Ontology';

/**
 * Composite validator.
 *
 * Structural validation is a set of independent questions — are ids unique, do
 * relationships point somewhere real, is anything claimed as observed without an
 * observation. Each is one rule object, so a rule can be read, tested and
 * relaxed on its own, and a caller can compose a different set (the cycle rule
 * is opt-in for exactly this reason).
 */

export interface ValidationContext {
  /** assertions at or above this confidence must carry evidence */
  evidenceRequiredAbove: number;
  /** precomputed lookups, so rules do not each rebuild the same sets */
  index: OntologyIndex;
}

export interface ValidationRule {
  readonly name: string;
  check(ontology: Ontology, ctx: ValidationContext): ValidationIssue[];
}

export interface OntologyIndex {
  entityIds: Set<string>;
  /** every addressable node: entities, concepts, metrics, events, rules */
  nodeIds: Set<string>;
  relationshipIds: Set<string>;
}

export function buildIndex(o: Ontology): OntologyIndex {
  const entityIds = new Set(o.entities.map((e) => e.id));
  return {
    entityIds,
    nodeIds: new Set<string>([
      ...entityIds,
      ...o.concepts.map((c) => c.id),
      ...o.metrics.map((m) => m.id),
      ...o.events.map((e) => e.id),
      ...o.rules.map((r) => r.id),
    ]),
    relationshipIds: new Set(o.relationships.map((r) => r.id)),
  };
}

/* --------------------------------------------------------- issue helpers */

export function error(code: string, target: string, message: string): ValidationIssue {
  return { code, severity: 'error', target, message };
}

export function warning(code: string, target: string, message: string): ValidationIssue {
  return { code, severity: 'warning', target, message };
}

/**
 * The epistemic contract, checked wherever an assertion appears.
 *
 * Shared by several rules because it applies to every kind of node: an entity,
 * an attribute and a metric are all claims, and all three must pay for their
 * confidence with evidence.
 */
export function checkAssertion(
  assertion: Assertable,
  target: string,
  ctx: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (
    !Number.isFinite(assertion.confidence) ||
    assertion.confidence < 0 ||
    assertion.confidence > 1
  ) {
    issues.push(
      error(
        'INVALID_CONFIDENCE',
        target,
        `Confidence must be within [0,1], got ${assertion.confidence}`
      )
    );
  }

  if (assertion.status === 'OBSERVED' && assertion.evidence.length === 0) {
    issues.push(
      error(
        'UNSUPPORTED_CLAIM',
        target,
        'Status OBSERVED requires at least one piece of evidence'
      )
    );
  }

  if (assertion.evidence.length === 0 && assertion.confidence >= ctx.evidenceRequiredAbove) {
    issues.push(
      error(
        'MISSING_EVIDENCE',
        target,
        `Confidence ${assertion.confidence.toFixed(2)} >= ${ctx.evidenceRequiredAbove} requires evidence`
      )
    );
  }

  if (assertion.status === 'UNKNOWN' && assertion.confidence > 0.5) {
    issues.push(
      warning(
        'STATUS_CONFIDENCE_MISMATCH',
        target,
        'Status UNKNOWN with high confidence'
      )
    );
  }

  return issues;
}

/** Every node that carries `basedOn` grounding, with its label. */
export function groundedNodes(
  o: Ontology
): Array<{ item: Assertable & { id: string; basedOn: string[] }; kind: string }> {
  return [
    ...o.concepts.map((item) => ({ item, kind: 'Concept' })),
    ...o.metrics.map((item) => ({ item, kind: 'Metric' })),
    ...o.events.map((item) => ({ item, kind: 'Event' })),
    ...o.rules.map((item) => ({ item, kind: 'Rule' })),
  ];
}

/** Node ids that something else points at, by relationship or by grounding. */
export function connectedNodeIds(o: Ontology): Set<string> {
  const connected = new Set<string>();
  for (const r of o.relationships) {
    connected.add(toId(r.sourceEntity));
    connected.add(toId(r.targetEntity));
  }
  for (const { item } of groundedNodes(o)) {
    for (const base of item.basedOn) connected.add(toId(base));
  }
  return connected;
}
