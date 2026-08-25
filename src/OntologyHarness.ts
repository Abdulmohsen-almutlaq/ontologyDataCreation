import * as crypto from 'node:crypto';
import type { CompletionAssessment } from './agents/CompletionAgent';
import type { Config } from './config/Config';
import type { Logger } from './config/logger';
import { BudgetExceededError } from './core/Budget';
import type {
  DepthDecision,
  Ontology,
  TerminationReason,
  ValidationResult,
} from './core/types';
import {
  composeHarness,
  type HarnessComponents,
} from './composition/CompositionRoot';
import { ExplorationController } from './exploration/ExplorationController';
import {
  createState,
  decisionSignature,
  detectStall,
  refreshNodeSets,
  type ExplorationState,
} from './exploration/ExplorationState';
import type { LLMRegistry } from './llm/LLMRegistry';
import { nodeCount } from './ontology/Ontology';
import { FixtureObserver } from './observation/FixtureObserver';
import { ObservationExecutor } from './observation/ObservationExecutor';
import { defaultSourceRegistry } from './observation/SourceRegistry';
import type { DatabaseObserver } from './observation/Observation';
import type { Trace } from './trace/Trace';

export interface DataSource {
  name: string;
  description?: string;
  observer: DatabaseObserver;
  defaultSchema: string;
}

export interface OntologyResult {
  runId: string;
  ontology: Ontology;
  depth: ExplorationState['depth'];
  status: ExplorationState['status'];
  terminationReason: TerminationReason;
  iterations: number;
  llmCalls: number;
  observationRequests: number;
  gaps: ExplorationState['unresolvedGaps'];
  history: ExplorationState['explorationHistory'];
  decisions: DepthDecision[];
  validation?: ValidationResult;
  completion?: CompletionAssessment;
  trace: Trace;
  elapsedMs: number;
}

/**
 * Live checkpoints of a run, for a caller that wants to show progress as it
 * happens rather than wait for the finished OntologyResult. Carries the same
 * facts the structured logger already records - this is a second, additive
 * notification path, not a replacement: logs stay for machines, this is for
 * a human watching a terminal.
 */
export type ProgressEvent =
  | { type: 'observing' }
  | { type: 'discovery'; entities: number; depth: number }
  | {
      type: 'decision';
      iteration: number;
      decision: DepthDecision['decision'];
      targetNodes?: string[];
      reason: string;
      expectedValue: number;
      complexityCost: number;
    }
  | { type: 'stalled' }
  | { type: 'limit'; reason: TerminationReason }
  | { type: 'assessing' }
  | { type: 'error'; message: string };

export interface HarnessOptions {
  config: Config;
  logger: Logger;
  registry?: LLMRegistry;
  /** pre-built object graph; defaults to the standard composition */
  components?: HarnessComponents;
  /** skip the LLM gap pass and the semantic validation pass (saves calls) */
  llmGapAnalysis?: boolean;
  semanticValidation?: boolean;
  completionAssessment?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * The harness owns the control loop and the state machine.
 *
 * Nothing here is a chain of fixed LLM calls: every iteration after the first
 * exists because the depth controller asked for it, targets what the controller
 * pointed at, and stops when the controller says so or when a limit in
 * TypeScript intervenes.
 */
export class OntologyHarness {
  private readonly parts: HarnessComponents;
  private readonly runId: string;

  constructor(private readonly options: HarnessOptions) {
    this.runId = options.components?.trace.runId ?? crypto.randomBytes(6).toString('hex');
    this.parts = options.components ?? composeHarness({
      config: options.config,
      logger: options.logger,
      runId: this.runId,
      registry: options.registry,
    });
  }

  /** Builds the source described by config. */
  /**
   * "postgres" in SOURCE_KIND means "connect via URL" - the scheme in
   * DATABASE_URL picks the driver (src/observation/SourceRegistry.ts), the
   * same registry the interactive shell's `connect` command resolves against.
   * A fixture source stays a directory, never a URL: see connection.ts for
   * why a `fixture://` scheme was rejected.
   */
  static sourceFromConfig(config: Config): DataSource {
    if (config.source.kind === 'fixture') {
      return {
        name: 'fixture',
        observer: FixtureObserver.fromDir(config.source.fixtureDir),
        defaultSchema: config.source.schema,
      };
    }
    const { observer, driver } = defaultSourceRegistry().createObserver(
      config.source.databaseUrl!,
      config.source.schema
    );
    return {
      name: driver.name,
      description: driver.note,
      observer,
      defaultSchema: config.source.schema,
    };
  }

