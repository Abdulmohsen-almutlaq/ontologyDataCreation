import type {
  Concept,
  Entity,
  Metric,
  Ontology,
  OntologyEvent,
  Relationship,
  Rule,
} from '../core/types';

/** Names are the LLM-facing identity; ids are their normalised form. */
export function toId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function emptyOntology(datasetName: string, description = ''): Ontology {
  return {
    id: toId(datasetName) || 'dataset',
    datasetName,
    datasetDescription: description,
    entities: [],
    relationships: [],
    concepts: [],
    metrics: [],
    events: [],
    rules: [],
    uncertain: [],
  };
}

export function cloneOntology(o: Ontology): Ontology {
  return structuredClone(o);
}

export function findEntity(o: Ontology, nameOrId: string): Entity | undefined {
  const id = toId(nameOrId);
  return o.entities.find((e) => e.id === id);
}

export function findConcept(o: Ontology, nameOrId: string): Concept | undefined {
  const id = toId(nameOrId);
  return o.concepts.find((c) => c.id === id);
}

export function findMetric(o: Ontology, nameOrId: string): Metric | undefined {
  const id = toId(nameOrId);
  return o.metrics.find((m) => m.id === id);
}

export function findEvent(o: Ontology, nameOrId: string): OntologyEvent | undefined {
  const id = toId(nameOrId);
  return o.events.find((e) => e.id === id);
}

export function findRule(o: Ontology, nameOrId: string): Rule | undefined {
  const id = toId(nameOrId);
  return o.rules.find((r) => r.id === id);
}

export function relationshipId(
  source: string,
  relationship: string,
  target: string
): string {
  return `${toId(source)}--${toId(relationship)}--${toId(target)}`;
}

export function findRelationship(
  o: Ontology,
  source: string,
  relationship: string,
  target: string
): Relationship | undefined {
  const id = relationshipId(source, relationship, target);
  return o.relationships.find((r) => r.id === id);
}

/** Any addressable node the depth controller may target. */
export function allNodeIds(o: Ontology): string[] {
  return [
    ...o.entities.map((e) => e.id),
    ...o.concepts.map((c) => c.id),
    ...o.metrics.map((m) => m.id),
    ...o.events.map((e) => e.id),
    ...o.rules.map((r) => r.id),
  ];
}

export function nodeCount(o: Ontology): number {
  return (
    o.entities.length +
    o.entities.reduce((n, e) => n + e.attributes.length, 0) +
    o.relationships.length +
    o.concepts.length +
    o.metrics.length +
    o.events.length +
    o.rules.length
  );
}

export function nodeExists(o: Ontology, nameOrId: string): boolean {
  const id = toId(nameOrId);
  return (
    allNodeIds(o).includes(id) || o.relationships.some((r) => r.id === id)
  );
}

/** Compact textual projection handed to the LLM instead of the full JSON. */
export function summarizeOntology(o: Ontology): string {
  const lines: string[] = [];
  lines.push(`DATASET: ${o.datasetName}`);
  if (o.datasetDescription) lines.push(`  ${o.datasetDescription}`);

  lines.push('', 'ENTITIES:');
  if (!o.entities.length) lines.push('  (none)');
  for (const e of o.entities) {
    lines.push(
      `  - ${e.name} [${e.status} conf=${e.confidence.toFixed(2)}] ${e.description}`
    );
    for (const a of e.attributes) {
      const role = a.semanticRole ? ` role=${a.semanticRole}` : '';
      lines.push(
        `      . ${a.name}: ${a.type}${role} [${a.status} conf=${a.confidence.toFixed(2)}]`
      );
    }
  }

  lines.push('', 'RELATIONSHIPS:');
  if (!o.relationships.length) lines.push('  (none)');
  for (const r of o.relationships) {
    lines.push(
      `  - ${r.sourceEntity} --${r.relationship}--> ${r.targetEntity}` +
        `${r.cardinality ? ` (${r.cardinality})` : ''} [${r.status} conf=${r.confidence.toFixed(2)}]`
    );
  }

  const section = (
    title: string,
    items: Array<{ name: string; description: string; status: string; confidence: number }>
  ) => {
    lines.push('', `${title}:`);
    if (!items.length) lines.push('  (none)');
    for (const i of items) {
      lines.push(
        `  - ${i.name} [${i.status} conf=${i.confidence.toFixed(2)}] ${i.description}`
      );
    }
  };

  section('CONCEPTS', o.concepts);
  section(
    'METRICS',
    o.metrics.map((m) => ({ ...m, description: `${m.description} := ${m.definition}` }))
  );
  section('EVENTS', o.events);
  section('RULES', o.rules);

  lines.push('', 'MARKED UNCERTAIN:');
  if (!o.uncertain.length) lines.push('  (none)');
  for (const u of o.uncertain) lines.push(`  - ${u.targetId}: ${u.reason}`);

  return lines.join('\n');
}
