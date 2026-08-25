# Task: resolve entities and their attributes

Sharpen the entities currently in focus: their identity, their attributes, and
what each attribute *means*.

# Focus

{{FOCUS_NODES}}

# Current ontology

{{CURRENT_ONTOLOGY}}

# New observations

{{OBSERVATIONS}}

# What to decide

- Which attribute is the **identifier**? Set `semanticRole` (for example
  `identifier`, `natural_key`, `foreign_key`, `status`, `amount`, `timestamp`,
  `category`, `free_text`).
- What does each attribute mean in business terms, and what is its `unit`
  (currency, seconds, count)?
- Are two entities actually the same thing under different physical names? Say
  so in `reasoning`; do not silently drop one.
- Is an attribute's meaning ambiguous? `MARK_UNCERTAIN` it, or request the
  observation that would settle it.

Work only on the focused nodes. Leave the rest of the ontology alone.

# Available operations

{{AVAILABLE_ACTIONS}}

# Observation types you may request

{{OBSERVATION_TYPES}}

# Output

A single JSON object with `reasoning`, `confidence` and `operations`.
