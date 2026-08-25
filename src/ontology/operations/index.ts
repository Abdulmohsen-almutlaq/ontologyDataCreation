import { entityHandlers } from './entityHandlers';
import { metaHandlers } from './metaHandlers';
import { OperationRegistry } from './OperationHandler';
import { relationshipHandlers } from './relationshipHandlers';
import { semanticHandlers } from './semanticHandlers';

export * from './OperationHandler';
export * from './entityHandlers';
export * from './relationshipHandlers';
export * from './semanticHandlers';
export * from './metaHandlers';

/**
 * The operations the engine will carry out.
 *
 * An operation type absent from this registry is refused rather than ignored:
 * supporting a new one means writing a handler and adding it here, and nothing
 * else in the engine changes.
 */
export function defaultOperationRegistry(): OperationRegistry {
  return new OperationRegistry()
    .registerAll(entityHandlers)
    .registerAll(relationshipHandlers)
    .registerAll(semanticHandlers)
    .registerAll(metaHandlers);
}
