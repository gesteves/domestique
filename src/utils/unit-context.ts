import { AsyncLocalStorage } from 'node:async_hooks';
import type { UnitPreferences } from '../types/index.js';

/**
 * Default preferences used when no request-scoped context has been set
 * (e.g., unit tests, scripts, fallback when fetching the athlete profile fails).
 */
export const METRIC_DEFAULTS: UnitPreferences = {
  system: 'metric',
  weight: 'kg',
  temperature: 'celsius',
  wind: 'kmh',
  precipitation: 'mm',
  height: 'cm',
};

const storage = new AsyncLocalStorage<UnitPreferences>();

/**
 * Run `fn` with the given unit preferences attached to the current async context.
 * Formatters that read `getCurrentUnitPreferences()` will see these prefs while
 * the callback (and any awaited continuations) execute.
 */
export function runWithUnitPreferences<T>(prefs: UnitPreferences, fn: () => T): T {
  return storage.run(prefs, fn);
}

/**
 * Read the unit preferences for the current async context, or the metric
 * defaults if no context is active.
 */
export function getCurrentUnitPreferences(): UnitPreferences {
  return storage.getStore() ?? METRIC_DEFAULTS;
}
