# sample_rows

**Category:** table
**Target:** one table (`schema.table`)
**Interface method:** `DatabaseObserver.getSampleRows(table, limit)`
**Code:** `src/observation/PostgreSQLObserver.ts:200`

## What it answers

What the data actually looks like — real values, not just types and names.
Often the tool that turns "a `status` column, type text" into "a `status`
column whose values are `pending`/`paid`/`refunded`", which is the kind of
fact that upgrades an attribute into a concept.

## SQL (PostgreSQL)

```sql
SELECT * FROM "schema"."table" LIMIT $1
```

No `ORDER BY` — whatever the table's natural storage order returns. Not a
random sample.

## Limit

The model's requested `limit` is capped at `maxSampleRows` (default 20,
`PostgresObserverOptions.maxSampleRows`) — a model cannot ask for the whole
table under this tool's name.

## Returns

```
{ table, rows[] }
```

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
