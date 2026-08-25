import { renderFatal, renderReport } from './cli/report';
import { loadConfig } from './config/Config';
import { createLogger } from './config/logger';
import { FileOntologyStore } from './ontology/OntologyStore';
import { OntologyHarness } from './OntologyHarness';

/**
 * CLI entrypoint.
 *
 * Per the MVP scope, the deliverable is the exploration loop over PostgreSQL
 * with a local model; the HTTP layer is deliberately not built yet. PORT is
 * carried in configuration so that adding one later needs no config change.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info(
    {
      provider: config.llm.provider,
      model: config.llm.model,
      source: config.source.kind,
      promptVersion: config.prompts.version,
    },
    'Starting ontology harness'
  );

  const harness = new OntologyHarness({ config, logger });
  const source = OntologyHarness.sourceFromConfig(config);

  const result = await harness.run(source);
  const file = await new FileOntologyStore(config.output.dir).save(result);

  // Structured logs stay on stderr for machines; the human-facing report goes
  // to stdout, so `| jq` on the logs and a readable terminal are not in conflict.
  logger.info(
    {
      status: result.status,
      terminationReason: result.terminationReason,
      iterations: result.iterations,
      llmCalls: result.llmCalls,
      observations: result.observationRequests,
      globalDepth: result.depth.globalDepth,
      output: file,
    },
    'Ontology run finished'
  );

  process.stdout.write(renderReport(result, file));

  if (result.status === 'FAILED') process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    // Configuration and connection failures must be loud and fatal.
    process.stderr.write(renderFatal((err as Error).message));
    process.exit(1);
  });
}

export { OntologyHarness } from './OntologyHarness';
export { loadConfig } from './config/Config';
export * from './core/types';
