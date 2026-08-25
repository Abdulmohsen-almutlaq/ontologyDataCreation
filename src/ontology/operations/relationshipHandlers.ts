import { findEntity, findRelationship, relationshipId } from '../Ontology';
import {
  applied,
  defineHandler,
  rejected,
  type AnyOperationHandler,
} from './OperationHandler';

export const addRelationshipHandler = defineHandler('ADD_RELATIONSHIP', (op, batch) => {
  const problem = batch.groundingProblem(op);
  if (problem) return rejected('UNSUPPORTED_CLAIM', problem);

  const source = findEntity(batch.ontology, op.source);
  const target = findEntity(batch.ontology, op.target);
  if (!source || !target) {
    return rejected(
      'MISSING_RELATIONSHIP_TARGET',
      `Relationship endpoints must exist: ${op.source} -> ${op.target}`
    );
  }
  if (findRelationship(batch.ontology, op.source, op.relationship, op.target)) {
    return rejected('DUPLICATE_NODE', 'Relationship already exists');
  }

  batch.ontology.relationships.push({
    id: relationshipId(op.source, op.relationship, op.target),
    sourceEntity: source.id,
    relationship: op.relationship,
    targetEntity: target.id,
    cardinality: op.cardinality,
    description: op.description,
    status: op.status,
    confidence: op.confidence,
    evidence: batch.evidence(op.evidence),
    // `source` on this operation is the source ENTITY; the physical objects
    // behind the relationship arrive as `sourceRefs`.
    source: batch.sources(op.sourceRefs),
  });
  return applied;
});

export const updateRelationshipHandler = defineHandler(
  'UPDATE_RELATIONSHIP',
  (op, batch) => {
    const relationship = findRelationship(
      batch.ontology,
      op.source,
      op.relationship,
      op.target
    );
    if (!relationship) return rejected('UNKNOWN_NODE', 'Relationship does not exist');

    if (op.cardinality !== undefined) relationship.cardinality = op.cardinality;
    if (op.description !== undefined) relationship.description = op.description;
    if (op.status !== undefined) relationship.status = op.status;
    if (op.confidence !== undefined) relationship.confidence = op.confidence;
    relationship.evidence.push(...batch.evidence(op.evidence));
    relationship.source.push(...batch.sources(op.sourceRefs));
    return applied;
  }
);

export const relationshipHandlers: AnyOperationHandler[] = [
  addRelationshipHandler,
  updateRelationshipHandler,
];
