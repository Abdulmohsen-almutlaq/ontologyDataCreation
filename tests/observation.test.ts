import assert from 'node:assert/strict';
import * as path from 'node:path';
import test, { describe } from 'node:test';
import { Budget } from '../src/core/Budget';
import { FixtureObserver } from '../src/observation/FixtureObserver';
import {
  parseColumn,
  parseTable,
  type DatabaseObserver,
} from '../src/observation/Observation';
import {
  ObservationExecutor,
  validateEvidenceRequest,
} from '../src/observation/ObservationExecutor';
import { ROOT } from './helpers';

const limits = {
  maxDepth: 10,
  maxIterations: 25,
  maxLLMCalls: 100,
  maxNodes: 1000,
  maxObservationRequests: 3,
  maxRuntimeMs: 900_000,
};

function executor(observer: DatabaseObserver = FixtureObserver.fromDir(
  path.join(ROOT, 'tests/fixtures/observation')
)) {
  const budget = new Budget(limits);
  return {
    budget,
    observer,
    exec: new ObservationExecutor({ observer, budget, defaultSchema: 'public' }),
  };
}

describe('target parsing', () => {
  test('accepts bare and schema-qualified names', () => {
    assert.deepEqual(parseTable('orders', 'public'), { schema: 'public', table: 'orders' });
    assert.deepEqual(parseTable('sales.orders', 'public'), {
      schema: 'sales',
      table: 'orders',
    });
    assert.deepEqual(parseColumn('orders.status', 'public'), {
      schema: 'public',
      table: 'orders',
      column: 'status',
    });
  });

  test('rejects anything that is not a plain identifier', () => {
    // The model chooses which column to look at; it never supplies SQL.
    assert.throws(() => parseTable('orders; DROP TABLE customers', 'public'), /Illegal/);
    assert.throws(() => parseColumn('orders.status--', 'public'), /Illegal/);
    assert.throws(() => parseColumn('"weird"', 'public'), /Cannot parse/);
  });

  test('a malformed request is caught before it costs budget', () => {
    assert.match(
      validateEvidenceRequest(
        { id: 'r', target: 'orders', observationType: 'column_statistics', reason: '' },
        'public'
      )!,
      /expected table.column/
    );
    assert.equal(
      validateEvidenceRequest(
        { id: 'r', target: 'orders.status', observationType: 'column_statistics', reason: '' },
        'public'
      ),
      null
    );
    assert.match(
      validateEvidenceRequest(
        { id: 'r', target: 'orders.customer_id', observationType: 'distinct_overlap', reason: '' },
        'public'
      )!,
      /requires compareTo/
    );
  });
});

describe('observation executor', () => {
  test('runs a fixture-backed observation', async () => {
    const { exec, observer } = executor();
    await observer.connect();
    const observation = await exec.run(
      {
        id: 'r1',
        target: 'orders.status',
        observationType: 'value_distribution',
        reason: 'find the order states',
      },
      1
    );
    assert.equal(observation.ok, true);
    assert.match(JSON.stringify(observation.data), /cancelled/);
  });

  test('an observation of something that does not exist fails without throwing', async () => {
    const { exec, observer } = executor();
    await observer.connect();
    const observation = await exec.run(
      {
        id: 'r1',
        target: 'orders.nonexistent',
        observationType: 'column_statistics',
        reason: 'probe',
      },
      1
    );
    // The loop must survive a bad guess: a failed observation is information.
    assert.equal(observation.ok, false);
    assert.match(observation.error!, /no columnStatistics entry/);
  });

  test('an identical request is not paid for twice', async () => {
    const { exec, observer, budget } = executor();
    await observer.connect();
    const request = {
      id: 'r1',
      target: 'orders.status',
      observationType: 'value_distribution' as const,
      reason: 'again',
    };
    await exec.run(request, 1);
    await exec.run({ ...request, id: 'r2' }, 2);
    assert.equal(budget.observationRequests, 1);
  });

  test('the observation budget is enforced', async () => {
    const { exec, observer } = executor();
    await observer.connect();
    for (const target of ['orders.status', 'orders.currency']) {
      await exec.run(
        { id: target, target, observationType: 'value_distribution', reason: 'x' },
        1
      );
    }
    await exec.run(
      { id: 'c', target: 'customers.id', observationType: 'column_statistics', reason: 'x' },
      1
    );
    await assert.rejects(
      exec.run(
        { id: 'd', target: 'orders.total_amount', observationType: 'column_statistics', reason: 'x' },
        1
      ),
      /Observation budget exhausted/
    );
  });

  test('column overlap is found regardless of argument order', async () => {
    const { exec, observer } = executor();
    await observer.connect();
    const observation = await exec.run(
      {
        id: 'r',
        target: 'customers.id',
        compareTo: 'orders.customer_id',
        observationType: 'distinct_overlap',
        reason: 'confirm the relationship',
      },
      1
    );
    assert.equal(observation.ok, true);
  });

  test('an unreadable source surfaces as a connect failure', async () => {
    const observer = new FixtureObserver('/no/such/fixture.json');
    await assert.rejects(observer.connect(), /Unable to load observation fixture/);
  });
});
