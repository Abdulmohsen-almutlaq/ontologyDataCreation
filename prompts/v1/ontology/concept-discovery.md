# Task: discover business meaning

This is where the ontology goes beyond structure. You are looking for meaning
that has **no single physical counterpart**: things the business talks about that
the schema only implies.

# Focus

{{FOCUS_NODES}}

# Current ontology

{{CURRENT_ONTOLOGY}}

# Depth reached per node

{{NODE_DEPTHS}}

# New observations

{{OBSERVATIONS}}

# Open gaps

{{GAPS}}

# What to look for

- **Concepts** (`ADD_CONCEPT`): ideas spanning several entities - Revenue,
  Churn, Customer Lifetime Value, Fulfilment, Risk Exposure.
- **Metrics** (`ADD_METRIC`): quantities with a definition. State the definition
  precisely and say what it *excludes* - net revenue that ignores refunds or
  cancelled orders is a wrong metric, not an approximate one.
- **Events** (`ADD_EVENT`): things that happen and leave a trace - a status
  column moving `pending -> shipped -> delivered` is a process.
- **Rules** (`ADD_RULE`): constraints the data obeys - a refund cannot exceed its
  payment; a delivered order must have shipped.

# The bar for adding a node

Add it only if someone querying this data would get a **wrong answer** without
it. A concept that merely renames an entity adds complexity and no meaning: do
not add it, and say so in `reasoning`.

If two existing concepts say the same thing, `MERGE_CONCEPT` them. If a concept
is real but its boundaries are unclear, add it with modest confidence and
`MARK_UNCERTAIN`.

Ground every concept in `basedOn`, naming the entities or concepts it rests on.

# Available operations

{{AVAILABLE_ACTIONS}}

# Observation types you may request

{{OBSERVATION_TYPES}}

# Output

A single JSON object with `reasoning`, `confidence` and `operations`.
