import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { loadConfig, type Config } from '../config/Config';
import { createLogger } from '../config/logger';
import { tierName } from '../core/tiers';
import { FileOntologyStore } from '../ontology/OntologyStore';
import { OntologyHarness, type OntologyResult, type ProgressEvent } from '../OntologyHarness';
import { redactUrl } from '../observation/connection';
import { defaultSourceRegistry, type SourceSupport } from '../observation/SourceRegistry';
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
  'EXPECTED_SCHEMA',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MOCK_SCRIPT',
  'LLM_TEMPERATURE',
  'LLM_COMPLETION_TEMPERATURE',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_VISION_MODELS',
  'DEEPSEEK_MAX_CONTEXT_TOKENS',
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

/** Canonical command words - kept in sync with renderHelp() below; aliases
 *  ('depths', 'quit') are left out so Tab always lands on one spelling. */
const COMMANDS = [
  'run', 'config', 'connect', 'sources', 'set', 'unset', 'keys', 'report',
  'summary', 'depth', 'decisions', 'gaps', 'risks', 'node', 'runs', 'load',
  'clear', 'help', 'exit',
] as const;

const HISTORY_FILE = path.join(os.homedir(), '.ontology-harness_history');
const HISTORY_SIZE = 200;

/** Tab-completes the command word, then `set`/`unset`'s key argument. */
export function completer(line: string): [string[], string] {
  const parts = line.split(' ');
  if (parts.length === 1) {
    const word = parts[0]!;
    const hits = COMMANDS.filter((c) => c.startsWith(word));
    return [hits.length ? [...hits] : [...COMMANDS], word];
  }
  if (parts.length === 2 && (parts[0] === 'set' || parts[0] === 'unset')) {
    const word = parts[1]!.toUpperCase();
    const hits = SETTABLE.filter((k) => k.startsWith(word));
    return [[...hits], parts[1]!];
  }
  return [[], line];
}

/** Best-effort: a shell with no history is a worse shell, not a broken one. */
async function loadHistory(): Promise<string[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
    return raw.split('\n').filter(Boolean).slice(0, HISTORY_SIZE);
  } catch {
    return [];
  }
}

const dim = (s: string) => chalk.dim(s);
const head = (s: string) => `\n${chalk.bold.underline(s)}\n`;

