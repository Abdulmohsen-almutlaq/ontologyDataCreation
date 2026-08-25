import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { PostgreSQLObserver } from '../src/observation/PostgreSQLObserver';

/**
 * Live PostgreSQL coverage.
 *
 * Every query in the observer is a hand-written SQL template; none of it is
 * exercised by the fixture observer. These tests run against the schema in
 * `sql/001-seed.sql`:
 *
 *   docker compose up -d postgres
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ontology npm test
 *
 * They skip - rather than fail - when no database is configured, so the default
 * suite stays runnable offline.
 */
const url = process.env.TEST_DATABASE_URL;

describe('PostgreSQL observer', { skip: url ? false : 'TEST_DATABASE_URL not set' }, () => {
  const observer = new PostgreSQLObserver({ databaseUrl: url ?? '', schema: 'public' });
  const orders = { schema: 'public', table: 'orders' };
  const status = { ...orders, column: 'status' };

  before(async () => observer.connect());
  after(async () => observer.close());

  test('schema overview reports tables, keys and columns', async () => {
    const overview = (await observer.getSchemaOverview()) as any;
    assert.ok(overview.tables.some((t: any) => t.table === 'orders'));
    assert.ok(overview.primaryKeys.some((k: any) => k.table === 'customers'));
    assert.ok(
      overview.foreignKeys.some(
        (f: any) => f.from_table === 'orders' && f.to_table === 'customers'
      )
    );
    assert.ok(
      !overview.foreignKeys.some((f: any) => f.from_table === 'refunds'),
      'refunds has no declared foreign key, which the harness must discover by measurement'
    );
  });

  test('table metadata resolves columns, indexes, constraints and row count', async () => {
    // The constraint query casts a built identifier to regclass, which is the
    // most fragile statement in the observer.
    const metadata = (await observer.getTableMetadata(orders)) as any;
    assert.equal(Number(metadata.rowCount), 5);
    assert.ok(metadata.columns.some((c: any) => c.column === 'total_amount'));
    assert.ok(metadata.constraints.length > 0);
    assert.ok(Array.isArray(metadata.indexes));
  });

  test('a quoted, mixed-case relation is observed correctly', async () => {
    // Identifiers are folded to lowercase unless quoted, so an unquoted
    // interpolation would look up "ordernotes" and fail on this table.
    const metadata = (await observer.getTableMetadata({
      schema: 'public',
      table: 'OrderNotes',
    })) as any;
    assert.equal(Number(metadata.rowCount), 1);
    assert.ok(metadata.constraints.length > 0, 'constraints resolve for a quoted relation');
    assert.ok(metadata.columns.some((c: any) => c.column === 'orderId'));

    const stats = (await observer.getColumnStatistics({
      schema: 'public',
      table: 'OrderNotes',
      column: 'orderId',
    })) as any;
    assert.equal(stats.totalRows, 1);
  });

  test('column statistics compute null rate and distinctness', async () => {
    const stats = (await observer.getColumnStatistics({
      ...orders,
      column: 'total_amount',
    })) as any;
    assert.equal(stats.totalRows, 5);
    assert.equal(stats.nullRate, 0);
    assert.ok(stats.distinctRatio > 0 && stats.distinctRatio <= 1);
  });

  test('distinct values and distributions read a status column', async () => {
    const distinct = (await observer.getDistinctValues(status, 10)) as any;
    assert.ok(distinct.values.includes('cancelled'));

    const distribution = (await observer.getValueDistribution(status, 10)) as any;
    const shares = distribution.distribution.reduce(
      (n: number, d: any) => n + d.share,
      0
    );
    assert.ok(Math.abs(shares - 1) < 0.01, 'shares should sum to roughly one');
  });

  test('sample rows are capped', async () => {
    const sample = (await observer.getSampleRows(orders, 2)) as any;
    assert.equal(sample.rows.length, 2);
  });

  test('column overlap measures an undeclared relationship', async () => {
    // refunds.order_id has no foreign key: coverage is the only evidence.
    const overlap = (await observer.getColumnOverlap(
      { schema: 'public', table: 'refunds', column: 'order_id' },
      { ...orders, column: 'id' }
    )) as any;
    assert.equal(overlap.leftCoveredByRight, 1, 'every refund points at a real order');
    assert.ok(overlap.rightCoveredByLeft < 1, 'most orders were never refunded');
  });

  test('relationship evidence separates declared keys from candidates', async () => {
    const declared = (await observer.getRelationshipEvidence(orders)) as any;
    assert.ok(
      declared.declaredForeignKeys.some((f: any) => f.to_table === 'customers')
    );

    const undeclared = (await observer.getRelationshipEvidence({
      schema: 'public',
      table: 'refunds',
    })) as any;
    assert.equal(undeclared.declaredForeignKeys.length, 0);
    assert.ok(
      undeclared.undeclaredCandidates.some((c: any) => c.candidate_table === 'orders'),
      'naming convention should surface refunds.order_id -> orders'
    );
  });

  test('temporal distribution buckets a timestamp column', async () => {
    const temporal = (await observer.getTemporalDistribution({
      ...orders,
      column: 'placed_at',
    })) as any;
    assert.ok(temporal.buckets.length >= 1);
    assert.ok(temporal.buckets[0].frequency > 0);
  });

  test('an injection attempt never reaches the database', async () => {
    await assert.rejects(
      observer.getSampleRows({ schema: 'public', table: 'orders; DROP TABLE customers' }, 1),
      /Illegal|syntax/
    );
    const stats = (await observer.getColumnStatistics({
      ...orders,
      column: 'total_amount',
    })) as any;
    assert.equal(stats.totalRows, 5, 'the table is still there');
  });
});
