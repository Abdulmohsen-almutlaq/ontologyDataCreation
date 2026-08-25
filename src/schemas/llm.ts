import { z } from 'zod';

/**
 * Schemas for everything an LLM is allowed to say.
 *
 * Raw model output is NEVER trusted: whether or not the provider supports
 * schema-constrained generation, the payload is parsed through these schemas
 * before it reaches the ontology engine.
 */

export const AssertionStatusSchema = z.enum([
  'OBSERVED',
  'INFERRED',
  'DERIVED',
  'ASSUMED',
  'UNKNOWN',
]);

export const ConfidenceSchema = z.number().min(0).max(1);

export const EvidenceRefSchema = z.object({
  locator: z.string().min(1),
  summary: z.string().default(''),
  status: AssertionStatusSchema.default('OBSERVED'),
  observationId: z.string().optional(),
});

export const SourceRefSchema = z.object({
  locator: z.string().min(1),
  kind: z
    .enum(['table', 'column', 'constraint', 'index', 'dataset', 'other'])
    .default('other'),
});

const assertableFields = {
  status: AssertionStatusSchema.default('INFERRED'),
  confidence: ConfidenceSchema.default(0.5),
  evidence: z.array(EvidenceRefSchema).default([]),
  source: z.array(SourceRefSchema).default([]),
};

export const ObservationTypeSchema = z.enum([
  'schema_overview',
  'table_metadata',
  'column_statistics',
  'distinct_values',
  'value_distribution',
  'sample_rows',
  'distinct_overlap',
  'relationship_evidence',
  'temporal_distribution',
]);

export const EvidenceRequestSchema = z.object({
  target: z.string().min(1),
  observationType: ObservationTypeSchema,
  reason: z.string().min(1),
  compareTo: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

/* --------------------------------------------------------- operations */

export const AttributeSpecSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1).default('unknown'),
  description: z.string().optional(),
  semanticRole: z.string().optional(),
  nullable: z.boolean().optional(),
  unit: z.string().optional(),
  ...assertableFields,
});

export const OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ADD_ENTITY'),
    name: z.string().min(1),
    description: z.string().default(''),
    attributes: z.array(AttributeSpecSchema).default([]),
    ...assertableFields,
  }),
  z.object({
    type: z.literal('UPDATE_ENTITY'),
    name: z.string().min(1),
    description: z.string().optional(),
    status: AssertionStatusSchema.optional(),
    confidence: ConfidenceSchema.optional(),
    evidence: z.array(EvidenceRefSchema).default([]),
    source: z.array(SourceRefSchema).default([]),
  }),
  z.object({
    type: z.literal('ADD_ATTRIBUTE'),
    entity: z.string().min(1),
    attribute: AttributeSpecSchema,
  }),
  z.object({
    type: z.literal('UPDATE_ATTRIBUTE'),
    entity: z.string().min(1),
    attribute: z.string().min(1),
    changes: AttributeSpecSchema.partial().omit({ name: true }),
  }),
  // NOTE: `source` here is the source ENTITY, not a SourceReference list, so
  // the assertable fields are spelled out rather than spread.
  z.object({
    type: z.literal('ADD_RELATIONSHIP'),
    source: z.string().min(1),
    relationship: z.string().min(1),
    target: z.string().min(1),
    cardinality: z.string().optional(),
    description: z.string().optional(),
    status: AssertionStatusSchema.default('INFERRED'),
    confidence: ConfidenceSchema.default(0.5),
    evidence: z.array(EvidenceRefSchema).default([]),
    sourceRefs: z.array(SourceRefSchema).default([]),
  }),
  z.object({
    type: z.literal('UPDATE_RELATIONSHIP'),
    source: z.string().min(1),
    relationship: z.string().min(1),
    target: z.string().min(1),
    cardinality: z.string().optional(),
    description: z.string().optional(),
    status: AssertionStatusSchema.optional(),
    confidence: ConfidenceSchema.optional(),
    evidence: z.array(EvidenceRefSchema).default([]),
    sourceRefs: z.array(SourceRefSchema).default([]),
  }),
  z.object({
    type: z.literal('ADD_CONCEPT'),
    name: z.string().min(1),
    description: z.string().default(''),
    basedOn: z.array(z.string()).default([]),
    ...assertableFields,
  }),
  z.object({
    type: z.literal('ADD_METRIC'),
    name: z.string().min(1),
    description: z.string().default(''),
    definition: z.string().default(''),
    unit: z.string().optional(),
    basedOn: z.array(z.string()).default([]),
    ...assertableFields,
  }),
  z.object({
    type: z.literal('ADD_EVENT'),
    name: z.string().min(1),
    description: z.string().default(''),
    basedOn: z.array(z.string()).default([]),
    ...assertableFields,
  }),
  z.object({
    type: z.literal('ADD_RULE'),
    name: z.string().min(1),
    description: z.string().default(''),
    expression: z.string().optional(),
    basedOn: z.array(z.string()).default([]),
    ...assertableFields,
  }),
  z.object({
    type: z.literal('MERGE_CONCEPT'),
    from: z.string().min(1),
    into: z.string().min(1),
    reason: z.string().default(''),
  }),
  z.object({
    type: z.literal('MARK_UNCERTAIN'),
    target: z.string().min(1),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal('REQUEST_OBSERVATION'),
    target: z.string().min(1),
    observationType: ObservationTypeSchema,
    reason: z.string().min(1),
    compareTo: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
]);

