# relationship_evidence

**Category:** table
**Target:** one table (`schema.table`)
**Interface method:** `DatabaseObserver.getRelationshipEvidence(table)`
**Code:** `src/observation/PostgreSQLObserver.ts:229`

## What it answers

Two different questions in one call: what foreign keys does the schema
**declare** for this table, and what columns **look like** foreign keys but
were never declared as one (a `customer_id` column with no constraint, on a
database where the migration never got around to adding it).

## SQL (PostgreSQL)

```sql
-- declared
SELECT tc.constraint_name, kcu.column_name AS from_column,
       ccu.table_name AS to_table, ccu.column_name AS to_column
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON ...
  JOIN information_schema.constraint_column_usage ccu ON ...
 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2

-- undeclared candidates, by naming convention
SELECT c.column_name, t.table_name AS candidate_table
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema
 WHERE c.table_schema = $1 AND c.table_name = $2
   AND c.column_name LIKE '%\_id'
   AND t.table_name <> $2
   AND (t.table_name = replace(c.column_name, '_id', '')
        OR t.table_name = replace(c.column_name, '_id', '') || 's')
```

The naming-convention half only matches `..._id` against a table named
either the singular or the plural of what's left. It will miss a foreign key
named against a genuinely different convention — evidence, not proof.

## Returns

```
{ table, declaredForeignKeys[], undeclaredCandidates[] }
```

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`.
