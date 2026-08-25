import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as readline from 'node:readline/promises';
import { loadConfig, type Config } from '../config/Config';
import { createLogger } from '../config/logger';
import { tierName } from '../core/tiers';
import { FileOntologyStore } from '../ontology/OntologyStore';
import { OntologyHarness, type OntologyResult } from '../OntologyHarness';
import {
  renderDecisions,
  renderDepths,
  renderFatal,
  renderReport,
  renderSummary,
} from './report';

/**
 * Interactive shell over the same harness the batch entrypoint drives.
 *
 * The batch path stays the default so a container with no TTY never lands on a
 * prompt; this is opt-in via --interactive. Settings changed here are held as
 * an env overlay and handed to `loadConfig` on each run, so `Config.ts` remains
 * the only module that reads and validates the environment.
 */

/** Settings worth changing between runs; anything else belongs in .env. */
const SETTABLE = [
  'SOURCE_KIND',
  'DATABASE_URL',
  'SOURCE_SCHEMA',
  'OBSERVATION_FIXTURE_DIR',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MOCK_SCRIPT',
  'LLM_TEMPERATURE',
  'PROMPT_VERSION',
  'PROMPTS_DIR',
  'ONTOLOGY_MAX_DEPTH',
  'ONTOLOGY_MAX_ITERATIONS',
  'ONTOLOGY_MAX_LLM_CALLS',
  'OUTPUT_DIR',
  'LOG_LEVEL',
] as const;

interface Session {
  overrides: Record<string, string>;
  result?: OntologyResult;
  file?: string;
}

const dim = (s: string) => chalk.dim(s);
const head = (s: string) => `\n${chalk.bold.underline(s)}\n`;

function out(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

/** Secrets are shown as a presence flag: a shared terminal is not a vault. */
function displayValue(key: string, value: string): string {
  return key.includes('KEY') ? chalk.dim('(set)') : value;
}

function resolveConfig(session: Session): Config {
  return loadConfig({ ...process.env, ...session.overrides } as NodeJS.ProcessEnv);
}

function renderHelp(): string {
  const rows: Array<[string, string]> = [
    ['run', 'execute one exploration with the current settings'],
    ['config', 'show the settings this session will run with'],
    ['set <KEY> <VALUE>', 'change a setting for the next run'],
    ['unset <KEY>', 'drop an override, falling back to .env'],
    ['keys', 'list the settings that can be changed here'],
    ['report', 'reprint the full report for the loaded run'],
    ['summary', 'counts and budget for the loaded run'],
    ['depth', 'semantic depth per node'],
    ['decisions', 'each depth decision and the reason behind it'],
    ['gaps', 'what the run did not resolve'],
    ['risks', 'what the completion assessment says could be wrong'],
    ['node <id>', 'everything the ontology holds about one node'],
    ['runs', 'saved runs in the output directory'],
    ['load <runId>', 'load a saved run for inspection'],
    ['clear', 'clear the screen'],
    ['help', 'this list'],
    ['exit', 'leave'],
  ];
  const width = Math.max(...rows.map(([c]) => c.length));
  return (
    head('Commands') +
    rows.map(([c, d]) => `  ${chalk.bold(c.padEnd(width))}  ${dim(d)}`).join('\n')
  );
}

function renderConfig(config: Config, overrides: Record<string, string>): string {
  const rows: Array<[string, string]> = [
    ['source', config.source.kind],
    [
      config.source.kind === 'postgres' ? 'database' : 'fixtures',
      config.source.kind === 'postgres'
        ? config.source.databaseUrl
          ? dim('(set)')
          : chalk.red('(missing)')
        : config.source.fixtureDir,
    ],
    ['provider', config.llm.provider],
    ['model', config.llm.model],
    ['base url', config.llm.baseUrl ?? dim('(none)')],
    ['mock script', config.llm.mockScript ?? dim('(none)')],
    ['prompts', `${config.prompts.dir} @ ${config.prompts.version}`],
    ['output', config.output.dir],
    [
      'limits',
      `depth ${config.ontology.maxDepth} / iterations ${config.ontology.maxIterations} / llm calls ${config.ontology.maxLLMCalls}`,
    ],
    ['log level', config.logLevel],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `  ${dim(k.padEnd(width))}  ${v}`).join('\n');

  const changed = Object.keys(overrides);
  const footer = changed.length
    ? `\n\n  ${dim('overridden this session:')} ${changed
        .map((k) => `${chalk.cyan(k)}=${displayValue(k, overrides[k]!)}`)
        .join(dim(', '))}`
    : `\n\n  ${dim('no session overrides; all of the above comes from .env')}`;

  return head('Settings') + body + footer;
}

function renderGaps(result: OntologyResult): string {
  if (!result.gaps.length) return `  ${dim('(none unresolved)')}`;
  return result.gaps
    .map((g) => `  ${chalk.yellow('?')} ${JSON.stringify(g)}`)
    .join('\n');
}

function renderRisks(result: OntologyResult): string {
  const risks = result.completion?.remainingRisks ?? [];
  if (!risks.length) return `  ${dim('(none recorded)')}`;
  return risks.map((r) => `  ${chalk.yellow('!')} ${r}`).join('\n');
}

/** One node across every collection that mentions it. */
function renderNode(result: OntologyResult, id: string): string {
  const o = result.ontology;
  const lines: string[] = [];
  const depth = result.depth.nodeDepths[id];

  const entity = o.entities.find((e) => e.id === id || e.name === id);
  if (entity) {
    lines.push(`  ${chalk.bold(entity.name)}  ${dim(entity.description ?? '')}`);
    for (const a of entity.attributes ?? []) {
      lines.push(
        `    ${dim('-')} ${a.name} ${dim(a.type)}${a.unit ? dim(' ' + a.unit) : ''}`
      );
    }
  }

  const related = o.relationships.filter(
    (r) => r.sourceEntity === id || r.targetEntity === id
  );
  if (related.length) {
    lines.push(`  ${dim('relationships')}`);
    for (const r of related) {
      lines.push(
        `    ${r.sourceEntity} ${chalk.blue(r.relationship)} ${r.targetEntity} ` +
          dim(r.cardinality ?? '')
      );
    }
  }

  for (const c of o.concepts.filter((c) => (c.basedOn ?? []).includes(id))) {
    lines.push(`  ${chalk.magenta('concept')} ${c.name}`);
  }
  for (const m of o.metrics.filter((m) => (m.basedOn ?? []).includes(id))) {
    lines.push(`  ${chalk.green('metric')} ${m.name}`);
  }
  for (const u of o.uncertain.filter((u) => u.targetId === id)) {
    lines.push(`  ${chalk.yellow('uncertain')} ${u.reason}`);
  }

  if (!lines.length) return `  ${dim('nothing in the ontology matches ' + id)}`;
  if (depth !== undefined) {
    lines.unshift(`  ${dim('depth')} ${depth} ${dim(tierName(depth))}`);
  }
  return lines.join('\n');
}

async function listRuns(dir: string): Promise<string> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return `  ${dim('nothing saved yet in ' + dir)}`;
  }
  const runs = files.filter((f) => f.startsWith('ontology-') && f.endsWith('.json'));
  if (!runs.length) return `  ${dim('nothing saved yet in ' + dir)}`;
  return runs
    .map((f) => `  ${chalk.cyan(f.slice('ontology-'.length, -'.json'.length))}`)
    .join('\n');
}

