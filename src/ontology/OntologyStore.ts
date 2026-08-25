import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Ontology } from '../core/types';
import type { OntologyResult } from '../OntologyHarness';

export interface OntologyStore {
  save(result: OntologyResult): Promise<string>;
  load(runId: string): Promise<Ontology>;
}

/**
 * File-backed persistence.
 *
 * Postgres is the observed source, not the ontology's home: writing results
 * back into the database being analysed would mean the next run observes its
 * own output. Files keep the two apart, and the trace lands beside the result.
 */
export class FileOntologyStore implements OntologyStore {
  constructor(private readonly dir: string) {}

  async save(result: OntologyResult): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `ontology-${result.runId}.json`);
    const document = {
      runId: result.runId,
      generatedAt: new Date().toISOString(),
      status: result.status,
      terminationReason: result.terminationReason,
      iterations: result.iterations,
      llmCalls: result.llmCalls,
      observationRequests: result.observationRequests,
      elapsedMs: result.elapsedMs,
      depth: result.depth,
      ontology: result.ontology,
      gaps: result.gaps,
      decisions: result.decisions,
      history: result.history,
      validation: result.validation,
      completion: result.completion,
    };
    await fs.writeFile(file, JSON.stringify(document, null, 2), 'utf-8');
    await result.trace.writeTo(this.dir);
    return file;
  }

  async load(runId: string): Promise<Ontology> {
    const file = path.join(this.dir, `ontology-${runId}.json`);
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
    return parsed.ontology as Ontology;
  }
}
