import { describe, it, expect } from 'vitest';
import { formatPaceFromSpeed, secondsToSampleIndex } from '../../src/clients/intervals.js';

describe('formatPaceFromSpeed (Intervals.icu stores threshold pace as m/s)', () => {
  it('formats every supported pace unit', () => {
    // 4:00/km = 1000 m / 240 s
    expect(formatPaceFromSpeed(1000 / 240, 'MINS_KM')).toBe('4:00/km');
    // 7:00/mi = 1609.344 m / 420 s
    expect(formatPaceFromSpeed(1609.344 / 420, 'MINS_MILE')).toBe('7:00/mi');
    // 1:45/100m
    expect(formatPaceFromSpeed(100 / 105, 'SECS_100M')).toBe('1:45/100m');
    // 1:30/100yd = 91.44 m / 90 s
    expect(formatPaceFromSpeed(91.44 / 90, 'SECS_100Y')).toBe('1:30/100yd');
    // Rowing split 2:00/500m
    expect(formatPaceFromSpeed(500 / 120, 'SECS_500M')).toBe('2:00/500m');
    expect(formatPaceFromSpeed(400 / 80, 'SECS_400M')).toBe('1:20/400m');
    expect(formatPaceFromSpeed(250 / 50, 'SECS_250M')).toBe('50s/250m');
  });

  it('shows sub-minute SECS_* paces as plain seconds', () => {
    expect(formatPaceFromSpeed(100 / 45, 'SECS_100M')).toBe('45s/100m');
  });

  it('never renders 60 seconds', () => {
    expect(formatPaceFromSpeed(1000 / 299.6, 'MINS_KM')).toBe('5:00/km');
    expect(formatPaceFromSpeed(100 / 119.6, 'SECS_100M')).toBe('2:00/100m');
  });

  it('falls back to a speed for NONE or unknown units', () => {
    expect(formatPaceFromSpeed(10, 'NONE')).toBe('36.0 km/h');
  });
});

describe('secondsToSampleIndex', () => {
  it('returns the first sample at or after the time, clamped to the last sample', () => {
    const time = [0, 2, 4, 10, 12];
    expect(secondsToSampleIndex(time, 0)).toBe(0);
    expect(secondsToSampleIndex(time, 3)).toBe(2);
    expect(secondsToSampleIndex(time, 5)).toBe(3); // inside a pause → next sample
    expect(secondsToSampleIndex(time, 12)).toBe(4);
    expect(secondsToSampleIndex(time, 99)).toBe(4);
  });
});
