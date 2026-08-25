# Task: detect relationships between entities

# Focus

{{FOCUS_NODES}}

# Current ontology

{{CURRENT_ONTOLOGY}}

# New observations

{{OBSERVATIONS}}

# Evidence standards

A relationship needs grounding, in descending order of strength:

1. A **declared foreign key** - `status: OBSERVED`, high confidence.
2. **Measured value overlap** between two columns (`distinct_overlap`) -
   `OBSERVED` if coverage is high, `INFERRED` if partial.
3. **Naming convention alone** (`orders.customer_id`) - `INFERRED` at moderate
   confidence *at best*. If it matters, request `distinct_overlap` first.

Name relationships as **verbs in domain language**: `places`, `contains`,
`settles`, `reverses` - not `has_fk_to`.

Set `cardinality` to one of `1:1`, `1:N`, `N:1`, `N:M` when the evidence supports
it, and leave it out when it does not.

On `ADD_RELATIONSHIP`, `source` and `target` are entity names. Put the physical
objects the relationship came from — the foreign key, the columns — in
`sourceRefs`, not in `source`.

A join table usually becomes an `N:M` relationship rather than an entity - but if
it carries its own attributes (a quantity, a price, a timestamp) it is an entity
in its own right. Say which reading you took and why.

# Available operations

{{AVAILABLE_ACTIONS}}

# Observation types you may request

{{OBSERVATION_TYPES}}

# Output

A single JSON object with `reasoning`, `confidence` and `operations`.
