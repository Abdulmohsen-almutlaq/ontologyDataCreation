import type { Ontology, ValidationIssue, ValidationResult } from '../core/types';
import {
  acyclicRule,
  buildIndex,
  CORE_VALIDATION_RULES,
  type ValidationRule,
} from './validation';

export interface ValidatorOptions {
  /** assertions at or above this confidence must carry evidence */
  evidenceRequiredAbove?: number;
  /** allow relationship cycles (self-referential hierarchies are legitimate) */
  allowCycles?: boolean;
  /** replace the base rule set; defaults to the core rules */
  rules?: ValidationRule[];
}

const DEFAULT_EVIDENCE_THRESHOLD = 0.7;

/**
 * Deterministic structural validator: a Composite over independent rules.
 *
 * Runs on the CANDIDATE ontology before an operation batch is committed, so a
 * failing batch is rejected wholesale and the live ontology is never left in an
 * invalid state. Adding a structural check means adding a rule object, not
 * extending a method that already answers nine unrelated questions.
 *
 * Errors block a commit; warnings do not. That distinction is deliberate — an
 * unconnected entity is worth reporting but is not grounds for discarding an
 * otherwise sound batch.
 */
export class OntologyValidator {
  private readonly rules: ValidationRule[];
  private readonly evidenceRequiredAbove: number;

  constructor(private readonly options: ValidatorOptions = {}) {
    this.evidenceRequiredAbove =
      options.evidenceRequiredAbove ?? DEFAULT_EVIDENCE_THRESHOLD;
    // `allowCycles` composes with any base set, custom ones included: an option
    // that applies only to the default rules would be silently ignored exactly
    // when a caller took the trouble to specify something.
    const base = options.rules ?? CORE_VALIDATION_RULES;
    this.rules = [
      ...base,
      ...(options.allowCycles === false && !base.includes(acyclicRule)
        ? [acyclicRule]
        : []),
    ];
  }

  /** Rules applied to every candidate, in order. */
  get ruleNames(): string[] {
    return this.rules.map((r) => r.name);
  }

  validate(ontology: Ontology): ValidationResult {
    const ctx = {
      evidenceRequiredAbove: this.evidenceRequiredAbove,
      index: buildIndex(ontology),
    };

    const issues: ValidationIssue[] = [];
    for (const rule of this.rules) {
      issues.push(...rule.check(ontology, ctx));
    }

    return { valid: !issues.some((i) => i.severity === 'error'), issues };
  }
}

export function formatIssues(issues: ValidationIssue[]): string {
  if (!issues.length) return '  (none)';
  return issues
    .map((i) => `  [${i.severity.toUpperCase()}] ${i.code} @ ${i.target}: ${i.message}`)
    .join('\n');
}
