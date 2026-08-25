# Task: plan the minimum observations needed

Decide what to look at next. You cannot run SQL: you choose from a fixed set of
observations and the harness executes them.

# Focus

{{FOCUS_NODES}}

# Current ontology

{{CURRENT_ONTOLOGY}}

# What is already known

{{EVIDENCE}}

# Observations already made

{{OBSERVATIONS}}

# Open gaps

{{UNRESOLVED_GAPS}}

# Available observation types

{{OBSERVATION_TYPES}}

# Targets

- Table-scoped types take `orders` or `public.orders`.
- Column-scoped types take `orders.status` or `public.orders.status`.
- `distinct_overlap` additionally needs `compareTo`, the other column.

# How to plan well

Each request must be tied to a specific question. Ask yourself: *what would I
conclude if this came back one way, and what if it came back the other?* If both
answers lead to the same ontology, do not make the request.

Useful patterns:

- Suspected relationship -> `distinct_overlap` on the two columns.
- Column that might encode a process -> `value_distribution` on it.
- Ambiguous business meaning -> `sample_rows` on the table.
- Unsure whether a column is an identifier -> `column_statistics`.

Do not re-request an observation already listed above. Request at most six.

# Output

```
{
  "reasoning": "<what you are trying to settle>",
  "requests": [
    {"target": "orders.customer_id", "observationType": "distinct_overlap",
     "compareTo": "customers.id", "reason": "<what this would settle>"}
  ]
}
```