/** A saved run is a document, not a live result; enough of one to inspect. */
async function loadRun(dir: string, runId: string): Promise<OntologyResult> {
  const raw = await fs.readFile(`${dir}/ontology-${runId}.json`, 'utf-8');
  return JSON.parse(raw) as OntologyResult;
}

async function doRun(session: Session): Promise<string> {
  const config = resolveConfig(session);
  const logger = createLogger(config.logLevel);
  const harness = new OntologyHarness({ config, logger });

  out(
    `\n  ${dim('running')} ${chalk.bold(config.llm.provider)}/${chalk.bold(
      config.llm.model
    )} ${dim('over')} ${chalk.bold(config.source.kind)}${dim(' ...')}`
  );

  const result = await harness.run(OntologyHarness.sourceFromConfig(config));
  const file = await new FileOntologyStore(config.output.dir).save(result);

  session.result = result;
  session.file = file;
  return renderReport(result, file);
}

function requireResult(session: Session): OntologyResult | undefined {
  if (!session.result) {
    out(
      `  ${dim('no run loaded yet - try')} ${chalk.bold('run')} ${dim('or')} ${chalk.bold(
        'load <runId>'
      )}`
    );
    return undefined;
  }
  return session.result;
}

/** Returns false only when the shell should close. */
async function dispatch(session: Session, line: string): Promise<boolean> {
  const [command, ...rest] = line.trim().split(/\s+/);
  if (!command) return true;

  switch (command.toLowerCase()) {
    case 'exit':
    case 'quit':
      return false;

    case 'help':
    case '?':
      out(renderHelp());
      return true;

    case 'keys':
      out(head('Settable') + SETTABLE.map((k) => `  ${k}`).join('\n'));
      return true;

    case 'config':
      out(renderConfig(resolveConfig(session), session.overrides));
      return true;

    case 'set': {
      const [key, ...value] = rest;
      if (!key || !value.length) {
        out(`  ${dim('usage:')} set <KEY> <VALUE>`);
        return true;
      }
      const upper = key.toUpperCase();
      if (!(SETTABLE as readonly string[]).includes(upper)) {
        out(`  ${dim(upper + ' is not settable here; see')} ${chalk.bold('keys')}`);
        return true;
      }
      const previous = session.overrides[upper];
      session.overrides[upper] = value.join(' ');
      // Validate at the point it was typed: a bad combination reported several
      // commands later reads as a failure of the run, not of the setting.
      try {
        resolveConfig(session);
        out(`  ${chalk.cyan(upper)} = ${displayValue(upper, session.overrides[upper]!)}`);
      } catch (err) {
        if (previous === undefined) delete session.overrides[upper];
        else session.overrides[upper] = previous;
        out(renderFatal((err as Error).message));
        out(`  ${dim('reverted; the setting is unchanged')}`);
      }
      return true;
    }

    case 'unset': {
      const key = rest[0]?.toUpperCase();
      if (!key) {
        out(`  ${dim('usage:')} unset <KEY>`);
        return true;
      }
      delete session.overrides[key];
      out(`  ${dim('dropped')} ${chalk.cyan(key)}`);
      return true;
    }

    case 'run':
      out(await doRun(session));
      return true;

    case 'report': {
      const result = requireResult(session);
      if (result) out(renderReport(result, session.file ?? '(not saved)'));
      return true;
    }

    case 'summary': {
      const result = requireResult(session);
      if (result) out(head('Ontology') + renderSummary(result));
      return true;
    }

    case 'depth':
    case 'depths': {
      const result = requireResult(session);
      if (result) out(head('Semantic depth per node') + renderDepths(result));
      return true;
    }

    case 'decisions': {
      const result = requireResult(session);
      if (result) out(head('Exploration decisions') + renderDecisions(result));
      return true;
    }

    case 'gaps': {
      const result = requireResult(session);
      if (result) out(head('Unresolved gaps') + renderGaps(result));
      return true;
    }

    case 'risks': {
      const result = requireResult(session);
      if (result) out(head('What could still be got wrong') + renderRisks(result));
      return true;
    }

    case 'node': {
      const id = rest.join(' ');
      if (!id) {
        out(`  ${dim('usage:')} node <id>`);
        return true;
      }
      const result = requireResult(session);
      if (result) out(head(id) + renderNode(result, id));
      return true;
    }

    case 'runs':
      out(head('Saved runs') + (await listRuns(resolveConfig(session).output.dir)));
      return true;

    case 'load': {
      const runId = rest[0];
      if (!runId) {
        out(`  ${dim('usage:')} load <runId>`);
        return true;
      }
      const dir = resolveConfig(session).output.dir;
      session.result = await loadRun(dir, runId);
      session.file = `${dir}/ontology-${runId}.json`;
      out(`  ${dim('loaded')} ${chalk.cyan(runId)}`);
      return true;
    }

    case 'clear':
      process.stdout.write('\x1Bc');
      return true;

    default:
      out(`  ${dim('unknown command ' + command + ' - try')} ${chalk.bold('help')}`);
      return true;
  }
}