function out(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

/** A connection string carries a password, so it is a secret like any key. */
const SECRET = /KEY|DATABASE_URL/;

/** Secrets are shown as a presence flag: a shared terminal is not a vault. */
function displayValue(key: string, value: string): string {
  return SECRET.test(key) ? chalk.dim('(set)') : value;
}

function resolveConfig(session: Session): Config {
  return loadConfig({ ...process.env, ...session.overrides } as NodeJS.ProcessEnv);
}

function renderHelp(): string {
  const rows: Array<[string, string]> = [
    ['run', 'execute one exploration with the current settings'],
    ['config', 'show the settings this session will run with'],
    ['connect <url>', 'point at any database or warehouse by connection URL'],
    ['sources', 'list connectable schemes and how well each is verified'],
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

const SUPPORT_LABEL: Record<SourceSupport, string> = {
  verified: chalk.green('verified'),
  'wire-compatible': chalk.yellow('wire-compatible'),
  unimplemented: chalk.red('not implemented'),
};

function renderSources(): string {
  // Unimplemented drivers are listed deliberately, not filtered out: seeing
  // "snowflake -> not implemented" is what tells someone their warehouse is
  // recognised but not yet built, instead of leaving them to guess why
  // `connect` rejected the scheme.
  const rows = defaultSourceRegistry().list();
  const width = Math.max(...rows.map((r) => r.scheme.length));
  return (
    head('Connectable schemes') +
    rows
      .map(
        ({ scheme, driver }) =>
          `  ${chalk.bold(scheme.padEnd(width))}  ${SUPPORT_LABEL[driver.support].padEnd(20)} ${dim(driver.name)}`
      )
      .join('\n') +
    `\n\n  ${dim('connect <url> resolves the driver from the scheme, e.g.')} ${chalk.cyan('postgresql://user:pass@host:5432/db')}`
  );
}

function renderConfig(config: Config, overrides: Record<string, string>): string {
  const rows: Array<[string, string]> = [
    ['source', config.source.kind],
    [
      config.source.kind === 'postgres' ? 'database' : 'fixtures',
      config.source.kind === 'postgres'
        ? config.source.databaseUrl
          ? dim('(set) - see connect / node for the resolved driver')
          : chalk.red('(missing) - try connect <url>')
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

/** One line per checkpoint, printed as the run happens - not just at the end. */
function renderProgress(event: ProgressEvent, startedAt: number): string {
  const elapsed = dim(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s]`);
  switch (event.type) {
    case 'observing':
      return `  ${elapsed} ${dim('connecting and reading the schema ...')}`;
    case 'discovery':
      return `  ${elapsed} ${chalk.bold('discovery')} ${event.entities} entities, depth ${event.depth}`;
    case 'decision': {
      const colour =
        event.decision === 'STOP'
          ? chalk.green
          : event.decision === 'GO_DEEPER'
            ? chalk.blue
            : chalk.cyan;
      const targets = event.targetNodes?.length
        ? dim(` -> ${event.targetNodes.join(', ')}`)
        : '';
      const reason =
        event.reason.length > 90 ? event.reason.slice(0, 87) + '...' : event.reason;
      return (
        `  ${elapsed} ${dim(`iteration ${event.iteration}`)} ${colour.bold(event.decision)}${targets}\n` +
        `        ${dim(reason)}`
      );
    }
    case 'stalled':
      return `  ${elapsed} ${chalk.yellow('stalled')} ${dim('- no progress since the last decision')}`;
    case 'limit':
      return `  ${elapsed} ${chalk.yellow('hard limit')} ${dim(event.reason)}`;
    case 'assessing':
      return `  ${elapsed} ${dim('writing the completion summary ...')}`;
    case 'error':
      return `  ${elapsed} ${chalk.red('error')} ${event.message}`;
  }
}

async function doRun(session: Session): Promise<string> {
  const config = resolveConfig(session);
  const logger = createLogger(config.logLevel);
  const startedAt = Date.now();
  const harness = new OntologyHarness({
    config,
    logger,
    onProgress: (event) => out(renderProgress(event, startedAt)),
  });

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

    case 'sources':
      out(renderSources());
      return true;

    case 'connect': {
      const url = rest.join(' ');
      if (!url) {
        out(`  ${dim('usage:')} connect <url>`);
        out(`  ${dim('see')} ${chalk.bold('sources')} ${dim('for connectable schemes')}`);
        return true;
      }
      // Resolved before it touches config: a bad scheme, or a recognised but
      // unimplemented one, is rejected at the point it was typed - the same
      // reasoning `set` already applies to a bad configuration combination.
      let redacted: string;
      try {
        const { driver, connection } = defaultSourceRegistry().createObserver(url, 'public');
        redacted = connection.redacted;
        out(`  ${chalk.cyan(driver.name)} ${dim('<-')} ${redacted}`);
        if (driver.support === 'wire-compatible') {
          out(`  ${chalk.yellow('!')} ${driver.note}`);
        }
      } catch (err) {
        out(renderFatal((err as Error).message));
        return true;
      }

      // The URL itself carries the password (SECRET already masks
      // DATABASE_URL in every echo), and the driver check above did not touch
      // session state, so nothing here needs reverting on the next check.
      const previous = { ...session.overrides };
      session.overrides.SOURCE_KIND = 'postgres';
      session.overrides.DATABASE_URL = url;
      try {
        resolveConfig(session);
        out(`  ${dim('connected. try')} ${chalk.bold('run')}`);
      } catch (err) {
        session.overrides = previous;
        out(renderFatal((err as Error).message));
        out(`  ${dim('reverted; the connection is unchanged')}`);
      }
      return true;
    }

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
    )} ${dim('to leave -')} ${dim('Tab completes, ↑/↓ recall history across sessions')}`
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
    completer,
    history: await loadHistory(),
    historySize: HISTORY_SIZE,
    removeHistoryDuplicates: true,
  });
  rl.on('SIGINT', () => rl.close());
  // Fire-and-forget: persisting one command line must never block or crash
  // the shell over it, so a write failure is silently dropped.
  rl.on('history', (history) => {
    fs.writeFile(HISTORY_FILE, history.join('\n'), 'utf-8').catch(() => undefined);
  });

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
