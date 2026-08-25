import { ConceptAgent } from '../agents/ConceptAgent';
import { CompletionAgent } from '../agents/CompletionAgent';
import { DepthController } from '../agents/DepthController';
import { DiscoveryAgent } from '../agents/DiscoveryAgent';
import { GapAnalyzer } from '../agents/GapAnalyzer';
import { ObservationPlanner } from '../agents/ObservationPlanner';
import { OntologyAgent } from '../agents/OntologyAgent';
import { RefinementAgent } from '../agents/RefinementAgent';
import { RelationshipAgent } from '../agents/RelationshipAgent';
import { ValidationAgent } from '../agents/ValidationAgent';
import type { AgentDeps } from '../agents/BaseAgent';
import type { Config } from '../config/Config';
import type { Logger } from '../config/logger';
import { Budget } from '../core/Budget';
import { defaultRegistry, type LLMRegistry } from '../llm/LLMRegistry';
import { StructuredGenerator } from '../llm/StructuredGenerator';
import type { LLMClient } from '../llm/LLMClient';
import { OntologyEngine } from '../ontology/OntologyEngine';
import { OntologyValidator } from '../ontology/OntologyValidator';
import { PromptLoader } from '../prompts/PromptLoader';
import { Trace } from '../trace/Trace';

/** Agents that propose ontology changes during an exploration step. */
export interface ReasoningAgents {
  ontology: OntologyAgent;
  relationship: RelationshipAgent;
  concept: ConceptAgent;
  refinement: RefinementAgent;
  planner: ObservationPlanner;
}

/** Everything the harness needs, already wired. */
export interface HarnessComponents {
  budget: Budget;
  trace: Trace;
  prompts: PromptLoader;
  client: LLMClient;
  llm: StructuredGenerator;
  agentDeps: AgentDeps;
  engine: OntologyEngine;

  discovery: DiscoveryAgent;
  depthController: DepthController;
  gapAnalyzer: GapAnalyzer;
  validationAgent: ValidationAgent;
  completionAgent: CompletionAgent;
  reasoning: ReasoningAgents;
}

export interface CompositionOptions {
  config: Config;
  logger: Logger;
  runId: string;
  registry?: LLMRegistry;
}

/**
 * Composition root.
 *
 * Object graph construction is separated from the control loop it feeds. The
 * harness is then about *when* to call things, not about how any of them are
 * built, and a caller can substitute the whole set — a different rule set, a
 * different provider registry, instrumented agents — without reaching inside
 * `OntologyHarness`.
 *
 * Deliberately hand-wired: the dependency graph is a dozen objects with one
 * shared `AgentDeps`, and a container would add a dependency and a layer of
 * indirection to solve a problem this project does not have.
 */
export function composeHarness(options: CompositionOptions): HarnessComponents {
  const { config, logger, runId } = options;

  const budget = new Budget(config.ontology);
  const trace = new Trace(runId, config.output.traceEnabled);

  const registry = options.registry ?? defaultRegistry();
  const client = registry.createClient(config.llm);
  logger.info(
    { provider: client.name, model: client.model, capabilities: client.capabilities },
    'LLM client ready'
  );

  const prompts = new PromptLoader({
    dir: config.prompts.dir,
    version: config.prompts.version,
    // Cache in production; re-read in development so a prompt edit takes
    // effect without a restart.
    cache: config.nodeEnv === 'production',
  });

  const llm = new StructuredGenerator({
    client,
    budget,
    promptLoader: prompts,
    maxCorrectionRetries: config.llm.maxCorrectionRetries,
    onCall: (event) => {
      if (!event.ok) {
        logger.warn(
          { label: event.label, attempt: event.attempt, error: event.error },
          'LLM produced invalid structured output; correcting'
        );
      }
    },
  });

  const agentDeps: AgentDeps = {
    llm,
    prompts,
    trace,
    onMissingVariables: (prompt, missing) =>
      logger.warn(
        { prompt, missing },
        'Prompt references variables the harness does not supply'
      ),
    // Every call site is structural except CompletionAgent's prose summary -
    // see the "completion" label. Unset by default: no behaviour change
    // unless LLM_COMPLETION_TEMPERATURE is explicitly set.
    temperatureFor: (label) =>
      label === 'completion' ? config.llm.completionTemperature : undefined,
  };

  return {
    budget,
    trace,
    prompts,
    client,
    llm,
    agentDeps,
    engine: new OntologyEngine(new OntologyValidator()),

    discovery: new DiscoveryAgent(agentDeps),
    depthController: new DepthController(agentDeps),
    gapAnalyzer: new GapAnalyzer(agentDeps),
    validationAgent: new ValidationAgent(agentDeps),
    completionAgent: new CompletionAgent(agentDeps),
    reasoning: {
      ontology: new OntologyAgent(agentDeps),
      relationship: new RelationshipAgent(agentDeps),
      concept: new ConceptAgent(agentDeps),
      refinement: new RefinementAgent(agentDeps),
      planner: new ObservationPlanner(agentDeps),
    },
  };
}
