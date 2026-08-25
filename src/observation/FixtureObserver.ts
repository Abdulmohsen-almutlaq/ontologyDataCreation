import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ColumnRef, DatabaseObserver, TableRef } from './Observation';
import { ObservationError } from './Observation';

interface FixtureFile {
  schemaOverview?: unknown;
  /** keyed by observation type, then by target, e.g. tableMetadata["public.orders"] */
  tableMetadata?: Record<string, unknown>;
  columnStatistics?: Record<string, unknown>;
  distinctValues?: Record<string, unknown>;
  valueDistribution?: Record<string, unknown>;
  sampleRows?: Record<string, unknown>;
  columnOverlap?: Record<string, unknown>;
  relationshipEvidence?: Record<string, unknown>;
  temporalDistribution?: Record<string, unknown>;
}

/**
 * File-backed observer implementing the same interface as PostgreSQL.
 *
 * This exists so the exploration loop can be exercised end to end - including
 * targeted follow-up observations - without a live database, and so that
 * regression tests over depth behaviour are deterministic.
 */
export class FixtureObserver implements DatabaseObserver {
  readonly kind = 'fixture';
  private data: FixtureFile = {};

  constructor(
    private readonly file: string,
    private readonly defaultSchema = 'public'
  ) {}

  static fromDir(dir: string, name = 'ecommerce.json', schema = 'public') {
    return new FixtureObserver(path.join(dir, name), schema);
  }

  async connect(): Promise<void> {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as FixtureFile;
    } catch (err) {
      throw new ObservationError(
        `Unable to load observation fixture ${this.file}: ${(err as Error).message}`,
        'FIXTURE_UNREADABLE'
      );
    }
  }

  async close(): Promise<void> {
    this.data = {};
  }

  private lookup(bucket: keyof FixtureFile, key: string, alt?: string): unknown {
    const map = this.data[bucket] as Record<string, unknown> | undefined;
    if (!map) {
      throw new ObservationError(
        `Fixture has no "${bucket}" section`,
        'FIXTURE_MISSING'
      );
    }
    const hit = map[key] ?? (alt !== undefined ? map[alt] : undefined);
    if (hit === undefined) {
      throw new ObservationError(
        `Fixture has no ${bucket} entry for "${key}"`,
        'FIXTURE_MISSING'
      );
    }
    return hit;
  }

  private t(ref: TableRef): [string, string] {
    return [`${ref.schema}.${ref.table}`, ref.table];
  }

  private c(ref: ColumnRef): [string, string] {
    return [`${ref.schema}.${ref.table}.${ref.column}`, `${ref.table}.${ref.column}`];
  }

  async getSchemaOverview(): Promise<unknown> {
    if (this.data.schemaOverview === undefined) {
      throw new ObservationError('Fixture has no schemaOverview', 'FIXTURE_MISSING');
    }
    return this.data.schemaOverview;
  }

  async getTableMetadata(table: TableRef) {
    return this.lookup('tableMetadata', ...this.t(table));
  }

  async getColumnStatistics(column: ColumnRef) {
    return this.lookup('columnStatistics', ...this.c(column));
  }

  async getDistinctValues(column: ColumnRef) {
    return this.lookup('distinctValues', ...this.c(column));
  }

  async getValueDistribution(column: ColumnRef) {
    return this.lookup('valueDistribution', ...this.c(column));
  }

  async getSampleRows(table: TableRef) {
    return this.lookup('sampleRows', ...this.t(table));
  }

  async getColumnOverlap(left: ColumnRef, right: ColumnRef) {
    const key = `${left.table}.${left.column}|${right.table}.${right.column}`;
    const reversed = `${right.table}.${right.column}|${left.table}.${left.column}`;
    return this.lookup('columnOverlap', key, reversed);
  }

  async getRelationshipEvidence(table: TableRef) {
    return this.lookup('relationshipEvidence', ...this.t(table));
  }

  async getTemporalDistribution(column: ColumnRef) {
    return this.lookup('temporalDistribution', ...this.c(column));
  }
}
