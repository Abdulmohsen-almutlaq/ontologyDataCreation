/**
 * Semantic tiers.
 *
 * "Depth" is used in three distinct senses across this system; they are
 * deliberately kept apart:
 *
 *   1. iteration       - how many loop turns have run (ExplorationState.iteration)
 *   2. SemanticTier    - how much *meaning* is modelled (this file)
 *   3. node/branch     - the highest tier reached for a given node
 *
 * Only (2) and (3) are called "depth" in the ontology; (1) is always "iteration".
 *
 * Node depths are DERIVED by the engine from the ontology contents after every
 * apply(). They are never read from an LLM response, otherwise an
 * "asymmetric depth" claim would only assert what the model said about itself.
 */
export enum SemanticTier {
  DATASET = 0,
  ENTITY = 1,
  ATTRIBUTE = 2,
  RELATIONSHIP = 3,
  CONCEPT = 4,
  METRIC = 5,
  EVENT = 6,
  RULE = 7,
}

export const TIER_NAMES: Record<number, string> = {
  0: 'DATASET',
  1: 'ENTITY',
  2: 'ATTRIBUTE',
  3: 'RELATIONSHIP',
  4: 'CONCEPT',
  5: 'METRIC',
  6: 'EVENT',
  7: 'RULE',
};

export const MAX_KNOWN_TIER: number = SemanticTier.RULE;

export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? 'DOMAIN_SPECIFIC_' + String(tier);
}
