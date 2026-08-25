# temporal_distribution

**Category:** column
**Target:** one column (`schema.table.column`), expected to be a timestamp
**Interface method:** `DatabaseObserver.getTemporalDistribution(column)`
**Code:** `src/observation/PostgreSQLObserver.ts:262`

## What it answers

How activity on a timestamp column is spread over time — whether an `events`
table is a steady stream or spiky, whether a `created_at` column has a
plausible history or just one bulk-loaded month. Feeds the metric/event
reasoning more than the entity reasoning.

## SQL (PostgreSQL)

```sql
SELECT date_trunc('month', "column"::timestamptz) AS bucket, count(*) AS frequency
  FROM "schema"."table"
 WHERE "column" IS NOT NULL
 GROUP BY 1 ORDER BY 1 LIMIT 60
```

Fixed at monthly buckets, hard-capped at 60 (five years) — not
model-configurable.

## Returns

```
{ column, buckets: [{ bucket, frequency }] }
```

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