export type OperationInput = z.infer<typeof OperationSchema>;

export const OperationsResponseSchema = z.object({
  reasoning: z.string().default(''),
  confidence: ConfidenceSchema.default(0.5),
  operations: z.array(OperationSchema).default([]),
});

export type OperationsResponse = z.infer<typeof OperationsResponseSchema>;

/* ------------------------------------------------------ depth decision */

export const DepthDecisionSchema = z.object({
  decision: z.enum(['STOP', 'GO_DEEPER', 'REFINE_CURRENT', 'REQUEST_EVIDENCE']),
  targetDepth: z.number().int().min(0).max(32).optional(),
  targetNodes: z.array(z.string()).default([]),
  reason: z.string().min(1),
  expectedValue: ConfidenceSchema.default(0),
  expectedInformationGain: ConfidenceSchema.default(0),
  uncertainty: ConfidenceSchema.default(0),
  complexityCost: ConfidenceSchema.default(0),
  nextFocus: z.array(z.string()).default([]),
  requiredEvidence: z.array(EvidenceRequestSchema).default([]),
});

export type DepthDecisionResponse = z.infer<typeof DepthDecisionSchema>;

/* --------------------------------------------------------- gap output */

export const GapSchema = z.object({
  type: z.enum([
    'UNKNOWN_RELATIONSHIP',
    'AMBIGUOUS_CONCEPT',
    'MISSING_EVIDENCE',
    'LOW_CONFIDENCE',
    'MISSING_BUSINESS_SEMANTICS',
    'CONTRADICTION',
    'UNEXPLORED_BRANCH',
    'POTENTIAL_DEEPER_CONCEPT',
  ]),
  target: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  reason: z.string().min(1),
});

export const GapsResponseSchema = z.object({
  gaps: z.array(GapSchema).default([]),
});

/* ------------------------------------------- observation plan output */

export const ObservationPlanSchema = z.object({
  reasoning: z.string().default(''),
  requests: z.array(EvidenceRequestSchema).default([]),
});

/* ------------------------------------------------- validation output */

export const SemanticValidationSchema = z.object({
  consistent: z.boolean(),
  issues: z
    .array(
      z.object({
        target: z.string().min(1),
        severity: z.enum(['error', 'warning']).default('warning'),
        message: z.string().min(1),
      })
    )
    .default([]),
});

/* ------------------------------------------------- completion output */

export const CompletionSchema = z.object({
  sufficient: z.boolean(),
  confidence: ConfidenceSchema.default(0.5),
  summary: z.string().default(''),
  remainingRisks: z.array(z.string()).default([]),
});
