import { SemanticTier } from '../core/tiers';
import type { DepthState, Ontology } from '../core/types';
import { toId } from './Ontology';

/**
 * Derives per-node semantic depth from what the ontology actually contains.
 *
 * This is intentionally the ONLY place depth numbers come from. The LLM may
 * *request* a target depth, but it can never assert that a node has reached
 * one: depth is earned by adding real structure, not by claiming it.
 *
 * Rules, applied per node:
 *   ENTITY(1)       - the entity exists
 *   ATTRIBUTE(2)    - it has at least one attribute
 *   RELATIONSHIP(3) - it participates in at least one relationship
 *   CONCEPT(4)      - a concept is grounded in it (or the node IS a concept)
 *   METRIC(5)       - a metric is grounded in it (or the node IS a metric)
 *   EVENT(6)        - an event is grounded in it (or the node IS an event)
 *   RULE(7)         - a rule is grounded in it (or the node IS a rule)
 *
 * Grounding propagates one hop through `basedOn`, so a metric built on the
 * "revenue" concept lifts "revenue" to tier 5 while leaving unrelated
 * branches untouched. That asymmetry is the point.
 */
export function deriveDepthState(ontology: Ontology): DepthState {
  const depths: Record<string, number> = {};

  const bump = (id: string, tier: number) => {
    if (!id) return;
    depths[id] = Math.max(depths[id] ?? 0, tier);
  };

  for (const e of ontology.entities) {
    bump(e.id, SemanticTier.ENTITY);
    if (e.attributes.length > 0) bump(e.id, SemanticTier.ATTRIBUTE);
  }

  for (const r of ontology.relationships) {
    bump(toId(r.sourceEntity), SemanticTier.RELATIONSHIP);
    bump(toId(r.targetEntity), SemanticTier.RELATIONSHIP);
  }

  const lift = (
    holders: Array<{ id: string; basedOn: string[] }>,
    tier: SemanticTier
  ) => {
    for (const h of holders) {
      bump(h.id, tier);
      for (const base of h.basedOn) bump(toId(base), tier);
    }
  };

  lift(ontology.concepts, SemanticTier.CONCEPT);
  lift(ontology.metrics, SemanticTier.METRIC);
  lift(ontology.events, SemanticTier.EVENT);
  lift(ontology.rules, SemanticTier.RULE);

  const globalDepth = Object.values(depths).reduce(
    (max, d) => Math.max(max, d),
    ontology.entities.length ? SemanticTier.ENTITY : SemanticTier.DATASET
  );

  return {
    globalDepth,
    nodeDepths: depths,
    branchDepths: deriveBranchDepths(ontology, depths),
  };
}

/**
 * A branch is the connected component reachable from an entity through
 * relationships and `basedOn` grounding. Its depth is the deepest node in it,
 * which is what "the Revenue branch went to depth 5" actually means.
 */
export function deriveBranchDepths(
  ontology: Ontology,
  nodeDepths: Record<string, number>
): Record<string, number> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!a || !b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const id of Object.keys(nodeDepths)) {
    if (!adjacency.has(id)) adjacency.set(id, new Set());
  }
  for (const r of ontology.relationships) {
    link(toId(r.sourceEntity), toId(r.targetEntity));
  }
  for (const group of [
    ontology.concepts,
    ontology.metrics,
    ontology.events,
    ontology.rules,
  ]) {
    for (const item of group as Array<{ id: string; basedOn: string[] }>) {
      for (const base of item.basedOn) link(item.id, toId(base));
    }
  }

  const branchDepths: Record<string, number> = {};
  const seen = new Set<string>();

  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    const depth = component.reduce((max, id) => Math.max(max, nodeDepths[id] ?? 0), 0);
    for (const id of component) branchDepths[id] = depth;
  }

  return branchDepths;
}

export function formatDepths(state: DepthState): string {
  const entries = Object.entries(state.nodeDepths).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '  (no nodes yet)';
  return entries
    .map(([id, depth]) => `  ${id}: depth=${depth} branch=${state.branchDepths[id] ?? depth}`)
    .join('\n');
}
