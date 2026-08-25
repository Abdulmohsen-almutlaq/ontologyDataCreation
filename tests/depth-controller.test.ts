import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { DepthController } from '../src/agents/DepthController';
import { SemanticTier } from '../src/core/tiers';
import { createState, detectStall, decisionSignature } from '../src/exploration/ExplorationState';
import { deriveDepthState } from '../src/ontology/depth';
import { emptyOntology } from '../src/ontology/Ontology';
import { OntologyEngine } from '../src/ontology/OntologyEngine';
import { OntologyValidator } from '../src/ontology/OntologyValidator';
import { OperationSchema } from '../src/schemas/llm';
import type { DepthDecisionResponse } from '../src/schemas/llm';

const limits = {
  maxDepth: 6,
  maxIterations: 25,
  maxLLMCalls: 100,
  maxNodes: 1000,
  maxObservationRequests: 200,
  maxRuntimeMs: 900_000,
};

function stateWithEntities() {
  const engine = new OntologyEngine(new OntologyValidator());
  const state = createState('run', 'shop');
  const evidence = [{ locator: 'customers', summary: 'table present' }];
  state.ontology = engine.apply(
    emptyOntology('shop'),
    ['Customer', 'Order'].map((name) =>
      OperationSchema.parse({
        type: 'ADD_ENTITY',
        name,
        description: name,
        status: 'OBSERVED',
        confidence: 0.9,
        evidence,
        attributes: [
          { name: 'id', type: 'integer', status: 'OBSERVED', confidence: 0.9, evidence },
        ],
      })
    ),
    { iteration: 0 }
  ).ontology;
  state.depth = deriveDepthState(state.ontology);
  return state;
}

/** The controller is constructed without deps because only `constrain` is under
 *  test here; the LLM path is covered end to end in harness.test.ts. */
const controller = new DepthController(null as any);

function decide(partial: Partial<DepthDecisionResponse>) {
  const response: DepthDecisionResponse = {
    decision: 'GO_DEEPER',
    targetNodes: ['customer'],
    reason: 'because',
    expectedValue: 0.9,
    expectedInformationGain: 0.8,
    uncertainty: 0.5,
    complexityCost: 0.2,
    nextFocus: [],
    requiredEvidence: [],
    ...partial,
  };
  return controller.constrain(response, {
    state: stateWithEntities(),
    limits,
    defaultSchema: 'public',
  });
}

describe('depth controller guards', () => {
  test('current depth comes from the ontology, not from the model', () => {
    const result = decide({ targetDepth: 3 });
    assert.equal(result.currentDepth, SemanticTier.ATTRIBUTE);
  });

  test('a valid deepening request is passed through', () => {
    const result = decide({ targetDepth: 3, targetNodes: ['customer'] });
    assert.equal(result.decision, 'GO_DEEPER');
    assert.deepEqual(result.targetNodes, ['customer']);
    assert.equal(result.targetDepth, 3);
  });

  test('low-value deepening is overridden to STOP', () => {
    // The whole point of the controller: enthusiasm is not a reason to expand.
    const result = decide({ expectedValue: 0.3, complexityCost: 0.6 });
    assert.equal(result.decision, 'STOP');
    assert.match(result.reason, /does not exceed complexity cost/);
  });

  test('deepening a node that does not exist is overridden to STOP', () => {
    const result = decide({ targetNodes: ['shipment_manifest'] });
    assert.equal(result.decision, 'STOP');
    assert.match(result.reason, /not in the ontology/);
  });

  test('deepening with no target at all is overridden to STOP', () => {
    const result = decide({ targetNodes: [] });
    assert.equal(result.decision, 'STOP');
    assert.match(result.reason, /named no target node/);
  });

  test('a target depth beyond the configured maximum is capped', () => {
    const result = decide({ targetDepth: 30 });
    assert.equal(result.targetDepth, limits.maxDepth);
    assert.match(result.reason, /capped/);
  });

  test('a target depth that is not actually deeper becomes a refinement', () => {
    const result = decide({ targetDepth: 1 });
    assert.equal(result.decision, 'REFINE_CURRENT');
  });

  test('REQUEST_EVIDENCE with no usable request is overridden to STOP', () => {
    const result = decide({
      decision: 'REQUEST_EVIDENCE',
      requiredEvidence: [
        { target: 'orders', observationType: 'column_statistics', reason: 'bad target' },
      ],
    });
    assert.equal(result.decision, 'STOP');
    assert.match(result.reason, /no valid observation request/);
  });

  test('valid evidence requests survive and invalid ones are reported', () => {
    const result = decide({
      decision: 'REQUEST_EVIDENCE',
      requiredEvidence: [
        { target: 'orders.status', observationType: 'value_distribution', reason: 'states' },
        { target: 'orders', observationType: 'column_statistics', reason: 'malformed' },
      ],
    });
    assert.equal(result.decision, 'REQUEST_EVIDENCE');
    assert.equal(result.requiredEvidence!.length, 1);
    assert.match(result.reason, /dropped invalid evidence requests/);
  });

  test('a STOP is never converted into more work', () => {
    const result = decide({ decision: 'STOP', expectedValue: 0.99, complexityCost: 0.0 });
    assert.equal(result.decision, 'STOP');
  });
});

describe('stall detection', () => {
  test('a repeated decision signature is a stall', () => {
    const signature = decisionSignature({
      decision: 'GO_DEEPER',
      currentDepth: 2,
      targetNodes: ['product'],
      reason: 'r',
      expectedValue: 1,
      expectedInformationGain: 1,
      uncertainty: 1,
      complexityCost: 0,
    });
    assert.match(
      detectStall({
        operationsApplied: 5,
        newObservations: 2,
        signature,
        previousSignatures: [signature],
      })!,
      /repeats an earlier iteration/
    );
  });

  test('an iteration that changes nothing is a stall', () => {
    assert.match(
      detectStall({
        operationsApplied: 0,
        newObservations: 0,
        signature: 'a',
        previousSignatures: ['b'],
      })!,
      /no operations and gathered no new evidence/
    );
  });

  test('real progress is not a stall', () => {
    assert.equal(
      detectStall({
        operationsApplied: 3,
        newObservations: 1,
        signature: 'a',
        previousSignatures: ['b'],
      }),
      null
    );
  });
});