export async function startInteractive(): Promise<void> {
  const session: Session = {
    // Structured logs share stderr with the prompt, so the shell is quiet by
    // default; `set LOG_LEVEL info` turns the run commentary back on.
    overrides: { LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn' },
  };

  out(`\n${chalk.bold('Ontology Harness')} ${dim('interactive shell')}`);
  out(
    `${dim('type')} ${chalk.bold('help')} ${dim('for commands,')} ${chalk.bold(
      'exit'
    )} ${dim('to leave')}`
  );

  try {
    out(renderConfig(resolveConfig(session), session.overrides));
  } catch (err) {
    // A broken environment must not stop the shell: `set` is how it gets fixed.
    out(renderFatal((err as Error).message));
    out(
      `  ${dim('fix it with')} ${chalk.bold('set <KEY> <VALUE>')}${dim(', then')} ${chalk.bold(
        'config'
      )}`
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on('SIGINT', () => rl.close());

  try {
    for (;;) {
      const line = await rl.question(
        `\n${chalk.bold.cyan('ontology')}${chalk.dim('>')} `
      );
      let keepGoing: boolean;
      try {
        keepGoing = await dispatch(session, line);
      } catch (err) {
        // Every command failure is recoverable; only the shell closing ends it.
        out(renderFatal((err as Error).message));
        keepGoing = true;
      }
      if (!keepGoing) break;
    }
  } catch {
    // rl.question rejects when the stream closes (Ctrl+D, piped input ending).
  } finally {
    rl.close();
  }
  out(dim('\nbye'));
}
