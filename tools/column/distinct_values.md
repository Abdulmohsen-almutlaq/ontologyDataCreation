# distinct_values

**Category:** column
**Target:** one column (`schema.table.column`)
**Interface method:** `DatabaseObserver.getDistinctValues(column, limit)`
**Code:** `src/observation/PostgreSQLObserver.ts:171`

## What it answers

The actual vocabulary of a column — usually requested after
`column_statistics` shows a low distinct count, to see what those values
*are* (a `status` column reads very differently as `[active, inactive]` vs.
`[pending, paid, refunded, cancelled]`).

## SQL (PostgreSQL)

```sql
SELECT "column"::text AS value
  FROM "schema"."table"
 WHERE "column" IS NOT NULL
 GROUP BY 1 ORDER BY 1 LIMIT $1
```

Alphabetical, not by frequency — see `value_distribution` for that.

## Returns

```
{ column, values[] }
```

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
