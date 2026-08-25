import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { SemanticTier } from '../src/core/tiers';
import { deriveDepthState } from '../src/ontology/depth';
import { emptyOntology, nodeCount } from '../src/ontology/Ontology';
import { OntologyEngine } from '../src/ontology/OntologyEngine';
import { OntologyValidator } from '../src/ontology/OntologyValidator';
import { OperationSchema, type OperationInput } from '../src/schemas/llm';

const engine = new OntologyEngine(new OntologyValidator());
const ctx = { iteration: 1 };

/** Parses through the real schema so tests cannot skip defaulting. */
function op(raw: unknown): OperationInput {
  return OperationSchema.parse(raw);
}

const evidence = [{ locator: 'customers', summary: 'table present' }];

const addEntity = (name: string, attrs: string[] = []) =>
  op({
    type: 'ADD_ENTITY',
    name,
    description: `${name} entity`,
    status: 'OBSERVED',
    confidence: 0.9,
    evidence,
    attributes: attrs.map((a) => ({
      name: a,
      type: 'text',
      status: 'OBSERVED',
      confidence: 0.9,
      evidence,
    })),
  });

describe('ontology engine', () => {
  test('applies a batch and reports what changed', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [addEntity('Customer', ['id']), addEntity('Order', ['id'])],
      ctx
    );
    assert.equal(result.applied.length, 2);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.rolledBack, false);
    assert.equal(result.ontology.entities.length, 2);
    assert.equal(nodeCount(result.ontology), 4);
  });

  test('rejects a duplicate entity without discarding the rest of the batch', () => {
    const first = engine.apply(emptyOntology('shop'), [addEntity('Customer')], ctx);
    const second = engine.apply(
      first.ontology,
      [addEntity('Customer'), addEntity('Product')],
      ctx
    );
    assert.equal(second.applied.length, 1);
    assert.equal(second.rejected[0].code, 'DUPLICATE_NODE');
    assert.equal(second.ontology.entities.length, 2);
  });

  test('an OBSERVED claim with no evidence is refused', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [
        op({
          type: 'ADD_ENTITY',
          name: 'Ghost',
          description: 'asserted from nothing',
          status: 'OBSERVED',
          confidence: 0.99,
          evidence: [],
        }),
      ],
      ctx
    );
    assert.equal(result.applied.length, 0);
    assert.equal(result.rejected[0].code, 'UNSUPPORTED_CLAIM');
    assert.equal(result.ontology.entities.length, 0);
  });

  test('high confidence without evidence is refused too', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [
        op({
          type: 'ADD_ENTITY',
          name: 'Hunch',
          description: 'a guess dressed as a fact',
          status: 'INFERRED',
          confidence: 0.95,
          evidence: [],
        }),
      ],
      ctx
    );
    assert.match(result.rejected[0].reason, /requires evidence/);
  });

  test('a low-confidence assertion without evidence is allowed and recorded as such', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [
        op({
          type: 'ADD_ENTITY',
          name: 'Maybe',
          description: 'a tentative reading',
          status: 'ASSUMED',
          confidence: 0.3,
          evidence: [],
        }),
      ],
      ctx
    );
    assert.equal(result.applied.length, 1);
    assert.equal(result.ontology.entities[0].status, 'ASSUMED');
  });

  test('a relationship to a missing entity is refused', () => {
    const base = engine.apply(emptyOntology('shop'), [addEntity('Customer')], ctx);
    const result = engine.apply(
      base.ontology,
      [
        op({
          type: 'ADD_RELATIONSHIP',
          source: 'Customer',
          relationship: 'places',
          target: 'Order',
          status: 'INFERRED',
          confidence: 0.5,
        }),
      ],
      ctx
    );
    assert.equal(result.rejected[0].code, 'MISSING_RELATIONSHIP_TARGET');
  });

  test('a concept grounded in an unknown node is refused', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [
        op({
          type: 'ADD_CONCEPT',
          name: 'Revenue',
          description: 'money',
          basedOn: ['nonexistent'],
          status: 'INFERRED',
          confidence: 0.5,
        }),
      ],
      ctx
    );
    assert.equal(result.rejected[0].code, 'UNGROUNDED_NODE');
  });

  test('merging concepts keeps grounding and re-points dependants', () => {
    let o = engine.apply(emptyOntology('shop'), [addEntity('Order')], ctx).ontology;
    o = engine.apply(
      o,
      [
        op({ type: 'ADD_CONCEPT', name: 'Revenue', description: 'a', basedOn: ['order'], status: 'INFERRED', confidence: 0.5 }),
        op({ type: 'ADD_CONCEPT', name: 'Turnover', description: 'b', basedOn: ['order'], status: 'INFERRED', confidence: 0.6 }),
      ],
      ctx
    ).ontology;
    o = engine.apply(
      o,
      [
        op({ type: 'ADD_METRIC', name: 'Gross', description: 'g', definition: 'sum', basedOn: ['turnover'], status: 'DERIVED', confidence: 0.5 }),
      ],
      ctx
    ).ontology;

    const merged = engine.apply(
      o,
      [op({ type: 'MERGE_CONCEPT', from: 'Turnover', into: 'Revenue', reason: 'same thing' })],
      ctx
    );
    assert.equal(merged.ontology.concepts.length, 1);
    assert.equal(merged.ontology.concepts[0].id, 'revenue');
    assert.deepEqual(
      merged.ontology.metrics[0].basedOn,
      ['revenue'],
      'the metric must follow the surviving concept'
    );
  });

  test('REQUEST_OBSERVATION becomes an evidence request, not a mutation', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [
        op({
          type: 'REQUEST_OBSERVATION',
          target: 'orders.customer_id',
          observationType: 'distinct_overlap',
          compareTo: 'customers.id',
          reason: 'confirm the relationship',
        }),
      ],
      ctx
    );
    assert.equal(result.evidenceRequests.length, 1);
    assert.equal(nodeCount(result.ontology), 0);
  });

  test('distinct_overlap without a comparison target is refused', () => {
    const result = engine.apply(
      emptyOntology('shop'),
      [
        op({
          type: 'REQUEST_OBSERVATION',
          target: 'orders.customer_id',
          observationType: 'distinct_overlap',
          reason: 'confirm',
        }),
      ],
      ctx
    );
    assert.equal(result.evidenceRequests.length, 0);
    assert.equal(result.rejected[0].code, 'INVALID_REQUEST');
  });

  test('a batch that would leave the ontology invalid is rolled back whole', () => {
    // Two relationships asserting contradictory cardinalities: each is legal on
    // its own, the pair is not. Nothing may be committed.
    const base = engine.apply(
      emptyOntology('shop'),
      [addEntity('Customer'), addEntity('Order')],
      ctx
    ).ontology;
    const before = JSON.stringify(base);

    const result = engine.apply(
      base,
      [
        op({ type: 'ADD_RELATIONSHIP', source: 'Customer', relationship: 'places', target: 'Order', cardinality: '1:N', status: 'INFERRED', confidence: 0.5 }),
        op({ type: 'ADD_RELATIONSHIP', source: 'Customer', relationship: 'owns', target: 'Order', cardinality: '1:1', status: 'INFERRED', confidence: 0.5 }),
      ],
      ctx
    );

    assert.equal(result.rolledBack, true);
    assert.equal(result.applied.length, 0);
    assert.equal(result.validation.valid, false);
    assert.equal(JSON.stringify(result.ontology), before, 'live state must be untouched');
    assert.ok(result.rejected.some((r) => r.code === 'BATCH_ROLLED_BACK'));
  });
});

