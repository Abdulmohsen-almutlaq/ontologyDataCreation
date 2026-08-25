import { Pool } from 'pg';
import type { ColumnRef, DatabaseObserver, TableRef } from './Observation';
import { assertIdentifier } from './Observation';

export interface PostgresObserverOptions {
  databaseUrl: string;
  schema: string;
  statementTimeoutMs?: number;
  maxSampleRows?: number;
}

/**
 * Validates and quotes an identifier.
 *
 * The executor already parses targets through `parseTable`/`parseColumn`, but
 * this class must not depend on that: it is the last thing standing between a
 * string and a SQL statement, so it re-checks rather than trusting its caller.
 */
function q(ident: string, what = 'identifier'): string {
  return `"${assertIdentifier(ident, what)}"`;
}

function fq(ref: TableRef): string {
  return `${q(ref.schema, 'schema')}.${q(ref.table, 'table')}`;
}

/**
 * PostgreSQL observation layer.
 *
 * Every method is a fixed query template. Identifiers are validated against a
 * strict pattern and quoted before interpolation, and values are always bound
 * as parameters: the model can choose WHICH table or column to look at, never
 * WHAT SQL runs. Statement timeouts bound the cost of any single observation on
 * a large table.
 */
export class PostgreSQLObserver implements DatabaseObserver {
  readonly kind = 'postgres';
  private pool?: Pool;

