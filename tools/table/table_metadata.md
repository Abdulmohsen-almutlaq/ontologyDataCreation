# table_metadata

**Category:** table
**Target:** one table (`schema.table`)
**Interface method:** `DatabaseObserver.getTableMetadata(table)`
**Code:** `src/observation/PostgreSQLObserver.ts:110`

## What it answers

Everything `schema_overview` doesn't have room for on one table: full column
detail (type, length, precision, comments), every index definition, every
constraint definition, and an **exact** row count.

## SQL (PostgreSQL)

Four queries, run in parallel via `Promise.all`:

```sql
-- columns, with comments this time
SELECT column_name, data_type, is_nullable, column_default,
       character_maximum_length, numeric_precision, numeric_scale,
       col_description(to_regclass(format('%I.%I', $1, $2)), ordinal_position)
  FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2

-- indexes
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2

-- constraints
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = to_regclass(format('%I.%I', $1, $2))

-- exact row count
SELECT count(*) FROM "schema"."table"
```

The row count is the one query here that scans the table — everything else
reads catalog metadata only.

## Returns

```
{ table, rowCount, columns[], indexes[], constraints[] }
```

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
