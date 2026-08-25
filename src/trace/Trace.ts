import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { HarnessStatus } from '../core/types';

export interface TraceEntry {
  runId: string;
  seq: number;
  iteration: number;
  state: HarnessStatus;
  agent: string;

  promptName?: string;
  promptVersion?: string;
  promptHash?: string;
  provider?: string;
  model?: string;
  /** hash of the rendered prompt, so a run can be matched without storing it */
  inputContextHash?: string;

  decision?: unknown;
  ontologyOperations?: unknown;
  observationsRequested?: unknown;
  observationsReturned?: unknown;
  validation?: unknown;
  depthDecision?: unknown;
  error?: string;

  timestamp: string;
  durationMs: number;
}

export function hashContext(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Append-only execution trace.
 *
 * Every LLM call, operation batch, observation and depth decision is recorded
 * with the prompt name/version/hash and the provider/model that produced it, so
 * a run can be explained after the fact and a regression can be attributed to a
 * prompt edit rather than guessed at.
 */
export class Trace {
  private readonly entries: TraceEntry[] = [];
  private seq = 0;

  constructor(
    readonly runId: string,
    private readonly enabled = true
  ) {}

  record(entry: Omit<TraceEntry, 'runId' | 'seq' | 'timestamp'>): TraceEntry {
    const full: TraceEntry = {
      ...entry,
      runId: this.runId,
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
    };
    if (this.enabled) this.entries.push(full);
    return full;
  }

  all(): readonly TraceEntry[] {
    return this.entries;
  }

  byAgent(agent: string): TraceEntry[] {
    return this.entries.filter((e) => e.agent === agent);
  }

  async writeTo(dir: string): Promise<string | null> {
    if (!this.enabled) return null;
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `trace-${this.runId}.jsonl`);
    await fs.writeFile(
      file,
      this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf-8'
    );
    return file;
  }
}
