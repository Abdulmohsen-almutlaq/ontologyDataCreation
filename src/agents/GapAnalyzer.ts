import * as crypto from 'node:crypto';
import { SemanticTier } from '../core/tiers';
import type { Gap, HarnessStatus, Ontology } from '../core/types';
import type { ExplorationState } from '../exploration/ExplorationState';
import { jsonSchemas } from '../schemas';
import { GapsResponseSchema } from '../schemas/llm';
import { BaseAgent } from './BaseAgent';
import { buildContext } from './context';

function gapId(): string {
  return `gap_${crypto.randomBytes(4).toString('hex')}`;
}

export interface GapAnalyzerOptions {
  lowConfidenceBelow?: number;
  /** run the LLM pass in addition to the deterministic one */
  useLLM?: boolean;
}

/**
 * Finds what is not yet known.
 *
 * Two passes, deliberately: a deterministic pass that can be relied on (an
 * entity with no attributes, a concept with no evidence, a node never
 * explored), and an LLM pass for semantic gaps no static rule can see - an
 * ambiguous business concept, a missing notion the domain implies. The
 * deterministic gaps are marked as such so the depth controller can weigh them
 * differently from the model's own suggestions.
 */
export class GapAnalyzer extends BaseAgent {
  readonly name = 'GapAnalyzer';

  async analyze(
    state: ExplorationState,
    options: GapAnalyzerOptions = {}
  ): Promise<Gap[]> {
    const deterministic = this.analyzeDeterministic(state, options);
    if (options.useLLM === false) return deterministic;

    const response = await this.reason({
      promptName: 'exploration/gap-analysis',
      systemPromptName: 'system/base',
      variables: buildContext(state, { gaps: deterministic }),
      schema: GapsResponseSchema,
      schemaName: 'GapAnalysis',
      jsonSchema: jsonSchemas.gaps,
      label: 'gap-analysis',
      iteration: state.iteration,
      state: 'ANALYZING_GAPS' as HarnessStatus,
    });

    const semantic: Gap[] = response.gaps.map((g) => ({
      id: gapId(),
      type: g.type,
      target: g.target,
      severity: g.severity,
      reason: g.reason,
      deterministic: false,
    }));

    return dedupe([...deterministic, ...semantic]);
  }

  /** Static structural gaps. No model involved, so these are always available. */
  analyzeDeterministic(
    state: ExplorationState,
    options: GapAnalyzerOptions = {}
  ): Gap[] {
    const o: Ontology = state.ontology;
    const gaps: Gap[] = [];
    const lowConfidence = options.lowConfidenceBelow ?? 0.5;

    const add = (
      type: Gap['type'],
      target: string,
      severity: Gap['severity'],
      reason: string
    ) => gaps.push({ id: gapId(), type, target, severity, reason, deterministic: true });

    for (const e of o.entities) {
      if (e.attributes.length === 0) {
        add(
          'MISSING_EVIDENCE',
          e.id,
          'medium',
          'Entity has no attributes, so its identity and shape are undefined'
        );
      }
      if (e.confidence < lowConfidence) {
        add('LOW_CONFIDENCE', e.id, 'medium', `Entity confidence ${e.confidence.toFixed(2)}`);
      }
      if (e.evidence.length === 0) {
        add('MISSING_EVIDENCE', e.id, 'high', 'Entity is asserted without any evidence');
      }
      const related = o.relationships.some(
        (r) => r.sourceEntity === e.id || r.targetEntity === e.id
      );
      if (!related && o.entities.length > 1) {
        add(
          'UNKNOWN_RELATIONSHIP',
          e.id,
          'medium',
          'Entity is not connected to any other entity'
        );
      }
    }

    for (const group of [o.concepts, o.metrics, o.events, o.rules] as Array<
      Array<{ id: string; confidence: number; evidence: unknown[]; basedOn: string[] }>
    >) {
      for (const item of group) {
        if (item.evidence.length === 0) {
          add('MISSING_EVIDENCE', item.id, 'high', 'Asserted without evidence');
        }
        if (item.confidence < lowConfidence) {
          add(
            'AMBIGUOUS_CONCEPT',
            item.id,
            'high',
            `Confidence ${item.confidence.toFixed(2)} is too low to rely on`
          );
        }
        if (item.basedOn.length === 0) {
          add('MISSING_BUSINESS_SEMANTICS', item.id, 'medium', 'Not grounded in any entity');
        }
      }
    }

    for (const u of o.uncertain) {
      add('AMBIGUOUS_CONCEPT', u.targetId, 'high', u.reason);
    }

    for (const nodeId of state.unexploredNodes) {
      const depth = state.depth.nodeDepths[nodeId] ?? 0;
      if (depth <= SemanticTier.ATTRIBUTE) {
        add(
          'UNEXPLORED_BRANCH',
          nodeId,
          'low',
          `Node has never been targeted and sits at depth ${depth}`
        );
      }
    }

    if (state.lastValidation) {
      for (const issue of state.lastValidation.issues) {
        if (issue.severity === 'error') {
          add('CONTRADICTION', issue.target, 'high', `${issue.code}: ${issue.message}`);
        }
      }
    }

    return dedupe(gaps);
  }
}

function dedupe(gaps: Gap[]): Gap[] {
  const seen = new Set<string>();
  const out: Gap[] = [];
  for (const g of gaps) {
    const key = `${g.type}|${g.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}
