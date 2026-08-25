import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { DepthController } from '../src/agents/DepthController';
import {
  DepthDecisionPolicy,
  defaultDepthPolicy,
  override,
  phantomTargetGuard,
  valueVersusCostGuard,
  type DepthGuard,
} from '../src/agents/depth';
import { createState } from '../src/exploration/ExplorationState';
import { deriveDepthState } from '../src/ontology/depth';
import { emptyOntology } from '../src/ontology/Ontology';
import { OntologyEngine } from '../src/ontology/OntologyEngine';
import { OntologyValidator } from '../src/ontology/OntologyValidator';
import {
  applied,
  defaultOperationRegistry,
  defineHandler,
  OperationRegistry,
  rejected,
  addEntityHandler,
  ApplyBatchContext,
} from '../src/ontology/operations';
import {
  acyclicRule,
  duplicateNodeRule,
  type ValidationRule,
} from '../src/ontology/validation';
import { observationStrategies, strategyFor } from '../src/observation/strategies';
import { OperationSchema } from '../src/schemas/llm';

/**
 * These tests exist to prove the extension points are real.
 *
 * A pattern that cannot actually be extended is decoration; each test here
 * substitutes one part of the system without touching the rest.
 */

const limits = {
  maxDepth: 6,
  maxIterations: 25,
  maxLLMCalls: 100,
  maxNodes: 1000,
  maxObservationRequests: 200,
  maxRuntimeMs: 900_000,
};

const evidence = [{ locator: 'customers', summary: 'table present' }];

const addEntity = (name: string) =>
  OperationSchema.parse({
    type: 'ADD_ENTITY',
    name,
    description: name,
    status: 'OBSERVED',
    confidence: 0.9,
    evidence,
  });

describe('operation handlers (Command)', () => {
  test('the default registry covers every operation the schema allows', () => {
    const engine = new OntologyEngine(new OntologyValidator());
    const supported = engine.supportedOperations();
    for (const type of [
      'ADD_ENTITY',
      'UPDATE_ENTITY',
      'ADD_ATTRIBUTE',
      'UPDATE_ATTRIBUTE',
      'ADD_RELATIONSHIP',
      'UPDATE_RELATIONSHIP',
      'ADD_CONCEPT',
      'ADD_METRIC',
      'ADD_EVENT',
      'ADD_RULE',
      'MERGE_CONCEPT',
      'MARK_UNCERTAIN',
      'REQUEST_OBSERVATION',
    ]) {
      assert.ok(supported.includes(type), `no handler registered for ${type}`);
    }
  });

  test('an engine with a restricted registry refuses what it does not support', () => {
    // A read-only or discovery-only engine is a registry choice, not a fork.
    const engine = new OntologyEngine(
      new OntologyValidator(),
      new OperationRegistry().register(addEntityHandler)
    );
    const result = engine.apply(
      emptyOntology('shop'),
      [addEntity('Customer'), OperationSchema.parse({ type: 'MARK_UNCERTAIN', target: 'customer', reason: 'x' })],
      { iteration: 1 }
    );
    assert.equal(result.applied.length, 1);
    assert.equal(result.rejected[0].code, 'UNSUPPORTED_OPERATION');
  });

  test('a custom handler can be registered without touching the engine', () => {
    const auditing: string[] = [];
    const auditingMark = defineHandler('MARK_UNCERTAIN', (op, batch) => {
      auditing.push(op.target);
      batch.ontology.uncertain.push({
        targetId: op.target,
        reason: op.reason,
        markedAtIteration: batch.iteration,
      });
      return applied;
    });

    const engine = new OntologyEngine(
      new OntologyValidator(),
      defaultOperationRegistry().register(auditingMark)
    );
    const seeded = engine.apply(emptyOntology('shop'), [addEntity('Customer')], {
      iteration: 1,
    });
    engine.apply(
      seeded.ontology,
      [OperationSchema.parse({ type: 'MARK_UNCERTAIN', target: 'customer', reason: 'why' })],
      { iteration: 2 }
    );
    assert.deepEqual(auditing, ['customer'], 'the replacement handler ran');
  });

  test('a handler can be exercised on its own, without the engine', () => {
    const batch = new ApplyBatchContext(emptyOntology('shop'), 1, 0.7);
    assert.equal(addEntityHandler.apply(addEntity('Customer'), batch), null);
    assert.equal(batch.ontology.entities.length, 1);

    const refusal = addEntityHandler.apply(addEntity('Customer'), batch);
    assert.equal(refusal?.code, 'DUPLICATE_NODE');
  });

  test('a throwing handler is contained and does not lose the batch', () => {
    const exploding = defineHandler('MARK_UNCERTAIN', () => {
      throw new Error('handler bug');
    });
    const engine = new OntologyEngine(
      new OntologyValidator(),
      defaultOperationRegistry().register(exploding)
    );
    const result = engine.apply(
      emptyOntology('shop'),
      [
        addEntity('Customer'),
        OperationSchema.parse({ type: 'MARK_UNCERTAIN', target: 'customer', reason: 'x' }),
      ],
      { iteration: 1 }
    );
    assert.equal(result.applied.length, 1, 'the good operation still landed');
    assert.equal(result.rejected[0].code, 'APPLY_ERROR');
    assert.match(result.rejected[0].reason, /handler bug/);
  });

  test('handlers cannot commit: atomicity still belongs to the engine', () => {
    // A handler that "succeeds" into an invalid state must still be rolled back.
    const sneaky = defineHandler('MARK_UNCERTAIN', (_op, batch) => {
      batch.ontology.entities.push({
        id: 'bogus',
        name: 'Bogus',
        description: '',
        attributes: [],
        status: 'OBSERVED',
        confidence: 0.99,
        evidence: [],
        source: [],
      });
      return applied;
    });
    const engine = new OntologyEngine(
      new OntologyValidator(),
      defaultOperationRegistry().register(sneaky)
    );
    const result = engine.apply(
      emptyOntology('shop'),
      [OperationSchema.parse({ type: 'MARK_UNCERTAIN', target: 'x', reason: 'y' })],
      { iteration: 1 }
    );
    assert.equal(result.rolledBack, true);
    assert.equal(result.ontology.entities.length, 0);
  });

  test('rejected(...) and applied are the only two outcomes', () => {
    assert.equal(applied, null);
    assert.deepEqual(rejected('CODE', 'why'), { code: 'CODE', reason: 'why' });
  });
});

