import { describe, it, expect } from 'vitest';
import {
  METRIC_DEFAULTS,
  getCurrentUnitPreferences,
  runWithUnitPreferences,
} from '../../src/utils/unit-context.js';
import type { UnitPreferences } from '../../src/types/index.js';

const IMPERIAL: UnitPreferences = {
  system: 'imperial',
  weight: 'lb',
  temperature: 'fahrenheit',
  wind: 'mph',
  precipitation: 'inches',
  height: 'feet',
};

describe('unit-context', () => {
  it('returns metric defaults when no context is active', () => {
    expect(getCurrentUnitPreferences()).toEqual(METRIC_DEFAULTS);
  });

  it('exposes the prefs passed to runWithUnitPreferences inside the callback', () => {
    runWithUnitPreferences(IMPERIAL, () => {
      expect(getCurrentUnitPreferences()).toEqual(IMPERIAL);
    });
    // And restores defaults afterwards.
    expect(getCurrentUnitPreferences()).toEqual(METRIC_DEFAULTS);
  });

  it('supports nested contexts', () => {
    const middle: UnitPreferences = { ...METRIC_DEFAULTS, weight: 'lb' };
    runWithUnitPreferences(middle, () => {
      expect(getCurrentUnitPreferences().weight).toBe('lb');
      runWithUnitPreferences(IMPERIAL, () => {
        expect(getCurrentUnitPreferences()).toEqual(IMPERIAL);
      });
      expect(getCurrentUnitPreferences()).toBe(middle);
    });
  });

  it('isolates prefs across concurrent async work', async () => {
    const observed: string[] = [];
    await Promise.all([
      runWithUnitPreferences(IMPERIAL, async () => {
        await new Promise((r) => setTimeout(r, 5));
        observed.push(`a:${getCurrentUnitPreferences().system}`);
      }),
      runWithUnitPreferences(METRIC_DEFAULTS, async () => {
        await new Promise((r) => setTimeout(r, 1));
        observed.push(`b:${getCurrentUnitPreferences().system}`);
      }),
    ]);
    expect(observed.sort()).toEqual(['a:imperial', 'b:metric']);
  });

  it('returns the value from the callback', () => {
    const out = runWithUnitPreferences(IMPERIAL, () => 'ok');
    expect(out).toBe('ok');
  });
});
