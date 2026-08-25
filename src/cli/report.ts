import chalk from 'chalk';
import { tierName } from '../core/tiers';
import type { OntologyResult } from '../OntologyHarness';

/**
 * Terminal presentation for a finished run.
 *
 * Separate from the harness on purpose: the loop produces a result, this
 * decides how it reads. Colour is applied by meaning, not decoration — depth
 * shades with tier, and anything the ontology is unsure about is amber, so the
 * limits of a run are the part that catches the eye.
 *
 * chalk detects a non-TTY and strips colour itself, so piped output stays clean.
 */

const TIER_COLOUR = [
  chalk.gray, // 0 DATASET
  chalk.white, // 1 ENTITY
  chalk.cyan, // 2 ATTRIBUTE
  chalk.blue, // 3 RELATIONSHIP
  chalk.magenta, // 4 CONCEPT
  chalk.green, // 5 METRIC
  chalk.yellow, // 6 EVENT
  chalk.red, // 7 RULE
];

function tierColour(depth: number) {
  return TIER_COLOUR[Math.min(depth, TIER_COLOUR.length - 1)] ?? chalk.white;
}

const bar = (depth: number) => '█'.repeat(Math.max(depth, 1));

function heading(text: string): string {
  return `\n${chalk.bold.underline(text)}\n`;
}

/** Termination is the one field where the wording alone is easy to misread. */
function terminationLabel(result: OntologyResult): string {
  if (result.status === 'FAILED') return chalk.bgRed.white.bold(' FAILED ');
  switch (result.terminationReason) {
    case 'AGENT_STOP':
      return chalk.green('stopped by the depth controller');
    case 'STALLED':
      return chalk.yellow('stopped by the stall detector');
    default:
      return chalk.yellow(`stopped by a hard limit (${result.terminationReason})`);
  }
}

export function renderDepths(result: OntologyResult): string {
  const entries = Object.entries(result.depth.nodeDepths).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return chalk.dim('  (no nodes)');

  const width = Math.max(...entries.map(([node]) => node.length));
  return entries
    .map(([node, depth]) => {
      const colour = tierColour(depth);
      return (
        `  ${chalk.bold(node.padEnd(width))}  ` +
        `${colour(bar(depth).padEnd(8))} ` +
        `${colour.bold(String(depth))} ${chalk.dim(tierName(depth))}`
      );
    })
    .join('\n');
}

export function renderSummary(result: OntologyResult): string {
  const o = result.ontology;
  const stat = (label: string, value: number, colour = chalk.white) =>
    `${colour.bold(String(value))} ${chalk.dim(label)}`;

  return [
    '  ' +
      [
        stat('entities', o.entities.length),
        stat('relationships', o.relationships.length),
        stat('concepts', o.concepts.length, chalk.magenta),
        stat('metrics', o.metrics.length, chalk.green),
        stat('uncertain', o.uncertain.length, chalk.yellow),
      ].join(chalk.dim('  ·  ')),
    '  ' +
      [
        stat('iterations', result.iterations),
        stat('LLM calls', result.llmCalls),
        stat('observations', result.observationRequests),
        `${chalk.bold((result.elapsedMs / 1000).toFixed(1) + 's')} ${chalk.dim('elapsed')}`,
      ].join(chalk.dim('  ·  ')),
  ].join('\n');
}

export function renderDecisions(result: OntologyResult): string {
  if (!result.decisions.length) return chalk.dim('  (none)');
  return result.decisions
    .map((d, i) => {
      const colour =
        d.decision === 'STOP'
          ? chalk.green
          : d.decision === 'GO_DEEPER'
            ? chalk.blue
            : chalk.cyan;
      const targets = d.targetNodes?.length
        ? chalk.dim(` → ${d.targetNodes.join(', ')}`)
        : '';
      return (
        `  ${chalk.dim(`#${i + 1}`)} ${colour.bold(d.decision.padEnd(15))}${targets}\n` +
        `      ${chalk.dim(d.reason)}`
      );
    })
    .join('\n');
}

export function renderReport(result: OntologyResult, outputFile: string): string {
  const lines: string[] = [];

  lines.push(heading('Ontology'));
  lines.push(renderSummary(result));

  lines.push(heading('Semantic depth per node'));
  lines.push(renderDepths(result));

  lines.push(heading('Exploration decisions'));
  lines.push(renderDecisions(result));

  if (result.completion) {
    lines.push(heading('What this data is about'));
    lines.push(`  ${result.completion.summary}`);

    if (result.completion.remainingRisks.length) {
      lines.push(heading('What could still be got wrong'));
      for (const risk of result.completion.remainingRisks) {
        lines.push(`  ${chalk.yellow('!')} ${risk}`);
      }
    }
  }

  lines.push('');
  lines.push(`  ${terminationLabel(result)}`);
  lines.push(`  ${chalk.dim('written to')} ${chalk.cyan(outputFile)}`);
  lines.push('');

  return lines.join('\n');
}

export function renderFatal(message: string): string {
  return `${chalk.bgRed.white.bold(' ERROR ')} ${chalk.red(message)}\n`;
}
