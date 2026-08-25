import { toId } from '../Ontology';
import {
  applied,
  defineHandler,
  rejected,
  type AnyOperationHandler,
} from './OperationHandler';

/**
 * Operations that say something *about* the ontology rather than changing what
 * it asserts.
 */

export const markUncertainHandler = defineHandler('MARK_UNCERTAIN', (op, batch) => {
  const target = toId(op.target);
  // One mark per target: the latest reason supersedes an earlier one rather
  // than accumulating duplicates across iterations.
  batch.ontology.uncertain = batch.ontology.uncertain.filter(
    (u) => u.targetId !== target
  );
  batch.ontology.uncertain.push({
    targetId: target,
    reason: op.reason,
    markedAtIteration: batch.iteration,
  });
  return applied;
});

export const requestObservationHandler = defineHandler(
  'REQUEST_OBSERVATION',
  (op, batch) => {
    if (op.observationType === 'distinct_overlap' && !op.compareTo) {
      return rejected('INVALID_REQUEST', 'distinct_overlap requires compareTo');
    }
    // Queued, not executed: the engine mutates the ontology, the executor
    // reads the source, and nothing here touches a database.
    batch.requestObservation({
      target: op.target,
      observationType: op.observationType,
      reason: op.reason,
      compareTo: op.compareTo,
      limit: op.limit,
    });
    return applied;
  }
);

export const metaHandlers: AnyOperationHandler[] = [
  markUncertainHandler,
  requestObservationHandler,
];