describe('validation rules (Composite)', () => {
  test('the default rule set is ordered and named', () => {
    const names = new OntologyValidator().ruleNames;
    assert.ok(names.includes('duplicate-node'));
    assert.ok(names.includes('grounding'));
    assert.ok(!names.includes('acyclic'), 'cycles are permitted unless requested');
    assert.ok(new OntologyValidator({ allowCycles: false }).ruleNames.includes('acyclic'));
  });

  test('a caller can validate with a single rule', () => {
    const validator = new OntologyValidator({ rules: [duplicateNodeRule] });
    const o = emptyOntology('shop');
    o.entities.push(
      {
        id: 'x',
        name: 'X',
        description: '',
        attributes: [],
        status: 'INFERRED',
        confidence: 9,
        evidence: [],
        source: [],
      },
      {
        id: 'x',
        name: 'X',
        description: '',
        attributes: [],
        status: 'INFERRED',
        confidence: 0.1,
        evidence: [],
        source: [],
      }
    );
    const result = validator.validate(o);
    assert.ok(result.issues.some((i) => i.code === 'DUPLICATE_NODE'));
    assert.ok(
      !result.issues.some((i) => i.code === 'INVALID_CONFIDENCE'),
      'the omitted rule did not run'
    );
  });

  test('a project-specific rule composes with the built-in ones', () => {
    const noSingleLetterNames: ValidationRule = {
      name: 'no-single-letter-names',
      check: (o) =>
        o.entities
          .filter((e) => e.name.length < 2)
          .map((e) => ({
            code: 'NAME_TOO_SHORT',
            severity: 'error' as const,
            target: e.id,
            message: 'Entity names must be meaningful',
          })),
    };
    const validator = new OntologyValidator({
      rules: [duplicateNodeRule, acyclicRule, noSingleLetterNames],
    });
    const o = emptyOntology('shop');
    o.entities.push({
      id: 'x',
      name: 'X',
      description: '',
      attributes: [],
      status: 'INFERRED',
      confidence: 0.5,
      evidence: [],
      source: [],
    });
    assert.equal(validator.validate(o).valid, false);
  });
});

describe('depth guards (Chain of Responsibility)', () => {
  const controller = new DepthController(null as any);

  function stateWithCustomer() {
    const state = createState('run', 'shop');
    state.ontology = new OntologyEngine(new OntologyValidator()).apply(
      emptyOntology('shop'),
      [addEntity('Customer')],
      { iteration: 0 }
    ).ontology;
    state.depth = deriveDepthState(state.ontology);
    return state;
  }

  const response = {
    decision: 'GO_DEEPER' as const,
    targetNodes: ['customer'],
    reason: 'because',
    expectedValue: 0.9,
    expectedInformationGain: 0.8,
    uncertainty: 0.5,
    complexityCost: 0.2,
    nextFocus: [],
    requiredEvidence: [],
  };

  test('the default chain is ordered and inspectable', () => {
    assert.deepEqual(controller.guards, [
      'phantom-target',
      'value-versus-cost',
      'evidence-request',
      'depth-ceiling',
      'evidence-diagnostics',
    ]);
  });

  test('a guard can be swapped out for a stricter policy', () => {
    // A deployment that never wants automatic deepening needs a guard, not a fork.
    const neverDeepen: DepthGuard = {
      name: 'never-deepen',
      check: (draft) => {
        if (draft.decision === 'GO_DEEPER') {
          override(draft, 'STOP', 'overridden to STOP: deepening disabled by policy');
        }
      },
    };
    const strict = new DepthController(
      null as any,
      new DepthDecisionPolicy([phantomTargetGuard, neverDeepen])
    );
    const result = strict.constrain(response, {
      state: stateWithCustomer(),
      limits,
      defaultSchema: 'public',
    });
    assert.equal(result.decision, 'STOP');
    assert.match(result.reason, /deepening disabled by policy/);
  });

  test('removing a guard removes exactly its behaviour', () => {
    const permissive = new DepthController(
      null as any,
      new DepthDecisionPolicy([phantomTargetGuard])
    );
    const lowValue = { ...response, expectedValue: 0.1, complexityCost: 0.9 };

    assert.equal(
      permissive.constrain(lowValue, {
        state: stateWithCustomer(),
        limits,
        defaultSchema: 'public',
      }).decision,
      'GO_DEEPER',
      'without the cost guard the decision stands'
    );

    const guarded = new DepthController(
      null as any,
      new DepthDecisionPolicy([phantomTargetGuard, valueVersusCostGuard])
    );
    assert.equal(
      guarded.constrain(lowValue, {
        state: stateWithCustomer(),
        limits,
        defaultSchema: 'public',
      }).decision,
      'STOP'
    );
  });

  test('the default policy is what the controller uses', () => {
    assert.deepEqual(defaultDepthPolicy().names, controller.guards);
  });
});

