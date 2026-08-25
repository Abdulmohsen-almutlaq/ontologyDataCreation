import type { Attribute } from '../../core/types';
import { findEntity, toId } from '../Ontology';
import {
  applied,
  defineHandler,
  rejected,
  type AnyOperationHandler,
  type ApplyBatch,
  type OperationOf,
} from './OperationHandler';

type AttributeSpec = OperationOf<'ADD_ATTRIBUTE'>['attribute'];

function buildAttribute(
  spec: AttributeSpec,
  entityId: string,
  batch: ApplyBatch
): Attribute {
  return {
    id: toId(spec.name),
    entityId,
    name: spec.name,
    type: spec.type,
    description: spec.description,
    semanticRole: spec.semanticRole,
    nullable: spec.nullable,
    unit: spec.unit,
    status: spec.status,
    confidence: spec.confidence,
    evidence: batch.evidence(spec.evidence),
    source: batch.sources(spec.source),
  };
}

export const addEntityHandler = defineHandler('ADD_ENTITY', (op, batch) => {
  const problem = batch.groundingProblem(op);
  if (problem) return rejected('UNSUPPORTED_CLAIM', problem);

  const id = toId(op.name);
  if (!id) {
    return rejected('INVALID_NAME', `Entity name "${op.name}" normalises to nothing`);
  }
  if (findEntity(batch.ontology, id)) {
    return rejected('DUPLICATE_NODE', `Entity "${op.name}" already exists`);
  }

  // Two distinct names can normalise to one id ("Total Amount" / "total_amount"),
  // which would produce an ontology the validator rejects and cost the whole batch.
  const attributeIds = op.attributes.map((a) => toId(a.name));
  const collision = attributeIds.find((a, i) => attributeIds.indexOf(a) !== i);
  if (collision) {
    return rejected(
      'DUPLICATE_ATTRIBUTE',
      `Two attributes of "${op.name}" normalise to the same id "${collision}"`
    );
  }

  for (const spec of op.attributes) {
    const attributeProblem = batch.groundingProblem(spec);
    if (attributeProblem) {
      return rejected('UNSUPPORTED_CLAIM', `Attribute "${spec.name}": ${attributeProblem}`);
    }
  }

  batch.ontology.entities.push({
    id,
    name: op.name,
    description: op.description,
    attributes: op.attributes.map((a) => buildAttribute(a, id, batch)),
    status: op.status,
    confidence: op.confidence,
    evidence: batch.evidence(op.evidence),
    source: batch.sources(op.source),
  });
  return applied;
});

export const updateEntityHandler = defineHandler('UPDATE_ENTITY', (op, batch) => {
  const entity = findEntity(batch.ontology, op.name);
  if (!entity) return rejected('UNKNOWN_NODE', `Entity "${op.name}" does not exist`);

  // Check the post-update shape BEFORE writing it: a rejected operation must
  // leave the candidate exactly as it was, or one bad update escalates into a
  // full-batch rollback.
  const updated = {
    status: op.status ?? entity.status,
    confidence: op.confidence ?? entity.confidence,
    evidence: [...entity.evidence, ...batch.evidence(op.evidence)],
  };
  const problem = batch.groundingProblem(updated);
  if (problem) {
    return rejected(
      'UNSUPPORTED_CLAIM',
      `Update would leave the entity unsupported: ${problem}`
    );
  }

  if (op.description !== undefined) entity.description = op.description;
  entity.status = updated.status;
  entity.confidence = updated.confidence;
  entity.evidence = updated.evidence;
  entity.source.push(...batch.sources(op.source));
  return applied;
});

export const addAttributeHandler = defineHandler('ADD_ATTRIBUTE', (op, batch) => {
  const entity = findEntity(batch.ontology, op.entity);
  if (!entity) return rejected('UNKNOWN_NODE', `Entity "${op.entity}" does not exist`);

  const problem = batch.groundingProblem(op.attribute);
  if (problem) return rejected('UNSUPPORTED_CLAIM', problem);

  const attributeId = toId(op.attribute.name);
  if (entity.attributes.some((a) => a.id === attributeId)) {
    return rejected(
      'DUPLICATE_ATTRIBUTE',
      `Attribute "${op.attribute.name}" already exists on "${entity.name}"`
    );
  }

  entity.attributes.push(buildAttribute(op.attribute, entity.id, batch));
  return applied;
});

export const updateAttributeHandler = defineHandler('UPDATE_ATTRIBUTE', (op, batch) => {
  const entity = findEntity(batch.ontology, op.entity);
  if (!entity) return rejected('UNKNOWN_NODE', `Entity "${op.entity}" does not exist`);

  const attribute = entity.attributes.find((a) => a.id === toId(op.attribute));
  if (!attribute) {
    return rejected(
      'UNKNOWN_NODE',
      `Attribute "${op.attribute}" does not exist on "${entity.name}"`
    );
  }

  const changes = op.changes;
  if (changes.type !== undefined) attribute.type = changes.type;
  if (changes.description !== undefined) attribute.description = changes.description;
  if (changes.semanticRole !== undefined) attribute.semanticRole = changes.semanticRole;
  if (changes.nullable !== undefined) attribute.nullable = changes.nullable;
  if (changes.unit !== undefined) attribute.unit = changes.unit;
  if (changes.status !== undefined) attribute.status = changes.status;
  if (changes.confidence !== undefined) attribute.confidence = changes.confidence;
  attribute.evidence.push(...batch.evidence(changes.evidence));
  attribute.source.push(...batch.sources(changes.source));
  return applied;
});

export const entityHandlers: AnyOperationHandler[] = [
  addEntityHandler,
  updateEntityHandler,
  addAttributeHandler,
  updateAttributeHandler,
];
