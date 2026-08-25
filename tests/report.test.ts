import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { renderDecisions, renderDepths, renderFatal, renderReport } from '../src/cli/report';
import { runScripted } from './helpers';

/**
 * chalk strips colour when stdout is not a TTY, which is the case under the
 * test runner. That is the property worth pinning: the report must stay
 * readable and assertable when piped, so these tests check content and shape
 * rather than escape codes.
 */
describe('cli report', () => {
  test('depths are ordered deepest first and named by tier', async () => {
    const result = await runScripted('asymmetric-depth');
    const lines = renderDepths(result).split('\n');

    assert.match(lines[0], /revenue.*5 METRIC/);
    assert.match(lines[lines.length - 1], /product.*2 ATTRIBUTE/);
    assert.ok(
      lines.every((l) => /\d+ [A-Z_]+$/.test(l.trimEnd())),
      'every line ends with a depth and its tier name'
    );
  });

  test('the bar length tracks depth, so asymmetry is visible at a glance', async () => {
    const result = await runScripted('asymmetric-depth');
    const bars = renderDepths(result)
      .split('\n')
      .map((l) => (l.match(/█+/)?.[0] ?? '').length);
    assert.ok(bars[0] > bars[bars.length - 1], 'the deepest branch draws the longest bar');
  });

  test('decisions carry their reason, not just their verdict', async () => {
    const result = await runScripted('asymmetric-depth');
    const rendered = renderDecisions(result);
    assert.match(rendered, /GO_DEEPER/);
    assert.match(rendered, /STOP/);
    assert.match(rendered, /Revenue is not defined/);
    assert.match(rendered, /→ customer, order/);
  });

  test('a stop is reported as a decision, not as a failure', async () => {
    const result = await runScripted('stop-early');
    const rendered = renderReport(result, '/tmp/out.json');
    assert.match(rendered, /stopped by the depth controller/);
    assert.ok(!rendered.includes('FAILED'));
  });

  test('a stalled run says so rather than claiming a clean stop', async () => {
    const result = await runScripted('never-stops');
    assert.match(renderReport(result, '/tmp/out.json'), /stopped by the stall detector/);
  });

  test('a failed run is unmistakable', async () => {
    const result = await runScripted('provider-failure');
    assert.match(renderReport(result, '/tmp/out.json'), /FAILED/);
  });

  test('remaining risks are always shown when the run produced them', async () => {
    const result = await runScripted('asymmetric-depth');
    const rendered = renderReport(result, '/tmp/out.json');
    assert.match(rendered, /What could still be got wrong/);
    for (const risk of result.completion!.remainingRisks) {
      assert.ok(rendered.includes(risk), 'no risk is truncated away');
    }
  });

  test('an empty ontology renders without throwing', async () => {
    const result = await runScripted('provider-failure');
    assert.match(renderDepths(result), /\(no nodes\)/);
    assert.match(renderDecisions(result), /\(none\)/);
  });

  test('fatal errors are prefixed and terminated', () => {
    const rendered = renderFatal('DATABASE_URL is required');
    assert.match(rendered, /ERROR/);
    assert.match(rendered, /DATABASE_URL is required/);
    assert.ok(rendered.endsWith('\n'));
  });
});