describe('observation strategies (Strategy)', () => {
  test('the catalogue is the security boundary', () => {
    // What is not registered here cannot be asked of a data source.
    assert.deepEqual(Object.keys(observationStrategies).sort(), [
      'column_statistics',
      'distinct_overlap',
      'distinct_values',
      'relationship_evidence',
      'sample_rows',
      'schema_overview',
      'table_metadata',
      'temporal_distribution',
      'value_distribution',
    ]);
  });

  test('an unregistered observation type is refused', () => {
    assert.throws(
      () => strategyFor('arbitrary_sql' as never),
      /Unsupported observation type/
    );
  });
});

describe('chain invariants', () => {
  test('STOP is terminal: a later guard cannot restart exploration', async () => {
    const { override } = await import('../src/agents/depth');
    const draft = {
      decision: 'STOP' as const,
      currentDepth: 2,
      targetNodes: [],
      requiredEvidence: [],
      droppedEvidence: [],
      notes: ['stopped by an earlier guard'],
    };
    override(draft, 'GO_DEEPER', 'a later guard wants more work');
    assert.equal(draft.decision, 'STOP');
    assert.equal(draft.notes.length, 1, 'the ignored override leaves no note');
  });
});

describe('composition root', () => {
  test('an injected component set is actually used end to end', async () => {
    // Proves the seam rather than assuming it: the harness is driven with a
    // hand-built object graph carrying a stricter depth policy, and the run
    // must obey that policy instead of the default one.
    const { composeHarness } = await import('../src/composition/CompositionRoot');
    const { createLogger } = await import('../src/config/logger');
    const { OntologyHarness } = await import('../src/OntologyHarness');
    const { testConfig } = await import('./helpers');

    const config = testConfig('asymmetric-depth');
    const logger = createLogger('silent');
    const runId = 'injected-run';

    const parts = composeHarness({ config, logger, runId });
    const neverDeepen: DepthGuard = {
      name: 'never-deepen',
      check: (draft) => {
        if (draft.decision === 'GO_DEEPER') {
          override(draft, 'STOP', 'overridden to STOP: deepening disabled by policy');
        }
      },
    };
    const strict = {
      ...parts,
      depthController: new DepthController(
        parts.agentDeps,
        new DepthDecisionPolicy([phantomTargetGuard, neverDeepen])
      ),
    };

    const harness = new OntologyHarness({ config, logger, components: strict });
    const result = await harness.run(OntologyHarness.sourceFromConfig(config));

    assert.equal(result.runId, runId, 'the run adopts the injected trace identity');
    assert.equal(result.trace.runId, runId, 'result and trace agree on the run');
    assert.equal(result.terminationReason, 'AGENT_STOP');
    assert.equal(result.iterations, 1, 'the injected policy stopped the first deepening');
    assert.match(result.decisions[0].reason, /deepening disabled by policy/);
    assert.equal(
      result.ontology.concepts.length,
      0,
      'the concept pass the default policy would have reached never ran'
    );
  });
});

describe('validator options compose', () => {
  test('allowCycles applies to a custom rule set too', async () => {
    const engine = new OntologyEngine(new OntologyValidator());
    let o = engine.apply(emptyOntology('shop'), [addEntity('Employee')], {
      iteration: 1,
    }).ontology;
    o = engine.apply(
      o,
      [
        OperationSchema.parse({
          type: 'ADD_RELATIONSHIP',
          source: 'Employee',
          relationship: 'manages',
          target: 'Employee',
          status: 'INFERRED',
          confidence: 0.5,
        }),
      ],
      { iteration: 2 }
    ).ontology;

    // Custom base set that says nothing about cycles.
    const custom = { rules: [duplicateNodeRule] };
    assert.equal(new OntologyValidator(custom).validate(o).valid, true);
    assert.equal(
      new OntologyValidator({ ...custom, allowCycles: false }).validate(o).valid,
      false,
      'the option must not be silently ignored because rules were supplied'
    );
  });
});
