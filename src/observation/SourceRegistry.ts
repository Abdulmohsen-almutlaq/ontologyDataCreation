import { ObservationError, type DatabaseObserver } from './Observation';
import { parseConnectionUrl, withScheme, type ParsedConnection } from './connection';
import { PostgreSQLObserver } from './PostgreSQLObserver';

/**
 * Connect-by-link: a URL scheme selects the driver that observes it.
 *
 * Mirrors LLMRegistry deliberately. Adding a warehouse is one driver object and
 * one registration; nothing in the ontology, the agents or the exploration loop
 * knows which system produced an observation.
 */

/**
 * How far a driver has actually been taken.
 *
 * The distinction that matters is NOT whether a system speaks the PostgreSQL
 * wire protocol — plenty do — but whether it serves a real `pg_catalog`.
 * `PostgreSQLObserver` is ten fixed queries against `pg_class`, `pg_namespace`,
 * `obj_description()` and `reltuples`. Redshift forked before those existed in
 * their current form, CockroachDB emulates them with `reltuples` unpopulated,
 * and Materialize is not a table engine in that sense. Such a source connects
 * and then fails, or worse, silently reports nothing — so it gets its own tier
 * rather than being called supported.
 */
export type SourceSupport =
  /** observation queries verified against a live instance */
  | 'verified'
  /** connects through a verified driver; the queries themselves are untested here */
  | 'wire-compatible'
  /** recognised, deliberately not built */
  | 'unimplemented';

export interface SourceDriverOptions {
  connection: ParsedConnection;
  schema: string;
  statementTimeoutMs?: number;
}

export interface SourceDriver {
  readonly name: string;
  readonly schemes: readonly string[];
  readonly support: SourceSupport;
  /** shown when the driver cannot be used, e.g. the package it would need */
  readonly requires?: string;
  /** shown on selection when there is something the user must know */
  readonly note?: string;
  createObserver(options: SourceDriverOptions): DatabaseObserver;
}

function unavailable(driver: SourceDriver): never {
  throw new ObservationError(
    `No observer is implemented for ${driver.name}. ` +
      (driver.requires
        ? `Building one needs ${driver.requires}, plus the ten queries in the ` +
          'DatabaseObserver interface expressed in its dialect.'
        : 'The DatabaseObserver interface is the contract to implement.'),
    'SOURCE_NOT_IMPLEMENTED'
  );
}

/** PostgreSQL proper, and the systems that really are PostgreSQL underneath. */
export const postgresDriver: SourceDriver = {
  name: 'PostgreSQL',
  schemes: [
    'postgres',
    'postgresql',
    // Extensions and hosted stock PostgreSQL: same catalogs, same queries.
    'timescale',
    'timescaledb',
    'citus',
    'neon',
    'supabase',
    'alloydb',
  ],
  support: 'verified',
  createObserver({ connection, schema, statementTimeoutMs }): DatabaseObserver {
    return new PostgreSQLObserver({
      // `pg` only accepts the two canonical schemes; every alias above is the
      // same database wearing a different label.
      databaseUrl: withScheme(connection.raw, 'postgresql'),
      schema,
      statementTimeoutMs,
    });
  },
};

/**
 * Speaks the PostgreSQL wire protocol without serving PostgreSQL's catalogs.
 *
 * Connecting works. Whether the observation queries return anything useful is
 * the open question, so this tier says so rather than pretending.
 */
export const postgresWireDriver: SourceDriver = {
  name: 'PostgreSQL-wire-compatible',
  schemes: [
    'redshift',
    'cockroach',
    'cockroachdb',
    'crdb',
    'greenplum',
    'yugabyte',
    'ysql',
    'materialize',
    'risingwave',
  ],
  support: 'wire-compatible',
  note:
    'connects through the PostgreSQL driver, but the observation queries read ' +
    'pg_catalog (pg_class, reltuples, obj_description) and this system does not ' +
    'serve it the same way. Expect some observations to fail or come back empty.',
  createObserver({ connection, schema, statementTimeoutMs }): DatabaseObserver {
    return new PostgreSQLObserver({
      databaseUrl: withScheme(connection.raw, 'postgresql'),
      schema,
      statementTimeoutMs,
    });
  },
};

