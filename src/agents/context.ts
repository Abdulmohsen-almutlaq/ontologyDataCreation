import { tierName } from '../core/tiers';
import type { Gap, Observation } from '../core/types';
import {
  formatGaps,
  formatHistory,
  type ExplorationState,
} from '../exploration/ExplorationState';
import { formatDepths } from '../ontology/depth';
import { summarizeOntology } from '../ontology/Ontology';
import { formatIssues } from '../ontology/OntologyValidator';
import { formatObservations } from '../observation/Observation';

export interface ContextOptions {
  /** node ids the current step is focused on */
  focus?: string[];
  /** observations to include verbatim; defaults to the most recent ones */
  observations?: Observation[];
  gaps?: Gap[];
  limits?: { maxDepth: number; maxNodes: number; maxIterations: number };
}

const TIER_LADDER = [0, 1, 2, 3, 4, 5, 6, 7]
  .map((t) => `  ${t} = ${tierName(t)}`)
  .join('\n');

/**
 * Builds the {{VARIABLE}} bindings shared by every prompt.
 *
 * The model is given a compact projection of state, not raw dumps: a whole
 * schema or a full ontology JSON crowds out reasoning and invites the model to
 * restate the input instead of interpreting it.
 */
export function buildContext(
  state: ExplorationState,
  options: ContextOptions = {}
): Record<string, string | number> {
  const observations = options.observations ?? state.observations;
  const gaps = options.gaps ?? state.unresolvedGaps;

  return {
    RUN_ID: state.runId,
    ITERATION: state.iteration,
    STATUS: state.status,
    DATASET_NAME: state.ontology.datasetName,

    CURRENT_ONTOLOGY: summarizeOntology(state.ontology),
    CURRENT_DEPTH: state.depth.globalDepth,
    CURRENT_DEPTH_NAME: tierName(state.depth.globalDepth),
    NODE_DEPTHS: formatDepths(state.depth),
    DEPTH_LADDER: TIER_LADDER,

    OBSERVATIONS: formatObservations(observations),
    EVIDENCE: formatEvidence(state),
    GAPS: formatGaps(gaps),
    UNRESOLVED_GAPS: formatGaps(gaps),
    EXPLORATION_HISTORY: formatHistory(state.explorationHistory),
    VALIDATION_ISSUES: state.lastValidation
      ? formatIssues(state.lastValidation.issues)
      : '  (not validated yet)',

    FOCUS_NODES: (options.focus ?? []).join(', ') || '(whole ontology)',
    EXPLORED_NODES: [...state.exploredNodes].join(', ') || '(none)',
    UNEXPLORED_NODES: [...state.unexploredNodes].join(', ') || '(none)',

    CURRENT_COMPLEXITY: describeComplexity(state),
    BUDGET: describeBudget(state, options.limits),
    AVAILABLE_ACTIONS: AVAILABLE_ACTIONS,
    OBSERVATION_TYPES: OBSERVATION_TYPES,
  };
}

function formatEvidence(state: ExplorationState): string {
  const items: string[] = [];
  const collect = (label: string, list: Array<{ id: string; evidence: Array<{ locator: string; summary: string; status: string }> }>) => {
    for (const item of list) {
      for (const e of item.evidence) {
        items.push(`  ${label}:${item.id} <- ${e.locator} [${e.status}] ${e.summary}`);
      }
    }
  };
  collect('entity', state.ontology.entities);
  collect('relationship', state.ontology.relationships);
  collect('concept', state.ontology.concepts);
  collect('metric', state.ontology.metrics);
  return items.length ? items.join('\n') : '  (no evidence recorded yet)';
}

function describeComplexity(state: ExplorationState): string {
  const o = state.ontology;
  const attributes = o.entities.reduce((n, e) => n + e.attributes.length, 0);
  return [
    `  entities=${o.entities.length}`,
    `attributes=${attributes}`,
    `relationships=${o.relationships.length}`,
    `concepts=${o.concepts.length}`,
    `metrics=${o.metrics.length}`,
    `events=${o.events.length}`,
    `rules=${o.rules.length}`,
    `uncertain=${o.uncertain.length}`,
  ].join(' ');
}

function describeBudget(
  state: ExplorationState,
  limits?: { maxDepth: number; maxNodes: number; maxIterations: number }
): string {
  const parts = [
    `iteration ${state.iteration}${limits ? `/${limits.maxIterations}` : ''}`,
    `llmCalls=${state.llmCalls}`,
    `observations=${state.observationRequests}`,
  ];
  if (limits) parts.push(`maxDepth=${limits.maxDepth}`, `maxNodes=${limits.maxNodes}`);
  return '  ' + parts.join(' ');
}

const AVAILABLE_ACTIONS = [
  'ADD_ENTITY',
  'UPDATE_ENTITY',
  'ADD_ATTRIBUTE',
  'UPDATE_ATTRIBUTE',
  'ADD_RELATIONSHIP',
  'UPDATE_RELATIONSHIP',
  'ADD_CONCEPT',
  'ADD_METRIC',
  'ADD_EVENT',
  'ADD_RULE',
  'MERGE_CONCEPT',
  'MARK_UNCERTAIN',
  'REQUEST_OBSERVATION',
]
  .map((a) => `  - ${a}`)
  .join('\n');

const OBSERVATION_TYPES = [
  'schema_overview      - whole-source map of tables, columns, keys',
  'table_metadata       - columns, types, indexes, constraints, row count for one table',
  'column_statistics    - null rate, distinct count, min/max for one column',
  'distinct_values      - up to N distinct values of one column',
  'value_distribution   - most frequent values and their share',
  'sample_rows          - up to N sample rows of one table',
  'distinct_overlap     - value overlap between two columns (requires compareTo)',
  'relationship_evidence- declared foreign keys plus naming-convention candidates',
  'temporal_distribution- monthly buckets for a timestamp column',
]
  .map((a) => `  - ${a}`)
  .join('\n');