describe('validator', () => {
  const validator = new OntologyValidator();

  test('a clean ontology passes', () => {
    const o = engine.apply(emptyOntology('shop'), [addEntity('Customer', ['id'])], ctx)
      .ontology;
    assert.equal(validator.validate(o).valid, true);
  });

  test('an unreferenced entity is a warning, not an error', () => {
    const o = engine.apply(
      emptyOntology('shop'),
      [addEntity('Customer', ['id']), addEntity('Product', ['id'])],
      ctx
    ).ontology;
    const result = validator.validate(o);
    assert.equal(result.valid, true);
    assert.ok(result.issues.some((i) => i.code === 'ORPHAN_NODE' && i.severity === 'warning'));
  });

  test('an out-of-range confidence is an error', () => {
    const o = emptyOntology('shop');
    o.entities.push({
      id: 'x',
      name: 'X',
      description: '',
      attributes: [],
      status: 'INFERRED',
      confidence: 4,
      evidence: [],
      source: [],
    });
    const result = validator.validate(o);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === 'INVALID_CONFIDENCE'));
  });

  test('cycles are permitted by default and rejectable on request', () => {
    let o = engine.apply(
      emptyOntology('shop'),
      [addEntity('Employee', ['id'])],
      ctx
    ).ontology;
    o = engine.apply(
      o,
      [
        op({ type: 'ADD_RELATIONSHIP', source: 'Employee', relationship: 'manages', target: 'Employee', status: 'INFERRED', confidence: 0.5 }),
      ],
      ctx
    ).ontology;
    assert.equal(new OntologyValidator().validate(o).valid, true);
    assert.equal(new OntologyValidator({ allowCycles: false }).validate(o).valid, false);
  });
});