  async run(source: DataSource): Promise<OntologyResult> {
    const { config, logger } = this.options;
    const state = createState(this.runId, source.name);
    const startedAt = Date.now();

    const observations = new ObservationExecutor({
      observer: source.observer,
      budget: this.parts.budget,
      defaultSchema: source.defaultSchema,
    });

    const controller = new ExplorationController({
      agents: this.parts.reasoning,
      engine: this.parts.engine,
      observations,
      trace: this.parts.trace,
      defaultSchema: source.defaultSchema,
    });

    let termination: TerminationReason = 'AGENT_STOP';
    const signatures: string[] = [];

    try {
      /* ------------------------------------------------ OBSERVE (seed) */
      state.status = 'OBSERVING';
      this.options.onProgress?.({ type: 'observing' });
      await source.observer.connect();
      const overview = await observations.schemaOverview(0);
      state.observations.push(overview);
      state.observationRequests = this.parts.budget.observationRequests;
      if (!overview.ok) {
        throw new Error(`Unable to observe the data source: ${overview.error}`);
      }

      /* ---------------------------------------------------- DISCOVER */
      state.status = 'DISCOVERING';
      // Rendered once, here, rather than left as a raw string: discovery.md
      // gets the framing that tells the model to verify it, not the user's
      // text unguarded. Omitted entirely when unset - the prompt falls back
      // to a neutral placeholder (context.ts), not an empty section.
      const expectedSchema = config.source.expectedSchema
        ? (
            await this.parts.prompts.render('ontology/expected-schema', {
              EXPECTED_SCHEMA_TEXT: config.source.expectedSchema,
            })
          ).rendered
        : undefined;
      const discovered = await this.parts.discovery.propose(state, {
        observations: [overview],
        expectedSchema,
      });
      const seeded = this.parts.engine.apply(state.ontology, discovered.operations, {
        iteration: 0,
      });
      state.ontology = seeded.ontology;
      state.depth = seeded.depth;
      state.lastValidation = seeded.validation;
      if (seeded.rolledBack) {
        throw new Error(
          'Discovery was rejected by validation and rolled back: ' +
            seeded.validation.issues
              .filter((i) => i.severity === 'error')
              .map((i) => `${i.code} @ ${i.target}`)
              .join(', ')
        );
      }
      if (state.ontology.entities.length === 0) {
        // An empty ontology is a failed run, not a minimal one.
        throw new Error(
          'Discovery produced no entities; there is nothing to explore. ' +
            `Rejected operations: ${seeded.rejected.map((r) => r.code).join(', ') || 'none'}`
        );
      }
      refreshNodeSets(state);
      this.syncCounters(state);

      logger.info(
        { entities: state.ontology.entities.length, depth: state.depth.globalDepth },
        'Initial discovery complete'
      );
      this.options.onProgress?.({
        type: 'discovery',
        entities: state.ontology.entities.length,
        depth: state.depth.globalDepth,
      });

      /* --------------------------------------------------- MAIN LOOP */
      while (true) {
        // Hard limits are enforced here, in TypeScript, before the model is
        // consulted. The agent can only ever stop early, never run longer.
        const limit = this.parts.budget.exceeded(
          nodeCount(state.ontology),
          state.depth.globalDepth
        );
        if (limit) {
          termination = limit;
          logger.warn({ limit }, 'Exploration stopped by a hard limit');
          this.options.onProgress?.({ type: 'limit', reason: limit });
          break;
        }

        state.iteration += 1;
        this.parts.budget.countIteration();

        /* ---- VALIDATE ---- */
        state.status = 'VALIDATING';
        state.lastValidation = this.parts.validationAgent.validateStructure(state);
        if (this.options.semanticValidation) {
          const semantic = await this.parts.validationAgent.validateSemantics(state);
          state.lastValidation = {
            valid: state.lastValidation.valid,
            issues: [...state.lastValidation.issues, ...semantic],
          };
        }

        /* ---- ANALYZE GAPS ---- */
        state.status = 'ANALYZING_GAPS';
        state.unresolvedGaps = await this.parts.gapAnalyzer.analyze(state, {
          useLLM: this.options.llmGapAnalysis ?? true,
        });
        this.syncCounters(state);

        /* ---- DECIDE DEPTH ---- */
        state.status = 'DECIDING_DEPTH';
        const decision = await this.parts.depthController.decide({
          state,
          limits: config.ontology,
          defaultSchema: source.defaultSchema,
        });
        state.decisions.push(decision);
        this.syncCounters(state);

        logger.info(
          {
            iteration: state.iteration,
            decision: decision.decision,
            targets: decision.targetNodes,
            expectedValue: decision.expectedValue,
            complexityCost: decision.complexityCost,
          },
          decision.reason
        );
        this.options.onProgress?.({
          type: 'decision',
          iteration: state.iteration,
          decision: decision.decision,
          targetNodes: decision.targetNodes,
          reason: decision.reason,
          expectedValue: decision.expectedValue,
          complexityCost: decision.complexityCost,
        });

        if (decision.decision === 'STOP') {
          state.explorationHistory.push({
            iteration: state.iteration,
            action: 'STOP',
            targetNodes: [],
            previousDepth: state.depth.globalDepth,
            resultingDepth: state.depth.globalDepth,
            reason: decision.reason,
            evidenceUsed: [],
            ontologyChanges: [],
            confidence: 1 - decision.uncertainty,
          });
          termination = 'AGENT_STOP';
          break;
        }

        /* ---- EXECUTE ---- */
        state.status =
          decision.decision === 'REQUEST_EVIDENCE'
            ? 'WAITING_FOR_EVIDENCE'
            : decision.decision === 'REFINE_CURRENT'
              ? 'REFINING'
              : 'BUILDING';

        const outcome = await controller.execute(state, decision);
        this.syncCounters(state);

        // Any observations the model requested mid-reasoning are executed now
        // so the next iteration reasons with them in hand.
        if (state.pendingEvidence.length) {
          await controller.runObservations(state, state.pendingEvidence);
          state.pendingEvidence = [];
          this.syncCounters(state);
        }

        /* ---- STALL CHECK ---- */
        const signature = decisionSignature(decision);
        const stall = detectStall({
          operationsApplied: outcome.operationsApplied,
          newObservations: outcome.newObservations,
          signature,
          previousSignatures: signatures,
        });
        signatures.push(signature);
        if (stall) {
          logger.warn({ stall }, 'Exploration stalled');
          this.options.onProgress?.({ type: 'stalled' });
          termination = 'STALLED';
          break;
        }
      }

      state.status = 'COMPLETED';
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        termination = err.reason;
        state.status = 'COMPLETED';
        logger.warn({ reason: err.reason }, err.message);
        this.options.onProgress?.({ type: 'limit', reason: err.reason });
      } else {
        termination = 'ERROR';
        state.status = 'FAILED';
        logger.error({ err: (err as Error).message }, 'Harness run failed');
        this.options.onProgress?.({ type: 'error', message: (err as Error).message });
        this.parts.trace.record({
          iteration: state.iteration,
          state: 'FAILED',
          agent: 'OntologyHarness',
          error: (err as Error).message,
          durationMs: Date.now() - startedAt,
        });
      }
    } finally {
      await source.observer.close().catch(() => undefined);
    }

    /* ------------------------------------------------------ FINALIZE */
    let completion: CompletionAssessment | undefined;
    if (state.status === 'COMPLETED' && (this.options.completionAssessment ?? true)) {
      try {
        this.options.onProgress?.({ type: 'assessing' });
        completion = await this.parts.completionAgent.assess(state);
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          'Completion assessment failed; returning the ontology without it'
        );
      }
    }
    this.syncCounters(state);

    return {
      runId: this.runId,
      ontology: state.ontology,
      depth: state.depth,
      status: state.status,
      terminationReason: termination,
      iterations: state.iteration,
      llmCalls: this.parts.budget.llmCalls,
      observationRequests: this.parts.budget.observationRequests,
      gaps: state.unresolvedGaps,
      history: state.explorationHistory,
      decisions: state.decisions,
      validation: state.lastValidation,
      completion,
      trace: this.parts.trace,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private syncCounters(state: ExplorationState): void {
    state.llmCalls = this.parts.budget.llmCalls;
    state.observationRequests = this.parts.budget.observationRequests;
  }
}
