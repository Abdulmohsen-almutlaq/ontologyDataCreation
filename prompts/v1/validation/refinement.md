# Task: improve what already exists

Do not add breadth. Sharpen, correct and consolidate the nodes in focus.

# Focus

{{FOCUS_NODES}}

# Current ontology

{{CURRENT_ONTOLOGY}}

# Issues to address

{{VALIDATION_ISSUES}}

# Open gaps

{{UNRESOLVED_GAPS}}

# Evidence on record

{{EVIDENCE}}

# Recent observations

{{OBSERVATIONS}}

# What to do

- Replace a vague description with one that says what the node **is** and what it
  **excludes**.
- Correct a wrong status or an overstated confidence. Downgrading a claim the
  evidence does not support is real progress, not a step backwards.
- `MERGE_CONCEPT` duplicates.
- `MARK_UNCERTAIN` anything genuinely unresolved.
- `REQUEST_OBSERVATION` where evidence would settle a disagreement.

Prefer `UPDATE_*` operations. Adding new nodes here usually means the wrong
decision was made upstream.

# Available operations

{{AVAILABLE_ACTIONS}}

# Output

A single JSON object with `reasoning`, `confidence` and `operations`.