/** Recognised so the error names the work, instead of "unknown scheme". */
function notImplemented(
  name: string,
  schemes: string[],
  requires: string
): SourceDriver {
  const driver: SourceDriver = {
    name,
    schemes,
    support: 'unimplemented',
    requires,
    createObserver: () => unavailable(driver),
  };
  return driver;
}

export const unimplementedDrivers: SourceDriver[] = [
  notImplemented('MySQL / MariaDB', ['mysql', 'mariadb'], 'the `mysql2` package'),
  notImplemented('Snowflake', ['snowflake'], 'the `snowflake-sdk` package'),
  notImplemented('BigQuery', ['bigquery', 'bq'], 'the `@google-cloud/bigquery` package'),
  notImplemented('Databricks', ['databricks'], 'the `@databricks/sql` package'),
  notImplemented(
    'SQL Server',
    ['mssql', 'sqlserver'],
    'the `mssql` package'
  ),
  notImplemented('ClickHouse', ['clickhouse'], 'the `@clickhouse/client` package'),
  notImplemented('DuckDB', ['duckdb'], 'the `duckdb` package'),
  notImplemented('SQLite', ['sqlite'], 'the `better-sqlite3` package'),
  notImplemented('Trino / Presto', ['trino', 'presto'], 'the `trino-client` package'),
  notImplemented('Athena', ['athena'], 'the `@aws-sdk/client-athena` package'),
  notImplemented('Oracle', ['oracle', 'oracledb'], 'the `oracledb` package'),
];

export class SourceRegistry {
  private readonly drivers = new Map<string, SourceDriver>();

  register(driver: SourceDriver): this {
    for (const scheme of driver.schemes) {
      this.drivers.set(scheme.toLowerCase(), driver);
    }
    return this;
  }

  has(scheme: string): boolean {
    return this.drivers.has(scheme.toLowerCase());
  }

  /** Schemes that can actually observe something, for error messages. */
  usableSchemes(): string[] {
    return [...this.drivers.entries()]
      .filter(([, d]) => d.support !== 'unimplemented')
      .map(([scheme]) => scheme)
      .sort();
  }

  /** Every registered scheme and the driver behind it, sorted by scheme. */
  list(): Array<{ scheme: string; driver: SourceDriver }> {
    return [...this.drivers.entries()]
      .map(([scheme, driver]) => ({ scheme, driver }))
      .sort((a, b) => a.scheme.localeCompare(b.scheme));
  }

  get(scheme: string): SourceDriver {
    const driver = this.drivers.get(scheme.toLowerCase());
    if (!driver) {
      throw new ObservationError(
        `No driver is registered for "${scheme}://". ` +
          `Connectable schemes: ${this.usableSchemes().join(', ')}.`,
        'UNKNOWN_SOURCE_SCHEME'
      );
    }
    return driver;
  }

  /** Resolves a URL to its driver without constructing anything. */
  resolve(url: string): { driver: SourceDriver; connection: ParsedConnection } {
    const connection = parseConnectionUrl(url);
    return { driver: this.get(connection.scheme), connection };
  }

  createObserver(
    url: string,
    schema: string,
    statementTimeoutMs?: number
  ): { observer: DatabaseObserver; driver: SourceDriver; connection: ParsedConnection } {
    const { driver, connection } = this.resolve(url);
    return {
      observer: driver.createObserver({ connection, schema, statementTimeoutMs }),
      driver,
      connection,
    };
  }
}

export function defaultSourceRegistry(): SourceRegistry {
  const registry = new SourceRegistry()
    .register(postgresDriver)
    .register(postgresWireDriver);
  for (const driver of unimplementedDrivers) registry.register(driver);
  return registry;
}
