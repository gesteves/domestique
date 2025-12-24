import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDistance,
  formatSpeed,
  formatPace,
  isSwimmingActivity,
} from '../../src/utils/format-units.js';

describe('format-units', () => {
  describe('formatDuration', () => {
    it('should always use h:mm:ss format for unambiguous durations', () => {
      // Seconds under a minute
      expect(formatDuration(45)).toBe('0:00:45');
      expect(formatDuration(0)).toBe('0:00:00');
      expect(formatDuration(59)).toBe('0:00:59');

      // Minutes without hours
      expect(formatDuration(60)).toBe('0:01:00');
      expect(formatDuration(90)).toBe('0:01:30');
      expect(formatDuration(2700)).toBe('0:45:00');
      expect(formatDuration(3599)).toBe('0:59:59');

      // Hours with minutes and seconds
      expect(formatDuration(3600)).toBe('1:00:00');
      expect(formatDuration(5400)).toBe('1:30:00');
      expect(formatDuration(7265)).toBe('2:01:05');
      expect(formatDuration(36000)).toBe('10:00:00');
    });

    it('should pad minutes and seconds with zeros', () => {
      expect(formatDuration(3605)).toBe('1:00:05');
      expect(formatDuration(3661)).toBe('1:01:01');
      expect(formatDuration(65)).toBe('0:01:05');
    });

    it('should round fractional seconds', () => {
      expect(formatDuration(90.4)).toBe('0:01:30');
      expect(formatDuration(90.6)).toBe('0:01:31');
    });
  });

  describe('formatDistance', () => {
    it('should format non-swimming distances in km', () => {
      expect(formatDistance(42.5, false)).toBe('42.5 km');
      expect(formatDistance(100, false)).toBe('100.0 km');
      expect(formatDistance(0.5, false)).toBe('0.5 km');
    });

    it('should format swimming distances in meters', () => {
      expect(formatDistance(2.5, true)).toBe('2500 m');
      expect(formatDistance(1, true)).toBe('1000 m');
      expect(formatDistance(0.4, true)).toBe('400 m');
    });

    it('should round swimming distances to whole meters', () => {
      expect(formatDistance(2.525, true)).toBe('2525 m');
      expect(formatDistance(0.025, true)).toBe('25 m');
    });

    it('should format with one decimal place for km', () => {
      expect(formatDistance(42.195, false)).toBe('42.2 km');
      // Note: 5.55 rounds to 5.5 due to floating-point precision (5.55 is actually 5.5499... in binary)
      expect(formatDistance(5.55, false)).toBe('5.5 km');
      expect(formatDistance(5.56, false)).toBe('5.6 km');
    });
  });

  describe('formatSpeed', () => {
    it('should format speed with one decimal place', () => {
      expect(formatSpeed(32.5)).toBe('32.5 km/h');
      expect(formatSpeed(0)).toBe('0.0 km/h');
      expect(formatSpeed(55.123)).toBe('55.1 km/h');
    });

    it('should round correctly', () => {
      expect(formatSpeed(30.05)).toBe('30.1 km/h');
      expect(formatSpeed(30.04)).toBe('30.0 km/h');
    });
  });

  describe('formatPace', () => {
    describe('running pace (per km)', () => {
      it('should format standard running paces', () => {
        expect(formatPace(240, false)).toBe('4:00/km');
        expect(formatPace(270, false)).toBe('4:30/km');
        expect(formatPace(300, false)).toBe('5:00/km');
      });

      it('should pad seconds with zeros', () => {
        expect(formatPace(245, false)).toBe('4:05/km');
        expect(formatPace(301, false)).toBe('5:01/km');
      });

      it('should handle fast paces', () => {
        expect(formatPace(180, false)).toBe('3:00/km');
        expect(formatPace(165, false)).toBe('2:45/km');
      });

      it('should handle slow paces', () => {
        expect(formatPace(420, false)).toBe('7:00/km');
        expect(formatPace(600, false)).toBe('10:00/km');
      });

      it('should round fractional seconds', () => {
        expect(formatPace(270.4, false)).toBe('4:30/km');
        expect(formatPace(270.6, false)).toBe('4:31/km');
      });
    });

    describe('swimming pace (per 100m)', () => {
      it('should format standard swimming paces', () => {
        // 120 sec/km = 12 sec/100m = 0:12/100m
        expect(formatPace(100, true)).toBe('0:10/100m');
        // 200 sec/km = 20 sec/100m = 0:20/100m
        expect(formatPace(200, true)).toBe('0:20/100m');
      });

      it('should format typical pool paces', () => {
        // 90 sec/100m = 900 sec/km
        expect(formatPace(900, true)).toBe('1:30/100m');
        // 105 sec/100m = 1050 sec/km
        expect(formatPace(1050, true)).toBe('1:45/100m');
        // 120 sec/100m = 1200 sec/km
        expect(formatPace(1200, true)).toBe('2:00/100m');
      });

      it('should pad seconds with zeros', () => {
        // 65 sec/100m = 650 sec/km
        expect(formatPace(650, true)).toBe('1:05/100m');
        // 61 sec/100m = 610 sec/km
        expect(formatPace(610, true)).toBe('1:01/100m');
      });
    });
  });

  describe('isSwimmingActivity', () => {
    it('should identify swimming activities', () => {
      expect(isSwimmingActivity('Swimming')).toBe(true);
      expect(isSwimmingActivity('Swim')).toBe(true);
      expect(isSwimmingActivity('OpenWaterSwim')).toBe(true);
      expect(isSwimmingActivity('Pool')).toBe(true);
      expect(isSwimmingActivity('PoolSwim')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isSwimmingActivity('swimming')).toBe(true);
      expect(isSwimmingActivity('SWIMMING')).toBe(true);
      expect(isSwimmingActivity('SwImMiNg')).toBe(true);
    });

    it('should not identify non-swimming activities', () => {
      expect(isSwimmingActivity('Cycling')).toBe(false);
      expect(isSwimmingActivity('Running')).toBe(false);
      expect(isSwimmingActivity('Ride')).toBe(false);
      expect(isSwimmingActivity('Walk')).toBe(false);
      expect(isSwimmingActivity('Strength')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isSwimmingActivity('')).toBe(false);
      expect(isSwimmingActivity('LapSwimming')).toBe(true);
      expect(isSwimmingActivity('IndoorSwimming')).toBe(true);
    });
  });
});
