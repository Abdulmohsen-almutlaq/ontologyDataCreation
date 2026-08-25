# Task: find what this ontology does not yet know

The harness has already found the structural gaps below. Your job is the ones a
static rule cannot see: **semantic** gaps.

# Current ontology

{{CURRENT_ONTOLOGY}}

# Structural gaps already detected

{{GAPS}}

# Evidence on record

{{EVIDENCE}}

# Recent observations

{{OBSERVATIONS}}

# What to look for

- A concept whose **boundaries** are unstated - does Revenue include tax?
  refunds? cancelled orders?
- A relationship the domain implies but the ontology never states.
- An entity modelled as one thing that is really two.
- A **process** visible only as a status column.
- A business notion this domain always has that is missing here.
- Two nodes that quietly contradict each other.

Report only gaps that would change how someone uses the data. Do not restate the
structural gaps above, and do not invent gaps to appear thorough - an empty list
is a valid and useful answer.

# Output

```
{
  "gaps": [
    {"type": "AMBIGUOUS_CONCEPT", "target": "revenue", "severity": "high",
     "reason": "<what is unclear and what it would change>"}
  ]
}
```

Valid types: `UNKNOWN_RELATIONSHIP`, `AMBIGUOUS_CONCEPT`, `MISSING_EVIDENCE`,
`LOW_CONFIDENCE`, `MISSING_BUSINESS_SEMANTICS`, `CONTRADICTION`,
`UNEXPLORED_BRANCH`, `POTENTIAL_DEEPER_CONCEPT`.
