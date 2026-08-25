# schema_overview

**Category:** schema
**Target:** none — the whole configured schema
**Interface method:** `DatabaseObserver.getSchemaOverview()`
**Code:** `src/observation/PostgreSQLObserver.ts:63`

## What it answers

What tables, columns, primary keys and foreign keys exist at all. The one
tool that isn't requested by the model — the harness runs it automatically
as the first thing every run does, to seed `DiscoveryAgent`.

## SQL (PostgreSQL)

Four queries, run together:

```sql
-- tables
SELECT c.relname AS table, obj_description(c.oid) AS comment,
       c.reltuples::bigint AS estimated_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m')

-- columns
SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
  FROM information_schema.columns WHERE table_schema = $1

-- foreign keys
SELECT tc.constraint_name, tc.table_name AS from_table, kcu.column_name AS from_column,
       ccu.table_name AS to_table, ccu.column_name AS to_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON ...
  JOIN information_schema.constraint_column_usage ccu ON ...
 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1

-- primary keys
SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON ...
 WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
```

`c.reltuples` is a **planner estimate**, not `count(*)` — cheap, but can be
stale after a large bulk load until the next `ANALYZE`.

## Returns

```
{ schema, tables[], columns[], primaryKeys[], foreignKeys[] }
```

## Budget

Counts as one observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`, same
as every other tool — it is not free, just automatic.
