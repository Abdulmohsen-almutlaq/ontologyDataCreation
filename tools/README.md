# Tools

The nine fixed queries the model can run against a data source. Reference for
what exists — the actual code lives in `src/observation/`.

## The rule these all follow

The model picks a **type** and a **target** (a table or column name). It never
writes SQL. `src/observation/Observation.ts` validates and quotes every
identifier before anything reaches the database; `ObservationExecutor` is what
turns a model's request into one of these calls. See `DatabaseObserver` in
that file for the interface every tool implements.

## Index

| Tool | Category | Targets | What it answers |
|---|---|---|---|
| [`schema_overview`](schema/schema_overview.md) | schema | whole source | What tables, columns, keys exist at all? |
| [`table_metadata`](table/table_metadata.md) | table | one table | Full column/index/constraint detail and row count for one table |
| [`sample_rows`](table/sample_rows.md) | table | one table | What does the data actually look like? |
| [`relationship_evidence`](table/relationship_evidence.md) | table | one table | Declared foreign keys, plus naming-convention candidates for undeclared ones |
| [`column_statistics`](column/column_statistics.md) | column | one column | Null rate, distinct count, min/max |
| [`distinct_values`](column/distinct_values.md) | column | one column | Up to N distinct values |
| [`value_distribution`](column/value_distribution.md) | column | one column | The most frequent values and their share |
| [`distinct_overlap`](column/distinct_overlap.md) | column | two columns | How well one column's values are covered by another's |
| [`temporal_distribution`](column/temporal_distribution.md) | column | one column | Monthly row counts for a timestamp column |

## Why the split

`schema/` runs once, at the start of every run, to seed discovery (see the
main README, "How the harness gets the database tables"). `table/` and
`column/` are requested on demand by the model — the same split
`src/observation/Observation.ts` already encodes as `TABLE_TARGETED` and
`COLUMN_TARGETED`.

## What's implemented

Every tool here is backed by `PostgreSQLObserver`. A tool document that says
"PostgreSQL" means the SQL shown is real and covers the whole PostgreSQL
family the harness can connect to (`postgresql://`, `timescale://`,
`citus://`, `neon://`, `supabase://`, `alloydb://` — see `connect`/`sources`
in the interactive shell). Anything wire-compatible but not catalog-compatible
(Redshift, CockroachDB, ...) runs the same queries unverified against a
different catalog shape.
