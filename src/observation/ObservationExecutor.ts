import * as crypto from 'node:crypto';
import type { Budget } from '../core/Budget';
import type { EvidenceRequest, Observation } from '../core/types';
import {
  COLUMN_TARGETED,
  parseColumn,
  parseTable,
  TABLE_TARGETED,
  type DatabaseObserver,
  type ObservationRunner,
} from './Observation';
import { strategyFor } from './strategies';

export interface ObservationExecutorOptions {
  observer: DatabaseObserver;
  budget: Budget;
  defaultSchema: string;
  defaultLimit?: number;
  /** skip re-running an identical request within one run */
  dedupe?: boolean;
}

/**
 * Executes model-requested observations.
 *
 * The request arrives as a typed structure, not as SQL. This class resolves it
 * to one of the fixed observer methods, validates and parses the target,
 * charges the observation budget, and returns the result as an Observation
 * record. A failed observation is returned as a failure, not thrown: an agent
 * asking about a column that does not exist is information, and the loop must
 * survive it.
 */
export class ObservationExecutor implements ObservationRunner {
  private readonly seen = new Map<string, Observation>();

  constructor(private readonly options: ObservationExecutorOptions) {}

  private key(request: EvidenceRequest): string {
    return [
      request.observationType,
      request.target,
      request.compareTo ?? '',
      request.limit ?? '',
    ].join('|');
  }

  /** Previously executed request signatures; used by the stall detector. */
  get executedKeys(): string[] {
    return [...this.seen.keys()];
  }

  async run(request: EvidenceRequest, iteration: number): Promise<Observation> {
    const key = this.key(request);
    if ((this.options.dedupe ?? true) && this.seen.has(key)) {
      return { ...this.seen.get(key)!, id: this.seen.get(key)!.id };
    }

    this.options.budget.assertObservationBudget();
    this.options.budget.countObservationRequest();

    const id = `obs_${crypto.randomBytes(4).toString('hex')}`;
    const schema = this.options.defaultSchema;
    const limit = Math.min(request.limit ?? this.options.defaultLimit ?? 20, 100);

    const base = {
      id,
      requestId: request.id,
      observationType: request.observationType,
      target: request.target,
      iteration,
    };

    try {
      const data = await strategyFor(request.observationType)(
        this.options.observer,
        request,
        { schema, limit }
      );

      const observation: Observation = { ...base, ok: true, data };
      this.seen.set(key, observation);
      return observation;
    } catch (err) {
      // Observation failures are evidence too; they must not abort the loop.
      const observation: Observation = {
        ...base,
        ok: false,
        error: (err as Error).message,
        data: null,
      };
      this.seen.set(key, observation);
      return observation;
    }
  }

  /** Convenience wrapper used to seed the run. */
  async schemaOverview(iteration: number): Promise<Observation> {
    return this.run(
      {
        id: 'seed',
        target: this.options.defaultSchema,
        observationType: 'schema_overview',
        reason: 'Initial map of the data source',
      },
      iteration
    );
  }
}

/** Sanity-check a request before it is queued, so bad plans fail loudly. */
export function validateEvidenceRequest(
  request: EvidenceRequest,
  defaultSchema: string
): string | null {
  try {
    if (COLUMN_TARGETED.has(request.observationType)) {
      parseColumn(request.target, defaultSchema);
      if (request.observationType === 'distinct_overlap') {
        if (!request.compareTo) return 'distinct_overlap requires compareTo';
        parseColumn(request.compareTo, defaultSchema);
      }
    } else if (TABLE_TARGETED.has(request.observationType)) {
      parseTable(request.target, defaultSchema);
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