describe('depth derivation', () => {
  test('depth is earned by structure, per node, not assigned globally', () => {
    let o = engine.apply(
      emptyOntology('shop'),
      [addEntity('Customer', ['id']), addEntity('Order', ['id']), addEntity('Product', ['sku'])],
      ctx
    ).ontology;

    // Every entity has attributes: all sit at ATTRIBUTE.
    let depth = deriveDepthState(o);
    assert.equal(depth.nodeDepths.customer, SemanticTier.ATTRIBUTE);
    assert.equal(depth.nodeDepths.product, SemanticTier.ATTRIBUTE);

    // A relationship lifts only its two endpoints.
    o = engine.apply(
      o,
      [
        op({ type: 'ADD_RELATIONSHIP', source: 'Customer', relationship: 'places', target: 'Order', cardinality: '1:N', status: 'OBSERVED', confidence: 0.9, evidence }),
      ],
      ctx
    ).ontology;
    depth = deriveDepthState(o);
    assert.equal(depth.nodeDepths.customer, SemanticTier.RELATIONSHIP);
    assert.equal(depth.nodeDepths.order, SemanticTier.RELATIONSHIP);
    assert.equal(depth.nodeDepths.product, SemanticTier.ATTRIBUTE, 'Product is untouched');

    // A concept and a metric lift only their own branch.
    o = engine.apply(
      o,
      [
        op({ type: 'ADD_CONCEPT', name: 'Revenue', description: 'earned value', basedOn: ['order'], status: 'INFERRED', confidence: 0.6, evidence }),
      ],
      ctx
    ).ontology;
    o = engine.apply(
      o,
      [
        op({ type: 'ADD_METRIC', name: 'Net Revenue', description: 'after refunds', definition: 'x - y', basedOn: ['revenue'], status: 'DERIVED', confidence: 0.6, evidence }),
      ],
      ctx
    ).ontology;

    depth = deriveDepthState(o);
    assert.equal(depth.nodeDepths.revenue, SemanticTier.METRIC);
    assert.equal(depth.nodeDepths.product, SemanticTier.ATTRIBUTE);
    assert.equal(depth.globalDepth, SemanticTier.METRIC);
    assert.ok(
      depth.branchDepths.revenue > depth.branchDepths.product,
      'branch depth must differ between branches'
    );
  });
});
