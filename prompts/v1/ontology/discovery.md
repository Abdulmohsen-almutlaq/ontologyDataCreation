# Task: discover the semantic entities of this data source

You are seeing a data source for the first time. Identify the **real-world
things** this data is about.

{{EXPECTED_SCHEMA}}

# Observations

{{OBSERVATIONS}}

# What to look for

- Several tables may describe **one** entity (`customers`, `customer_addresses`,
  `customer_preferences` are usually one `Customer`).
- Some tables describe **no** entity: join tables, audit logs, staging copies and
  migration bookkeeping are mechanism, not meaning.
- A table may hide **two** entities (an `orders` table carrying both the order
  and its payment).
- Name entities in **domain language**, singular, as a business person would say
  them: `Customer`, not `customers_tbl`.

# What to produce

`ADD_ENTITY` operations for the entities you can justify, each with the
attributes you can already support from the observations. Set `source` to the
physical objects the entity came from.

Where the schema alone cannot settle whether something is an entity, emit
`REQUEST_OBSERVATION` instead of guessing.

Stay at the entity and attribute level. Relationships and business concepts come
later, from other passes.

# Available operations

{{AVAILABLE_ACTIONS}}

# Observation types you may request

{{OBSERVATION_TYPES}}

# Output

A single JSON object with `reasoning`, `confidence` and `operations`.
