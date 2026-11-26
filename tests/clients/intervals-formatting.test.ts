import { describe, it, expect } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

// Private helpers, exercised directly for the rounding edge cases.
const client = new IntervalsClient({ apiKey: 'k', athleteId: 'i1' }) as unknown as {
  formatPaceValue(pace: number, units: string): string;
  formatSleepDuration(seconds: number): string;
};

describe('IntervalsClient formatting rounding', () => {
  it('formatPaceValue never renders 60 seconds', () => {
    expect(client.formatPaceValue(4.9925, 'MINS_KM')).toBe('5:00/km');
    expect(client.formatPaceValue(4.5, 'MINS_KM')).toBe('4:30/km');
    expect(client.formatPaceValue(119.6, 'SECS_100M')).toBe('2:00/100m');
  });

  it('formatSleepDuration never renders 60 minutes', () => {
    expect(client.formatSleepDuration(28_770)).toBe('8h');
    expect(client.formatSleepDuration(27_000)).toBe('7h 30m');
    expect(client.formatSleepDuration(3_570)).toBe('1h');
  });
});
