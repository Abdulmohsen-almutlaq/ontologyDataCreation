# distinct_overlap

**Category:** column
**Target:** two columns — `target` and `compareTo`, both required
**Interface method:** `DatabaseObserver.getColumnOverlap(left, right)`
**Code:** `src/observation/PostgreSQLObserver.ts:206`

## What it answers

The one tool that measures a relationship the schema never declared: how much
of one column's value set is covered by another's. This is how the harness
finds a foreign key nobody constrained — `orders.customer_id` values that are
90% present in `customers.legacy_id`, say.

Requesting this without `compareTo` fails before any SQL runs
(`observationStrategies.distinct_overlap`, `strategies.ts`) — the one tool
with a required second target.

## SQL (PostgreSQL)

```sql
WITH l AS (SELECT DISTINCT "left_column"::text AS v FROM left_table WHERE "left_column" IS NOT NULL),
     r AS (SELECT DISTINCT "right_column"::text AS v FROM right_table WHERE "right_column" IS NOT NULL)
SELECT (SELECT count(*) FROM l) AS left_distinct,
       (SELECT count(*) FROM r) AS right_distinct,
       (SELECT count(*) FROM l JOIN r USING (v)) AS shared
```

Both sides can be columns on different tables. Every value is cast to `text`
before comparing, so a comparison across incompatible types (an int id vs. a
text code) still runs — it will just never overlap.

## Returns

```
{ left, right, leftDistinct, rightDistinct, shared, leftCoveredByRight, rightCoveredByLeft }
```

`leftCoveredByRight` close to 1 means almost every left-side value has a
match on the right — the strongest kind of relationship evidence this system
produces.

## Budget

One observation against `ONTOLOGY_MAX_OBSERVATION_REQUESTS`, same cost as a
single-column tool.
