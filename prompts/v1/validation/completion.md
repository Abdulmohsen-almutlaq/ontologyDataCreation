# Task: assess the finished ontology

Exploration has stopped. Give an honest account of what was produced.

# Final ontology

{{CURRENT_ONTOLOGY}}

# Depth reached

Global depth {{CURRENT_DEPTH}} ({{CURRENT_DEPTH_NAME}})

{{NODE_DEPTHS}}

# Remaining gaps

{{UNRESOLVED_GAPS}}

# Exploration history

{{EXPLORATION_HISTORY}}

# What to write

`summary`: two or three sentences on what this data source is about and what the
ontology now says about it. Domain language, no meta-commentary about the
process.

`remainingRisks`: specific things a consumer of this ontology could get wrong - a
metric whose refund treatment was never confirmed, a relationship inferred from
naming alone, a branch left at depth 2. Be concrete about the consequence.

`sufficient`: whether someone could use this data correctly with what is here.

Being candid about limits is the useful answer. An ontology honestly marked
incomplete is more valuable than one that overstates its coverage.

# Output

```
{
  "sufficient": <true|false>,
  "confidence": <0..1>,
  "summary": "<what this data is about>",
  "remainingRisks": ["<specific risk and its consequence>"]
}
```
