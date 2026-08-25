import type { EvidenceRequest, ObservationType } from '../core/types';
import {
  ObservationError,
  parseColumn,
  parseTable,
  type DatabaseObserver,
} from './Observation';

/**
 * The observation catalogue: one strategy per question the model is allowed to
 * ask of a data source.
 *
 * Keeping these as a lookup rather than a switch makes the catalogue itself the
 * security boundary — what is not registered here cannot be requested, and the
 * set of legal questions can be read at a glance instead of reconstructed from
 * a method body.
 */

export interface ObservationCallContext {
  /** schema assumed when a target does not name one */
  schema: string;
  /** row/value cap already clamped by the executor */
  limit: number;
}

export type ObservationStrategy = (
  observer: DatabaseObserver,
  request: EvidenceRequest,
  ctx: ObservationCallContext
) => Promise<unknown>;

export const observationStrategies: Record<ObservationType, ObservationStrategy> = {
  schema_overview: (observer) => observer.getSchemaOverview(),

  table_metadata: (observer, request, ctx) =>
    observer.getTableMetadata(parseTable(request.target, ctx.schema)),

  sample_rows: (observer, request, ctx) =>
    observer.getSampleRows(parseTable(request.target, ctx.schema), ctx.limit),

  relationship_evidence: (observer, request, ctx) =>
    observer.getRelationshipEvidence(parseTable(request.target, ctx.schema)),

  column_statistics: (observer, request, ctx) =>
    observer.getColumnStatistics(parseColumn(request.target, ctx.schema)),

  distinct_values: (observer, request, ctx) =>
    observer.getDistinctValues(parseColumn(request.target, ctx.schema), ctx.limit),

  value_distribution: (observer, request, ctx) =>
    observer.getValueDistribution(parseColumn(request.target, ctx.schema), ctx.limit),

  temporal_distribution: (observer, request, ctx) =>
    observer.getTemporalDistribution(parseColumn(request.target, ctx.schema)),

  distinct_overlap: (observer, request, ctx) => {
    if (!request.compareTo) {
      throw new ObservationError('distinct_overlap requires compareTo', 'BAD_REQUEST');
    }
    return observer.getColumnOverlap(
      parseColumn(request.target, ctx.schema),
      parseColumn(request.compareTo, ctx.schema)
    );
  },
};

export function strategyFor(type: ObservationType): ObservationStrategy {
  const strategy = observationStrategies[type];
  if (!strategy) {
    throw new ObservationError(
      `Unsupported observation type "${type}"`,
      'UNSUPPORTED'
    );
  }
  return strategy;
}
