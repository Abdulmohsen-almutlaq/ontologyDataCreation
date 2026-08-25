import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { SemanticTier } from '../src/core/tiers';
import { depthOf, runScripted } from './helpers';

describe('adaptive depth', () => {
  test('branches finish at different depths', async () => {
    // The central claim of the system. Customer earns a relationship, Product
    // never needed one, and Revenue is carried to a metric - all in one run,
    // from one ontology, without any branch being forced to match another.
    const result = await runScripted('asymmetric-depth');

    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.terminationReason, 'AGENT_STOP');

    assert.equal(depthOf(result, 'customer'), SemanticTier.RELATIONSHIP, 'Customer = 3');
    assert.equal(depthOf(result, 'product'), SemanticTier.ATTRIBUTE, 'Product = 2');
    assert.equal(depthOf(result, 'revenue'), SemanticTier.METRIC, 'Revenue = 5');

    assert.ok(
      depthOf(result, 'revenue') > depthOf(result, 'customer'),
      'the branch that needed depth got it'
    );
    assert.ok(
      depthOf(result, 'product') < depthOf(result, 'customer'),
      'the branch that did not need depth was left alone'
    );
    assert.equal(result.depth.globalDepth, SemanticTier.METRIC);
  });

  test('exploration is targeted, not broadcast', async () => {
    const result = await runScripted('asymmetric-depth');
    const deepening = result.history.filter((s) => s.action === 'EXPAND');
    assert.ok(deepening.length >= 2);
    for (const step of deepening) {
      assert.ok(step.targetNodes.length > 0, 'every deepening step names its targets');
      assert.ok(
        !step.targetNodes.includes('product'),
        'Product was never a target and must not be dragged along'
      );
    }
  });

  test('the ontology models meaning that no table contains', async () => {
    const result = await runScripted('asymmetric-depth');
    const revenue = result.ontology.concepts.find((c) => c.id === 'revenue');
    assert.ok(revenue, 'Revenue exists as a concept, not as a renamed table');
    assert.equal(revenue!.status, 'INFERRED', 'and is not passed off as observed');
    assert.ok(revenue!.evidence.length >= 3, 'but is still grounded in evidence');
    assert.equal(result.ontology.metrics[0].id, 'net_revenue');
  });

  test('uncertainty is recorded rather than smoothed over', async () => {
    const result = await runScripted('asymmetric-depth');
    assert.ok(result.ontology.uncertain.some((u) => u.targetId === 'net_revenue'));
    assert.ok(result.completion, 'a completion assessment is produced');
    assert.ok(
      result.completion!.remainingRisks.length > 0,
      'and it states what could still be got wrong'
    );
  });

  test('the run is fully traceable back to prompt versions', async () => {
    const result = await runScripted('asymmetric-depth');
    const entries = result.trace.byAgent('DepthController');
    assert.ok(entries.length >= 3);
    for (const entry of entries) {
      assert.equal(entry.promptName, 'exploration/depth-decision');
      assert.equal(entry.promptVersion, 'v1');
      assert.match(entry.promptHash!, /^[0-9a-f]{16}$/);
      assert.equal(entry.model, 'scripted');
      assert.ok(entry.inputContextHash);
    }
  });
});

describe('knowing when to stop', () => {
  test('a simple source stops after one assessment', async () => {
    const result = await runScripted('stop-early');
    assert.equal(result.terminationReason, 'AGENT_STOP');
    assert.equal(result.iterations, 1, 'no iteration happens without a reason');
    assert.equal(result.ontology.entities.length, 3);
    assert.equal(result.ontology.concepts.length, 0, 'nothing was invented to look thorough');
  });

  test('deepening that costs more than it buys is refused', async () => {
    const result = await runScripted('low-value');
    assert.equal(result.terminationReason, 'AGENT_STOP');
    assert.equal(result.iterations, 1);
    assert.match(result.decisions[0].reason, /does not exceed complexity cost/);
    assert.equal(result.decisions[0].decision, 'STOP');
  });

  test('deepening a node that does not exist is refused', async () => {
    const result = await runScripted('phantom-target');
    assert.equal(result.decisions[0].decision, 'STOP');
    assert.match(result.decisions[0].reason, /not in the ontology/);
  });

  test('a model that never stops is stopped by the harness', async () => {
    // The loop must not run just because another iteration is possible.
    const result = await runScripted('never-stops');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.terminationReason, 'STALLED');
    assert.ok(result.iterations < 5, `stopped after ${result.iterations} iterations`);
  });

  test('the LLM call budget bounds the run even when the model keeps asking', async () => {
    const result = await runScripted('never-stops', {
      ONTOLOGY_MAX_LLM_CALLS: '4',
    });
    assert.equal(result.terminationReason, 'MAX_LLM_CALLS');
    assert.equal(result.llmCalls, 4, 'the budget is a real ceiling, not a suggestion');
  });

  test('max iterations is enforced independently of the model', async () => {
    const result = await runScripted('never-stops', { ONTOLOGY_MAX_ITERATIONS: '1' });
    assert.equal(result.terminationReason, 'MAX_ITERATIONS');
  });
});

describe('optional passes', () => {
  test('semantic validation findings reach the result', async () => {
    const result = await runScripted('stop-early', {}, { semanticValidation: true });
    assert.ok(
      result.validation!.issues.some((i) => i.code === 'SEMANTIC_ISSUE'),
      'the semantic pass contributes issues alongside the structural ones'
    );
    assert.equal(result.validation!.valid, true, 'advisory findings do not invalidate');
  });
});

describe('failure handling', () => {
  test('malformed output is corrected rather than fatal', async () => {
    const result = await runScripted('malformed-output');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.ontology.entities.length, 3);
    assert.ok(result.llmCalls >= 4, 'the wasted attempt is counted, not hidden');
  });

  test('a provider failure fails the run loudly and still returns a trace', async () => {
    const result = await runScripted('provider-failure');
    assert.equal(result.status, 'FAILED');
    assert.equal(result.terminationReason, 'ERROR');
    assert.ok(
      result.trace.all().some((e) => e.error?.includes('connection refused')),
      'the failure is recorded'
    );
  });

  test('a discovery that yields nothing fails loudly instead of reporting success', async () => {
    // An empty ontology reported as COMPLETED would be the worst outcome:
    // silently wrong rather than visibly broken.
    const result = await runScripted('empty-discovery');
    assert.equal(result.status, 'FAILED');
    assert.equal(result.terminationReason, 'ERROR');
  });

  test('an unsupported claim is dropped while the rest of the batch survives', async () => {
    const result = await runScripted('unsupported-claim');
    const names = result.ontology.entities.map((e) => e.id);
    assert.ok(!names.includes('customer'), 'OBSERVED with no evidence is not admitted');
    assert.ok(names.includes('product'), 'the honest low-confidence assertion is kept');
  });
});
