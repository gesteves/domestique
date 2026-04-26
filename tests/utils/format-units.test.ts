import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDistance,
  formatSpeed,
  formatPace,
  isSwimmingActivity,
  formatPower,
  formatHR,
  formatPercent,
  formatTemperature,
  formatWeight,
  formatHeight,
  formatLength,
  formatEnergy,
  formatEnergyKJ,
  formatCadence,
  formatMass,
  formatHRV,
  formatVO2max,
  formatBP,
  withUnit,
  isYardPool,
  formatPoolLength,
  formatStrokeLength,
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

    it('formats swim distances in yards when the pool is SCY (25yd ≈ 22.86 m)', () => {
      expect(formatDistance(1.8288, true, 22.86)).toBe('2000 yd'); // 80×25yd workout
      expect(formatDistance(0.0457, true, 22.86)).toBe('50 yd'); // 50yd interval
    });

    it('formats swim distances in yards when the pool is LCY (50yd ≈ 45.72 m)', () => {
      expect(formatDistance(0.0914, true, 45.72)).toBe('100 yd');
      expect(formatDistance(1.8288, true, 45.72)).toBe('2000 yd');
    });

    it('formats swim distances in meters for SCM (25 m), LCM (50 m), and open water', () => {
      expect(formatDistance(0.05, true, 25)).toBe('50 m');
      expect(formatDistance(0.1, true, 50)).toBe('100 m');
      expect(formatDistance(0.182707, true, undefined)).toBe('183 m'); // open water
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

  describe('formatPower', () => {
    it('rounds to whole watts', () => {
      expect(formatPower(220)).toBe('220 W');
      expect(formatPower(220.4)).toBe('220 W');
      expect(formatPower(220.6)).toBe('221 W');
      expect(formatPower(0)).toBe('0 W');
    });
  });

  describe('formatHR', () => {
    it('rounds to whole bpm', () => {
      expect(formatHR(165)).toBe('165 bpm');
      expect(formatHR(165.4)).toBe('165 bpm');
      expect(formatHR(165.6)).toBe('166 bpm');
    });
  });

  describe('formatPercent', () => {
    it('formats whole percentages by default', () => {
      expect(formatPercent(82)).toBe('82%');
      expect(formatPercent(82.4)).toBe('82%');
      expect(formatPercent(82.6)).toBe('83%');
    });

    it('honors decimal precision when requested', () => {
      expect(formatPercent(82.5, 1)).toBe('82.5%');
      expect(formatPercent(0.123, 2)).toBe('0.12%');
    });
  });

  describe('formatTemperature', () => {
    it('keeps one decimal of precision', () => {
      expect(formatTemperature(18)).toBe('18.0 °C');
      expect(formatTemperature(24.36)).toBe('24.4 °C');
      expect(formatTemperature(-2.5)).toBe('-2.5 °C');
    });
  });

  describe('formatWeight', () => {
    it('keeps one decimal', () => {
      expect(formatWeight(75.9)).toBe('75.9 kg');
      expect(formatWeight(75)).toBe('75.0 kg');
      expect(formatWeight(75.95)).toBe('76.0 kg');
    });
  });

  describe('formatHeight', () => {
    it('keeps two decimals', () => {
      expect(formatHeight(1.71)).toBe('1.71 m');
      expect(formatHeight(1.7)).toBe('1.70 m');
      expect(formatHeight(1.715)).toBe('1.72 m');
    });
  });

  describe('formatLength', () => {
    it('rounds to whole meters', () => {
      expect(formatLength(1234)).toBe('1234 m');
      expect(formatLength(25)).toBe('25 m');
      expect(formatLength(1234.6)).toBe('1235 m');
    });
  });

  describe('formatEnergy', () => {
    it('rounds to whole joules', () => {
      expect(formatEnergy(12345)).toBe('12345 J');
      expect(formatEnergy(12345.6)).toBe('12346 J');
    });
  });

  describe('formatEnergyKJ', () => {
    it('rounds to whole kilojoules', () => {
      expect(formatEnergyKJ(1234)).toBe('1234 kJ');
      expect(formatEnergyKJ(1234.6)).toBe('1235 kJ');
    });
  });

  describe('formatCadence', () => {
    it('uses rpm for cycling', () => {
      expect(formatCadence(88, 'Cycling')).toBe('88 rpm');
      expect(formatCadence(88, 'Ride')).toBe('88 rpm');
      expect(formatCadence(88, 'VirtualRide')).toBe('88 rpm');
    });

    it('uses spm for running', () => {
      expect(formatCadence(180, 'Running')).toBe('180 spm');
      expect(formatCadence(180, 'Run')).toBe('180 spm');
      expect(formatCadence(180, 'TrailRun')).toBe('180 spm');
    });

    it('uses spm for swimming', () => {
      expect(formatCadence(60, 'Swim')).toBe('60 spm');
      expect(formatCadence(60, 'Swimming')).toBe('60 spm');
      expect(formatCadence(60, 'OpenWaterSwim')).toBe('60 spm');
    });

    it('uses spm for walking', () => {
      expect(formatCadence(120, 'Walk')).toBe('120 spm');
    });

    it('rounds to whole numbers', () => {
      expect(formatCadence(87.6, 'Cycling')).toBe('88 rpm');
      expect(formatCadence(179.4, 'Running')).toBe('179 spm');
    });

    it('defaults to rpm for unknown sports', () => {
      expect(formatCadence(80, 'Yoga')).toBe('80 rpm');
    });
  });

  describe('formatMass', () => {
    it('rounds to whole grams', () => {
      expect(formatMass(180)).toBe('180 g');
      expect(formatMass(180.6)).toBe('181 g');
    });
  });

  describe('formatHRV', () => {
    it('rounds to whole milliseconds', () => {
      expect(formatHRV(55)).toBe('55 ms');
      expect(formatHRV(54.6)).toBe('55 ms');
    });
  });

  describe('formatVO2max', () => {
    it('keeps one decimal', () => {
      expect(formatVO2max(55)).toBe('55.0 mL/kg/min');
      expect(formatVO2max(54.36)).toBe('54.4 mL/kg/min');
    });
  });

  describe('formatBP', () => {
    it('formats blood pressure as systolic/diastolic mmHg', () => {
      expect(formatBP(120, 80)).toBe('120/80 mmHg');
      expect(formatBP(119.6, 79.4)).toBe('120/79 mmHg');
    });
  });

  describe('isYardPool', () => {
    it('returns true for SCY (25yd ≈ 22.86 m) and LCY (50yd ≈ 45.72 m)', () => {
      expect(isYardPool(22.86)).toBe(true);
      expect(isYardPool(22.85)).toBe(true); // sensor noise tolerance
      expect(isYardPool(45.72)).toBe(true);
    });

    it('returns false for metric pools and unknown lengths', () => {
      expect(isYardPool(25)).toBe(false);
      expect(isYardPool(50)).toBe(false);
      expect(isYardPool(33)).toBe(false); // some odd pool
      expect(isYardPool(undefined)).toBe(false);
      expect(isYardPool(null)).toBe(false);
    });
  });

  describe('formatPoolLength', () => {
    it('rounds yard pools to whole yards', () => {
      expect(formatPoolLength(22.86)).toBe('25 yd');
      expect(formatPoolLength(45.72)).toBe('50 yd');
    });

    it('rounds metric pools to whole meters', () => {
      expect(formatPoolLength(25)).toBe('25 m');
      expect(formatPoolLength(50)).toBe('50 m');
      expect(formatPoolLength(33.33)).toBe('33 m');
    });
  });

  describe('formatStrokeLength', () => {
    it('keeps two decimals and follows pool unit', () => {
      expect(formatStrokeLength(1.42, undefined)).toBe('1.42 m');
      expect(formatStrokeLength(1.42, 25)).toBe('1.42 m');
      expect(formatStrokeLength(0.91, 22.86)).toBe('1.00 yd'); // 0.91 m ≈ 1 yd
      expect(formatStrokeLength(0.5, 45.72)).toBe('0.55 yd');
    });
  });

  describe('withUnit', () => {
    it('formats with default zero decimals', () => {
      expect(withUnit(95, 'mg/dL')).toBe('95 mg/dL');
      expect(withUnit(95.6, 'mg/dL')).toBe('96 mg/dL');
    });

    it('honors decimal precision', () => {
      expect(withUnit(1.234, 'mmol/L', 2)).toBe('1.23 mmol/L');
      expect(withUnit(1.236, 'mmol/L', 2)).toBe('1.24 mmol/L');
    });
  });
});
