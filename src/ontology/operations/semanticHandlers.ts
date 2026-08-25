import type { AssertionStatus, Ontology, OntologyOperationType } from '../../core/types';
import { findConcept, toId } from '../Ontology';
import {
  applied,
  defineHandler,
  rejected,
  type AnyOperationHandler,
  type ApplyBatch,
  type OperationOf,
} from './OperationHandler';

/** Nodes that are not physical objects: concepts, metrics, events and rules. */
type GroundedNodeType = 'ADD_CONCEPT' | 'ADD_METRIC' | 'ADD_EVENT' | 'ADD_RULE';

interface GroundedNode {
  id: string;
  name: string;
  description: string;
  basedOn: string[];
}

/**
 * The fields all four operations share. TypeScript cannot see a common shape
 * across `OperationOf<T>` while T is still generic, so the shared steps read
 * the operation through this view; `place` receives the properly narrowed
 * operation, which is where the variant fields need real typing.
 */
interface GroundedNodeOperation {
  name: string;
  description: string;
  basedOn: string[];
  status: AssertionStatus;
  confidence: number;
  evidence: Array<{ locator: string; summary: string; status: AssertionStatus }>;
  source: Array<{ locator: string; kind: 'table' | 'column' | 'constraint' | 'index' | 'dataset' | 'other' }>;
}

function knownNodeIds(ontology: Ontology): Set<string> {
  return new Set([
    ...ontology.entities.map((e) => e.id),
    ...ontology.concepts.map((c) => c.id),
    ...ontology.metrics.map((m) => m.id),
    ...ontology.events.map((e) => e.id),
    ...ontology.rules.map((r) => r.id),
  ]);
}

/**
 * Template Method for the four "meaning" operations.
 *
 * They share an identical contract — grounded in evidence, uniquely named,
 * every `basedOn` reference resolvable — and differ only in which collection
 * they land in and which extra fields they carry. The shared steps live here;
 * `place` supplies the variant part.
 */
function defineGroundedNodeHandler<T extends GroundedNodeType>(
  type: T,
  collectionOf: (ontology: Ontology) => Array<{ id: string }>,
  place: (base: GroundedNode & Record<string, unknown>, op: OperationOf<T>, ontology: Ontology) => void
): AnyOperationHandler {
  return defineHandler(type, (op, batch: ApplyBatch) => {
    const spec = op as unknown as GroundedNodeOperation;
    const problem = batch.groundingProblem(spec);
    if (problem) return rejected('UNSUPPORTED_CLAIM', problem);

    const id = toId(spec.name);
    if (collectionOf(batch.ontology).some((x) => x.id === id)) {
      return rejected('DUPLICATE_NODE', `"${spec.name}" already exists`);
    }

    // A concept floating free of the data it describes is vocabulary, not
    // meaning. Every reference must resolve to a node that already exists.
    const known = knownNodeIds(batch.ontology);
    const unresolved = spec.basedOn.map(toId).filter((b) => !known.has(b));
    if (unresolved.length) {
      return rejected(
        'UNGROUNDED_NODE',
        `basedOn refers to unknown nodes: ${unresolved.join(', ')}`
      );
    }

    place(
      {
        id,
        name: spec.name,
        description: spec.description,
        basedOn: spec.basedOn.map(toId),
        status: spec.status,
        confidence: spec.confidence,
        evidence: batch.evidence(spec.evidence),
        source: batch.sources(spec.source),
      },
      op,
      batch.ontology
    );
    return applied;
  });
}

export const addConceptHandler = defineGroundedNodeHandler(
  'ADD_CONCEPT',
  (o) => o.concepts,
  (base, _op, o) => o.concepts.push(base as never)
);

export const addMetricHandler = defineGroundedNodeHandler(
  'ADD_METRIC',
  (o) => o.metrics,
  (base, op, o) =>
    o.metrics.push({ ...base, definition: op.definition, unit: op.unit } as never)
);

export const addEventHandler = defineGroundedNodeHandler(
  'ADD_EVENT',
  (o) => o.events,
  (base, _op, o) => o.events.push(base as never)
);

export const addRuleHandler = defineGroundedNodeHandler(
  'ADD_RULE',
  (o) => o.rules,
  (base, op, o) => o.rules.push({ ...base, expression: op.expression } as never)
);

export const mergeConceptHandler = defineHandler('MERGE_CONCEPT', (op, batch) => {
  const from = findConcept(batch.ontology, op.from);
  const into = findConcept(batch.ontology, op.into);
  if (!from || !into) {
    return rejected('UNKNOWN_NODE', `Both concepts must exist: ${op.from}, ${op.into}`);
  }
  if (from.id === into.id) {
    return rejected('INVALID_MERGE', 'Cannot merge a concept into itself');
  }

  into.basedOn = [...new Set([...into.basedOn, ...from.basedOn])];
  into.evidence.push(...from.evidence);
  into.source.push(...from.source);
  into.confidence = Math.max(into.confidence, from.confidence);
  if (from.description && !into.description.includes(from.description)) {
    into.description = `${into.description} ${from.description}`.trim();
  }

  batch.ontology.concepts = batch.ontology.concepts.filter((c) => c.id !== from.id);

  // Re-point anything grounded in the merged-away concept, otherwise the merge
  // leaves dangling references the validator would reject.
  const groups: Array<Array<{ basedOn: string[] }>> = [
    batch.ontology.concepts,
    batch.ontology.metrics,
    batch.ontology.events,
    batch.ontology.rules,
  ];
  for (const group of groups) {
    for (const item of group) {
      item.basedOn = [...new Set(item.basedOn.map((b) => (b === from.id ? into.id : b)))];
    }
  }
  return applied;
});

export const semanticHandlers: AnyOperationHandler[] = [
  addConceptHandler,
  addMetricHandler,
  addEventHandler,
  addRuleHandler,
  mergeConceptHandler,
];

export const GROUNDED_NODE_TYPES: OntologyOperationType[] = [
  'ADD_CONCEPT',
  'ADD_METRIC',
  'ADD_EVENT',
  'ADD_RULE',
];
