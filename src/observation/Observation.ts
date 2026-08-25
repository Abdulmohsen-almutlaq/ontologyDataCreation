import type { EvidenceRequest, Observation, ObservationType } from '../core/types';

export interface TableRef {
  schema: string;
  table: string;
}

export interface ColumnRef extends TableRef {
  column: string;
}

export class ObservationError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'ObservationError';
  }
}

/**
 * The deterministic observation surface.
 *
 * These are the ONLY questions that can be asked of a data source. The LLM
 * selects among them and supplies targets; it never supplies SQL, and every
 * identifier is validated and quoted before it reaches the database.
 */
export interface DatabaseObserver {
  readonly kind: string;
  connect(): Promise<void>;
  close(): Promise<void>;

  /** cheap whole-source map used to seed discovery */
  getSchemaOverview(): Promise<unknown>;
  getTableMetadata(table: TableRef): Promise<unknown>;
  getColumnStatistics(column: ColumnRef): Promise<unknown>;
  getDistinctValues(column: ColumnRef, limit: number): Promise<unknown>;
  getValueDistribution(column: ColumnRef, limit: number): Promise<unknown>;
  getSampleRows(table: TableRef, limit: number): Promise<unknown>;
  /** how well the values of one column are covered by another */
  getColumnOverlap(left: ColumnRef, right: ColumnRef): Promise<unknown>;
  /** declared + inferred foreign key evidence for a table */
  getRelationshipEvidence(table: TableRef): Promise<unknown>;
  getTemporalDistribution(column: ColumnRef): Promise<unknown>;
}

export interface ObservationRunner {
  run(request: EvidenceRequest, iteration: number): Promise<Observation>;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function assertIdentifier(value: string, what: string): string {
  if (!IDENT.test(value)) {
    throw new ObservationError(
      `Illegal ${what} "${value}": identifiers must match ${IDENT}`,
      'ILLEGAL_IDENTIFIER'
    );
  }
  return value;
}

/** Parses "orders" / "public.orders" into a table reference. */
export function parseTable(target: string, defaultSchema: string): TableRef {
  const parts = target.split('.').filter(Boolean);
  if (parts.length === 1) {
    return { schema: defaultSchema, table: assertIdentifier(parts[0], 'table') };
  }
  if (parts.length === 2) {
    return {
      schema: assertIdentifier(parts[0], 'schema'),
      table: assertIdentifier(parts[1], 'table'),
    };
  }
  throw new ObservationError(
    `Cannot parse table target "${target}"`,
    'BAD_TARGET'
  );
}

/** Parses "orders.total" / "public.orders.total" into a column reference. */
export function parseColumn(target: string, defaultSchema: string): ColumnRef {
  const parts = target.split('.').filter(Boolean);
  if (parts.length === 2) {
    return {
      schema: defaultSchema,
      table: assertIdentifier(parts[0], 'table'),
      column: assertIdentifier(parts[1], 'column'),
    };
  }
  if (parts.length === 3) {
    return {
      schema: assertIdentifier(parts[0], 'schema'),
      table: assertIdentifier(parts[1], 'table'),
      column: assertIdentifier(parts[2], 'column'),
    };
  }
  throw new ObservationError(
    `Cannot parse column target "${target}" (expected table.column)`,
    'BAD_TARGET'
  );
}

export const COLUMN_TARGETED: ReadonlySet<ObservationType> = new Set<ObservationType>([
  'column_statistics',
  'distinct_values',
  'value_distribution',
  'distinct_overlap',
  'temporal_distribution',
]);

export const TABLE_TARGETED: ReadonlySet<ObservationType> = new Set<ObservationType>([
  'table_metadata',
  'sample_rows',
  'relationship_evidence',
]);

export function formatObservations(observations: Observation[], limit = 20): string {
  if (!observations.length) return '  (none)';
  return observations
    .slice(-limit)
    .map((o) => {
      const head = `  [${o.id}] ${o.observationType} @ ${o.target}`;
      if (!o.ok) return `${head} -> FAILED: ${o.error}`;
      return `${head}\n${indent(JSON.stringify(o.data, null, 2), 6)}`;
    })
    .join('\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}
