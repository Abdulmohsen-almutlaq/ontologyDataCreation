import completionSchema from './completion.schema.json';
import decisionsSchema from './decisions.schema.json';
import gapsSchema from './gaps.schema.json';
import observationPlanSchema from './observation-plan.schema.json';
import ontologySchema from './ontology.schema.json';
import operationsSchema from './operations.schema.json';
import validationSchema from './validation.schema.json';

/**
 * JSON Schemas handed to providers that can constrain generation natively.
 * They are an optimisation only - the Zod schemas in ./llm.ts are the
 * authority, and every response is validated against them regardless.
 */
export const jsonSchemas = {
  operations: operationsSchema as unknown as Record<string, unknown>,
  depthDecision: decisionsSchema as unknown as Record<string, unknown>,
  gaps: gapsSchema as unknown as Record<string, unknown>,
  observationPlan: observationPlanSchema as unknown as Record<string, unknown>,
  semanticValidation: validationSchema as unknown as Record<string, unknown>,
  completion: completionSchema as unknown as Record<string, unknown>,
  ontology: ontologySchema as unknown as Record<string, unknown>,
} as const;

export * from './llm';
