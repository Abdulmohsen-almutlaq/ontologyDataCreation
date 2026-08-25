# value_distribution

**Category:** column
**Target:** one column (`schema.table.column`)
**Interface method:** `DatabaseObserver.getValueDistribution(column, limit)`
**Code:** `src/observation/PostgreSQLObserver.ts:182`

## What it answers

The same vocabulary as `distinct_values`, but ranked by how common each value
actually is — the difference between "this column can be A, B or C" and
"this column is 94% A."

## SQL (PostgreSQL)

```sql
SELECT "column"::text AS value, count(*) AS frequency
  FROM "schema"."table"
 GROUP BY 1 ORDER BY 2 DESC LIMIT $1
```

## Returns

```
{ column, distribution: [{ value, frequency, share }] }
```

`share` is frequency divided by the total across the returned rows only —
if the column has more distinct values than `limit`, `share` is relative to
what was fetched, not the whole table.

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
