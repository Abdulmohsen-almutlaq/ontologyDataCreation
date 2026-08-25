import assert from 'node:assert/strict';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import { buildContext } from '../src/agents/context';
import { composeHarness } from '../src/composition/CompositionRoot';
import { createLogger } from '../src/config/logger';
import { createState } from '../src/exploration/ExplorationState';
import type { MockClient } from '../src/llm/MockProvider';
import { OntologyHarness } from '../src/OntologyHarness';
import { PromptLoader } from '../src/prompts/PromptLoader';
import { ROOT, testConfig } from './helpers';

describe('expected schema hint', () => {
  test('buildContext falls back to a neutral placeholder when unset', () => {
    const context = buildContext(createState('run', 'shop'));
    assert.equal(context.EXPECTED_SCHEMA, '(none provided)');
  });

  test('buildContext carries the rendered text through when supplied', () => {
    const context = buildContext(createState('run', 'shop'), {
      expectedSchema: 'a customers table and an orders table',
    });
    assert.equal(context.EXPECTED_SCHEMA, 'a customers table and an orders table');
  });

  test('the prompt frames the hint as unverified, not as fact', async () => {
    const loader = new PromptLoader({ dir: path.join(ROOT, 'prompts'), version: 'v1' });
    const rendered = await loader.render('ontology/expected-schema', {
      EXPECTED_SCHEMA_TEXT: 'a customers table and an orders table',
    });
    assert.match(rendered.rendered, /a customers table and an orders table/);
    assert.match(rendered.rendered, /not as fact/);
    assert.deepEqual(rendered.missingVariables, []);
  });

  test('set - the discovery prompt actually carries the hint text', async () => {
    const config = testConfig('stop-early', {
      EXPECTED_SCHEMA: 'a customers table and an orders table',
    });
    const logger = createLogger('silent');
    const components = composeHarness({ config, logger, runId: 'expected-schema-test' });
    const client = components.client as MockClient;

    const harness = new OntologyHarness({ config, logger, components });
    const result = await harness.run(OntologyHarness.sourceFromConfig(config));

    assert.equal(result.status, 'COMPLETED');
    const discoveryCall = client.calls.find((c) => c.label === 'discovery');
    assert.ok(discoveryCall, 'discovery was called');
    assert.match(
      discoveryCall!.prompt,
      /a customers table and an orders table/,
      'the rendered expected-schema block reached the actual prompt sent to the model'
    );
    assert.match(discoveryCall!.prompt, /not as fact/, 'with its verify-first framing intact');
  });

  test('unset - discovery gets the neutral placeholder, not an empty section', async () => {
    const config = testConfig('stop-early');
    assert.equal(config.source.expectedSchema, undefined);

    const logger = createLogger('silent');
    const components = composeHarness({ config, logger, runId: 'expected-schema-test-2' });
    const client = components.client as MockClient;

    const harness = new OntologyHarness({ config, logger, components });
    await harness.run(OntologyHarness.sourceFromConfig(config));

    const discoveryCall = client.calls.find((c) => c.label === 'discovery');
    assert.match(discoveryCall!.prompt, /\(none provided\)/);
  });
});
