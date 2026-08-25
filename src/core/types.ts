import { SemanticTier } from './tiers';

/** Epistemic status of an assertion. Inference must never masquerade as fact. */
export type AssertionStatus =
  | 'OBSERVED'
  | 'INFERRED'
  | 'DERIVED'
  | 'ASSUMED'
  | 'UNKNOWN';

export interface SourceReference {
  /** e.g. "postgres:public.customers" or "postgres:public.orders.customer_id" */
  locator: string;
  kind: 'table' | 'column' | 'constraint' | 'index' | 'dataset' | 'other';
}

export interface Evidence {
  id: string;
  /** id of the observation that produced this evidence, if any */
  observationId?: string;
  /** what the evidence points at, e.g. "orders.customer_id" */
  locator: string;
  summary: string;
  status: AssertionStatus;
  createdAtIteration: number;
}

export interface Assertable {
  status: AssertionStatus;
  confidence: number;
  evidence: Evidence[];
  source: SourceReference[];
}

export interface Attribute extends Assertable {
  id: string;
  entityId: string;
  name: string;
  type: string;
  description?: string;
  semanticRole?: string;
  nullable?: boolean;
  unit?: string;
}

export interface Entity extends Assertable {
  id: string;
  name: string;
  description: string;
  attributes: Attribute[];
}

export interface Relationship extends Assertable {
  id: string;
  sourceEntity: string;
  relationship: string;
  targetEntity: string;
  cardinality?: string;
  description?: string;
}

export interface Concept extends Assertable {
  id: string;
  name: string;
  description: string;
  /** entity / concept ids this concept is grounded in */
  basedOn: string[];
}

export interface Metric extends Assertable {
  id: string;
  name: string;
  description: string;
  /** informal definition, e.g. "sum(orders.total_amount) - sum(refunds.amount)" */
  definition: string;
  unit?: string;
  basedOn: string[];
}

export interface OntologyEvent extends Assertable {
  id: string;
  name: string;
  description: string;
  basedOn: string[];
}

export interface Rule extends Assertable {
  id: string;
  name: string;
  description: string;
  expression?: string;
  basedOn: string[];
}

export interface UncertaintyMark {
  targetId: string;
  reason: string;
  markedAtIteration: number;
}

export interface Ontology {
  id: string;
  datasetName: string;
  datasetDescription: string;
  entities: Entity[];
  relationships: Relationship[];
  concepts: Concept[];
  metrics: Metric[];
  events: OntologyEvent[];
  rules: Rule[];
  uncertain: UncertaintyMark[];
}

/* ---------------------------------------------------------------- depth */

export interface DepthState {
  globalDepth: number;
  /** node id -> highest SemanticTier at which the node is actually modelled */
  nodeDepths: Record<string, number>;
  /** branch root id -> max depth over the branch connected component */
  branchDepths: Record<string, number>;
}

/* ----------------------------------------------------------- operations */

export type OntologyOperationType =
  | 'ADD_ENTITY'
  | 'UPDATE_ENTITY'
  | 'ADD_ATTRIBUTE'
  | 'UPDATE_ATTRIBUTE'
  | 'ADD_RELATIONSHIP'
  | 'UPDATE_RELATIONSHIP'
  | 'ADD_CONCEPT'
  | 'ADD_METRIC'
  | 'ADD_EVENT'
  | 'ADD_RULE'
  | 'MERGE_CONCEPT'
  | 'MARK_UNCERTAIN'
  | 'REQUEST_OBSERVATION';

/* ------------------------------------------------------------- evidence */

export type ObservationType =
  | 'schema_overview'
  | 'table_metadata'
  | 'column_statistics'
  | 'distinct_values'
  | 'value_distribution'
  | 'sample_rows'
  | 'distinct_overlap'
  | 'relationship_evidence'
  | 'temporal_distribution';

export interface EvidenceRequest {
  id: string;
  target: string;
  observationType: ObservationType;
  reason: string;
  /** optional second target; required by distinct_overlap */
  compareTo?: string;
  limit?: number;
}

export interface Observation {
  id: string;
  requestId?: string;
  observationType: ObservationType;
  target: string;
  iteration: number;
  ok: boolean;
  error?: string;
  data: unknown;
}

/* ---------------------------------------------------------------- gaps */

export type GapType =
  | 'UNKNOWN_RELATIONSHIP'
  | 'AMBIGUOUS_CONCEPT'
  | 'MISSING_EVIDENCE'
  | 'LOW_CONFIDENCE'
  | 'MISSING_BUSINESS_SEMANTICS'
  | 'CONTRADICTION'
  | 'UNEXPLORED_BRANCH'
  | 'POTENTIAL_DEEPER_CONCEPT';

export interface Gap {
  id: string;
  type: GapType;
  target: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  /** true when produced by the deterministic analyzer rather than the LLM */
  deterministic: boolean;
}

/* ----------------------------------------------------------- decisions */

export type DepthDecisionKind =
  | 'STOP'
  | 'GO_DEEPER'
  | 'REFINE_CURRENT'
  | 'REQUEST_EVIDENCE';

export interface DepthDecision {
  decision: DepthDecisionKind;
  currentDepth: number;
  targetDepth?: number;
  targetNodes?: string[];
  reason: string;
  expectedValue: number;
  expectedInformationGain: number;
  uncertainty: number;
  complexityCost: number;
  nextFocus?: string[];
  requiredEvidence?: EvidenceRequest[];
}

/* --------------------------------------------------------- exploration */

export type ExplorationAction =
  | 'DISCOVER'
  | 'EXPAND'
  | 'REFINE'
  | 'OBSERVE'
  | 'VALIDATE'
  | 'STOP';

export interface ExplorationStep {
  iteration: number;
  action: ExplorationAction;
  targetNodes: string[];
  previousDepth: number;
  resultingDepth: number;
  reason: string;
  evidenceUsed: string[];
  ontologyChanges: unknown[];
  confidence: number;
}

export type HarnessStatus =
  | 'INITIALIZING'
  | 'OBSERVING'
  | 'DISCOVERING'
  | 'BUILDING'
  | 'VALIDATING'
  | 'ANALYZING_GAPS'
  | 'DECIDING_DEPTH'
  | 'PLANNING_OBSERVATION'
  | 'WAITING_FOR_EVIDENCE'
  | 'REFINING'
  | 'COMPLETED'
  | 'FAILED';

export type TerminationReason =
  | 'AGENT_STOP'
  | 'MAX_ITERATIONS'
  | 'MAX_LLM_CALLS'
  | 'MAX_OBSERVATION_REQUESTS'
  | 'MAX_NODES'
  | 'MAX_DEPTH'
  | 'MAX_RUNTIME'
  | 'STALLED'
  | 'ERROR';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  target: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export { SemanticTier };
