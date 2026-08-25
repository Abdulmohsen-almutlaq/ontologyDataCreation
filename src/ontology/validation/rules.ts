import type { Ontology, ValidationIssue } from '../../core/types';
import { toId } from '../Ontology';
import {
  checkAssertion,
  connectedNodeIds,
  error,
  groundedNodes,
  warning,
  type ValidationRule,
} from './ValidationRule';

const CARDINALITIES = new Set([
  '1:1',
  '1:N',
  'N:1',
  'N:M',
  'M:N',
  'one-to-one',
  'one-to-many',
  'many-to-one',
  'many-to-many',
]);

export const duplicateNodeRule: ValidationRule = {
  name: 'duplicate-node',
  check(o) {
    const issues: ValidationIssue[] = [];
    const scan = (ids: string[], kind: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          issues.push(error('DUPLICATE_NODE', id, `Duplicate ${kind}: ${id}`));
        }
        seen.add(id);
      }
    };
    scan(o.entities.map((e) => e.id), 'entity');
    scan(o.concepts.map((c) => c.id), 'concept');
    scan(o.metrics.map((m) => m.id), 'metric');
    scan(o.events.map((e) => e.id), 'event');
    scan(o.rules.map((r) => r.id), 'rule');
    scan(o.relationships.map((r) => r.id), 'relationship');
    return issues;
  },
};

export const entityRule: ValidationRule = {
  name: 'entity-integrity',
  check(o, ctx) {
    const issues: ValidationIssue[] = [];
    for (const entity of o.entities) {
      issues.push(...checkAssertion(entity, entity.id, ctx));

      const seen = new Set<string>();
      for (const attribute of entity.attributes) {
        const target = `${entity.id}.${attribute.id}`;
        if (seen.has(attribute.id)) {
          issues.push(error('DUPLICATE_ATTRIBUTE', target, 'Duplicate attribute'));
        }
        seen.add(attribute.id);

        if (!attribute.name || !attribute.type) {
          issues.push(
            error('INVALID_ATTRIBUTE', target, 'Attribute requires name and type')
          );
        }
        if (attribute.entityId !== entity.id) {
          issues.push(
            error(
              'INVALID_ATTRIBUTE',
              target,
              'Attribute is attached to the wrong entity'
            )
          );
        }
        issues.push(
          ...checkAssertion(attribute, `${entity.id}.${attribute.name}`, ctx)
        );
      }
    }
    return issues;
  },
};

export const relationshipRule: ValidationRule = {
  name: 'relationship-integrity',
  check(o, ctx) {
    const issues: ValidationIssue[] = [];
    for (const r of o.relationships) {
      issues.push(...checkAssertion(r, r.id, ctx));

      if (!ctx.index.entityIds.has(toId(r.sourceEntity))) {
        issues.push(
          error(
            'MISSING_RELATIONSHIP_TARGET',
            r.id,
            `Unknown source entity "${r.sourceEntity}"`
          )
        );
      }
      if (!ctx.index.entityIds.has(toId(r.targetEntity))) {
        issues.push(
          error(
            'MISSING_RELATIONSHIP_TARGET',
            r.id,
            `Unknown target entity "${r.targetEntity}"`
          )
        );
      }
      if (r.cardinality && !CARDINALITIES.has(r.cardinality)) {
        issues.push(
          warning(
            'INVALID_CARDINALITY',
            r.id,
            `Unrecognised cardinality "${r.cardinality}"`
          )
        );
      }
    }
    return issues;
  },
};

/** Two relationships between the same pair cannot disagree about cardinality. */
export const contradictionRule: ValidationRule = {
  name: 'contradiction',
  check(o) {
    const issues: ValidationIssue[] = [];
    const byPair = new Map<string, string[]>();
    for (const r of o.relationships) {
      const key = `${toId(r.sourceEntity)}->${toId(r.targetEntity)}`;
      byPair.set(key, [...(byPair.get(key) ?? []), r.cardinality ?? '']);
    }
    for (const [key, cardinalities] of byPair) {
      const distinct = new Set(cardinalities.filter(Boolean));
      if (distinct.size > 1) {
        issues.push(
          error(
            'CONTRADICTORY_RELATIONSHIP',
            key,
            `Conflicting cardinalities declared: ${[...distinct].join(' vs ')}`
          )
        );
      }
    }
    return issues;
  },
};

/** Concepts, metrics, events and rules must rest on something real. */
export const groundingRule: ValidationRule = {
  name: 'grounding',
  check(o, ctx) {
    const issues: ValidationIssue[] = [];
    for (const { item, kind } of groundedNodes(o)) {
      issues.push(...checkAssertion(item, item.id, ctx));

      for (const base of item.basedOn) {
        if (!ctx.index.nodeIds.has(toId(base))) {
          issues.push(
            error(
              'UNGROUNDED_NODE',
              item.id,
              `${kind} refers to unknown node "${base}"`
            )
          );
        }
      }
      if (item.basedOn.length === 0) {
        issues.push(
          warning(
            'ORPHAN_NODE',
            item.id,
            `${kind} is not grounded in any entity or concept`
          )
        );
      }
    }
    return issues;
  },
};

/**
 * An entity connected to nothing is suspicious but not wrong: a genuine
 * standalone lookup table exists. A warning, never an error.
 */
export const orphanEntityRule: ValidationRule = {
  name: 'orphan-entity',
  check(o) {
    if (o.entities.length <= 1) return [];
    const connected = connectedNodeIds(o);
    return o.entities
      .filter((e) => !connected.has(e.id))
      .map((e) =>
        warning('ORPHAN_NODE', e.id, 'Entity has no relationships and grounds no concept')
      );
  },
};

export const uncertaintyRule: ValidationRule = {
  name: 'uncertainty-target',
  check(o, ctx) {
    return o.uncertain
      .filter(
        (u) =>
          !ctx.index.nodeIds.has(toId(u.targetId)) &&
          !ctx.index.relationshipIds.has(u.targetId)
      )
      .map((u) =>
        warning(
          'DANGLING_UNCERTAINTY',
          u.targetId,
          'Uncertainty mark targets an unknown node'
        )
      );
  },
};

/**
 * Opt-in: self-referential hierarchies (an employee managing an employee) are
 * legitimate, so cycles are permitted unless a caller says otherwise.
 */
export const acyclicRule: ValidationRule = {
  name: 'acyclic',
  check(o) {
    const cycle = findCycle(o);
    return cycle
      ? [error('ONTOLOGY_CYCLE', cycle.join(' -> '), 'Relationship cycle is not permitted')]
      : [];
  },
};

function findCycle(o: Ontology): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const r of o.relationships) {
    const source = toId(r.sourceEntity);
    adjacency.set(source, [...(adjacency.get(source) ?? []), toId(r.targetEntity)]);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];

  const visit = (node: string): string[] | null => {
    if (state.get(node) === 1) return [...path, node];
    if (state.get(node) === 2) return null;
    state.set(node, 1);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    state.set(node, 2);
    return null;
  };

  for (const node of adjacency.keys()) {
    const found = visit(node);
    if (found) return found;
  }
  return null;
}

/** Rules that always apply. `acyclicRule` is added only when cycles are barred. */
export const CORE_VALIDATION_RULES: ValidationRule[] = [
  duplicateNodeRule,
  entityRule,
  relationshipRule,
  contradictionRule,
  groundingRule,
  orphanEntityRule,
  uncertaintyRule,
];
