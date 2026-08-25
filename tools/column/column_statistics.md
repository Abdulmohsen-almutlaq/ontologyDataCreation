# column_statistics

**Category:** column
**Target:** one column (`schema.table.column`)
**Interface method:** `DatabaseObserver.getColumnStatistics(column)`
**Code:** `src/observation/PostgreSQLObserver.ts:147`

## What it answers

How "used" a column actually is: null rate, how many distinct values it
carries, and its min/max — the numbers behind deciding whether a column is a
real attribute, an unused leftover, or a natural key candidate.

## SQL (PostgreSQL)

```sql
SELECT count(*) AS total_rows,
       count("column") AS non_null_rows,
       count(DISTINCT "column") AS distinct_values,
       min("column"::text) AS min_text,
       max("column"::text) AS max_text
  FROM "schema"."table"
```

One full-table scan. Everything is cast to `text` for min/max so this works
uniformly across column types.

## Returns

```
{ column, totalRows, nonNullRows, nullRate, distinctValues, distinctRatio, min, max }
```

`distinctRatio` is distinct values divided by non-null rows — close to 1
suggests a natural key; close to 0 suggests a category/status column.

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
