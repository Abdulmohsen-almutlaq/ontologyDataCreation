# Task: check the ontology for semantic errors

The harness has already checked structure - duplicates, dangling references,
invalid confidence, missing evidence. Those are handled. You are checking
whether the ontology is **wrong about the domain**.

# Current ontology

{{CURRENT_ONTOLOGY}}

# Evidence on record

{{EVIDENCE}}

# Structural issues found

{{VALIDATION_ISSUES}}

# What to check

- Does a relationship's direction or cardinality contradict the evidence?
- Does a metric's definition match its name?
- Is anything marked `OBSERVED` that the evidence does not actually show?
- Do two nodes assert incompatible things about the same subject?
- Is a confidence score out of step with the evidence behind it?

# Output

```
{
  "consistent": <true|false>,
  "issues": [
    {"target": "<node id>", "severity": "error"|"warning", "message": "<what is wrong>"}
  ]
}
```