  constructor(private readonly options: PostgresObserverOptions) {}

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = new Pool({
      connectionString: this.options.databaseUrl,
      max: 4,
      statement_timeout: this.options.statementTimeoutMs ?? 30_000,
    });
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }

  private async query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    if (!this.pool) throw new Error('PostgreSQLObserver is not connected');
    const res = await this.pool.query(text, params as any[]);
    return res.rows as T[];
  }

  async getSchemaOverview(): Promise<unknown> {
    const schema = assertIdentifier(this.options.schema, 'schema');
    const tables = await this.query(
      `SELECT c.relname AS table,
              obj_description(c.oid) AS comment,
              c.reltuples::bigint AS estimated_rows
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m')
        ORDER BY c.relname`,
      [schema]
    );
    const columns = await this.query(
      `SELECT table_name AS table, column_name AS column, data_type AS type,
              is_nullable = 'YES' AS nullable, column_default AS default_value,
              ordinal_position
         FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position`,
      [schema]
    );
    const foreignKeys = await this.query(
      `SELECT tc.constraint_name, tc.table_name AS from_table,
              kcu.column_name AS from_column,
              ccu.table_name AS to_table, ccu.column_name AS to_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [schema]
    );
    const primaryKeys = await this.query(
      `SELECT tc.table_name AS table, kcu.column_name AS column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1`,
      [schema]
    );
    return { schema, tables, columns, primaryKeys, foreignKeys };
  }

  async getTableMetadata(table: TableRef): Promise<unknown> {
    // Validate before dispatching anything, not while building the last query.
    fq(table);
    const [columns, indexes, constraints, rowCount] = await Promise.all([
      this.query(
        `SELECT column_name AS column, data_type AS type,
                is_nullable = 'YES' AS nullable, column_default AS default_value,
                character_maximum_length AS max_length,
                numeric_precision, numeric_scale,
                col_description(to_regclass(format('%I.%I', $1::text, $2::text)), ordinal_position) AS comment
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        [table.schema, table.table]
      ),
      this.query(
        `SELECT indexname AS name, indexdef AS definition
           FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        [table.schema, table.table]
      ),
      this.query(
        `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = to_regclass(format('%I.%I', $1::text, $2::text))`,
        [table.schema, table.table]
      ),
      this.query(`SELECT count(*)::bigint AS exact_rows FROM ${fq(table)}`),
    ]);
    return {
      table: `${table.schema}.${table.table}`,
      rowCount: rowCount[0]?.exact_rows ?? null,
      columns,
      indexes,
      constraints,
    };
  }

  async getColumnStatistics(column: ColumnRef): Promise<unknown> {
    const rows = await this.query(
      `SELECT count(*)::bigint AS total_rows,
              count(${q(column.column, 'column')})::bigint AS non_null_rows,
              count(DISTINCT ${q(column.column, 'column')})::bigint AS distinct_values,
              min(${q(column.column, 'column')}::text) AS min_text,
              max(${q(column.column, 'column')}::text) AS max_text
         FROM ${fq(column)}`
    );
    const r = rows[0] ?? {};
    const total = Number(r.total_rows ?? 0);
    const nonNull = Number(r.non_null_rows ?? 0);
    return {
      column: `${column.table}.${column.column}`,
      totalRows: total,
      nonNullRows: nonNull,
      nullRate: total ? Number(((total - nonNull) / total).toFixed(4)) : 0,
      distinctValues: Number(r.distinct_values ?? 0),
      distinctRatio: nonNull ? Number((Number(r.distinct_values) / nonNull).toFixed(4)) : 0,
      min: r.min_text,
      max: r.max_text,
    };
  }

  async getDistinctValues(column: ColumnRef, limit: number): Promise<unknown> {
    const rows = await this.query(
      `SELECT ${q(column.column, 'column')}::text AS value
         FROM ${fq(column)}
        WHERE ${q(column.column, 'column')} IS NOT NULL
        GROUP BY 1 ORDER BY 1 LIMIT $1`,
      [limit]
    );
    return { column: `${column.table}.${column.column}`, values: rows.map((r) => r.value) };
  }

  async getValueDistribution(column: ColumnRef, limit: number): Promise<unknown> {
    const rows = await this.query(
      `SELECT ${q(column.column, 'column')}::text AS value, count(*)::bigint AS frequency
         FROM ${fq(column)}
        GROUP BY 1 ORDER BY 2 DESC LIMIT $1`,
      [limit]
    );
    const total = rows.reduce((n, r) => n + Number(r.frequency), 0);
    return {
      column: `${column.table}.${column.column}`,
      distribution: rows.map((r) => ({
        value: r.value,
        frequency: Number(r.frequency),
        share: total ? Number((Number(r.frequency) / total).toFixed(4)) : 0,
      })),
    };
  }

  async getSampleRows(table: TableRef, limit: number): Promise<unknown> {
    const capped = Math.min(limit, this.options.maxSampleRows ?? 20);
    const rows = await this.query(`SELECT * FROM ${fq(table)} LIMIT $1`, [capped]);
    return { table: `${table.schema}.${table.table}`, rows };
  }

  async getColumnOverlap(left: ColumnRef, right: ColumnRef): Promise<unknown> {
    const rows = await this.query(
      `WITH l AS (SELECT DISTINCT ${q(left.column, 'column')}::text AS v FROM ${fq(left)} WHERE ${q(left.column, 'column')} IS NOT NULL),
            r AS (SELECT DISTINCT ${q(right.column, 'column')}::text AS v FROM ${fq(right)} WHERE ${q(right.column, 'column')} IS NOT NULL)
       SELECT (SELECT count(*) FROM l)::bigint AS left_distinct,
              (SELECT count(*) FROM r)::bigint AS right_distinct,
              (SELECT count(*) FROM l JOIN r USING (v))::bigint AS shared`
    );
    const r = rows[0] ?? {};
    const l = Number(r.left_distinct ?? 0);
    const rr = Number(r.right_distinct ?? 0);
    const shared = Number(r.shared ?? 0);
    return {
      left: `${left.table}.${left.column}`,
      right: `${right.table}.${right.column}`,
      leftDistinct: l,
      rightDistinct: rr,
      shared,
      leftCoveredByRight: l ? Number((shared / l).toFixed(4)) : 0,
      rightCoveredByLeft: rr ? Number((shared / rr).toFixed(4)) : 0,
    };
  }

  async getRelationshipEvidence(table: TableRef): Promise<unknown> {
    fq(table);
    const declared = await this.query(
      `SELECT tc.constraint_name, kcu.column_name AS from_column,
              ccu.table_name AS to_table, ccu.column_name AS to_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = $1 AND tc.table_name = $2`,
      [table.schema, table.table]
    );
    // Naming-convention candidates for relationships the schema never declared.
    const candidates = await this.query(
      `SELECT c.column_name AS from_column, t.table_name AS candidate_table
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema
        WHERE c.table_schema = $1 AND c.table_name = $2
          AND c.column_name LIKE '%\\_id'
          AND t.table_name <> $2
          AND (t.table_name = replace(c.column_name, '_id', '')
               OR t.table_name = replace(c.column_name, '_id', '') || 's')`,
      [table.schema, table.table]
    );
    return {
      table: `${table.schema}.${table.table}`,
      declaredForeignKeys: declared,
      undeclaredCandidates: candidates,
    };
  }

  async getTemporalDistribution(column: ColumnRef): Promise<unknown> {
    const rows = await this.query(
      `SELECT date_trunc('month', ${q(column.column, 'column')}::timestamptz) AS bucket,
              count(*)::bigint AS frequency
         FROM ${fq(column)}
        WHERE ${q(column.column, 'column')} IS NOT NULL
        GROUP BY 1 ORDER BY 1 LIMIT 60`
    );
    return {
      column: `${column.table}.${column.column}`,
      buckets: rows.map((r) => ({ bucket: r.bucket, frequency: Number(r.frequency) })),
    };
  }
}
