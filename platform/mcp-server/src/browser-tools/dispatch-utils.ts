import { log } from '../logger.js';

/**
 * Validate the shape of a dispatch result from the browser extension.
 *
 * Dispatch results may return either an array (legacy format) or an object
 * with a named array property (current format). If neither matches, a warning
 * is logged and an empty array is returned for graceful degradation.
 */
const validateDispatchResult = <T>(result: unknown, expectedKey: string, context: string): T[] => {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === 'object' && expectedKey in result) {
    const value = (result as Record<string, unknown>)[expectedKey];
    if (Array.isArray(value)) return value as T[];
  }
  log.warn(`Unexpected dispatch result shape for ${context}: expected key "${expectedKey}", got:`, result);
  return [];
};

export { validateDispatchResult };
