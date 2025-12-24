import { describe, it, expect } from 'vitest';
import {
  getRecoveryLevel,
  getRecoveryLevelDescription,
  getSleepPerformanceLevel,
  getSleepPerformanceLevelDescription,
  getStrainLevel,
  getStrainLevelDescription,
} from '../../src/utils/whoop-insights.js';

describe('whoop-insights', () => {
  describe('getRecoveryLevel', () => {
    it('should return SUFFICIENT for recovery >= 67%', () => {
      expect(getRecoveryLevel(67)).toBe('SUFFICIENT');
      expect(getRecoveryLevel(95)).toBe('SUFFICIENT');
      expect(getRecoveryLevel(100)).toBe('SUFFICIENT');
    });

    it('should return ADEQUATE for recovery 34-66%', () => {
      expect(getRecoveryLevel(34)).toBe('ADEQUATE');
      expect(getRecoveryLevel(50)).toBe('ADEQUATE');
      expect(getRecoveryLevel(66)).toBe('ADEQUATE');
    });

    it('should return LOW for recovery < 34%', () => {
      expect(getRecoveryLevel(33)).toBe('LOW');
      expect(getRecoveryLevel(10)).toBe('LOW');
      expect(getRecoveryLevel(0)).toBe('LOW');
    });
  });

  describe('getRecoveryLevelDescription', () => {
    it('should return Whoop official descriptions', () => {
      expect(getRecoveryLevelDescription('SUFFICIENT')).toBe('Well recovered, ready to perform');
      expect(getRecoveryLevelDescription('ADEQUATE')).toBe('Maintaining health, can handle moderate stress');
      expect(getRecoveryLevelDescription('LOW')).toBe('Working hard to recover, needs rest');
    });
  });

  describe('getSleepPerformanceLevel', () => {
    it('should return OPTIMAL for sleep performance >= 85%', () => {
      expect(getSleepPerformanceLevel(85)).toBe('OPTIMAL');
      expect(getSleepPerformanceLevel(100)).toBe('OPTIMAL');
    });

    it('should return SUFFICIENT for sleep performance 70-84%', () => {
      expect(getSleepPerformanceLevel(70)).toBe('SUFFICIENT');
      expect(getSleepPerformanceLevel(75)).toBe('SUFFICIENT');
      expect(getSleepPerformanceLevel(84)).toBe('SUFFICIENT');
    });

    it('should return POOR for sleep performance < 70%', () => {
      expect(getSleepPerformanceLevel(69)).toBe('POOR');
      expect(getSleepPerformanceLevel(45)).toBe('POOR');
      expect(getSleepPerformanceLevel(0)).toBe('POOR');
    });
  });

  describe('getSleepPerformanceLevelDescription', () => {
    it('should return Whoop official descriptions', () => {
      expect(getSleepPerformanceLevelDescription('OPTIMAL')).toBe('Got enough sleep to fully recover');
      expect(getSleepPerformanceLevelDescription('SUFFICIENT')).toBe('Got adequate sleep for basic recovery');
      expect(getSleepPerformanceLevelDescription('POOR')).toBe('Did not get enough sleep, recovery impacted');
    });
  });

  describe('getStrainLevel', () => {
    it('should return LIGHT for strain 0-9', () => {
      expect(getStrainLevel(0)).toBe('LIGHT');
      expect(getStrainLevel(5.5)).toBe('LIGHT');
      expect(getStrainLevel(9)).toBe('LIGHT');
      expect(getStrainLevel(9.9)).toBe('LIGHT');
    });

    it('should return MODERATE for strain 10-13', () => {
      expect(getStrainLevel(10)).toBe('MODERATE');
      expect(getStrainLevel(12)).toBe('MODERATE');
      expect(getStrainLevel(13)).toBe('MODERATE');
      expect(getStrainLevel(13.9)).toBe('MODERATE');
    });

    it('should return HIGH for strain 14-17', () => {
      expect(getStrainLevel(14)).toBe('HIGH');
      expect(getStrainLevel(16)).toBe('HIGH');
      expect(getStrainLevel(17)).toBe('HIGH');
      expect(getStrainLevel(17.9)).toBe('HIGH');
    });

    it('should return ALL_OUT for strain >= 18', () => {
      expect(getStrainLevel(18)).toBe('ALL_OUT');
      expect(getStrainLevel(19.5)).toBe('ALL_OUT');
      expect(getStrainLevel(21)).toBe('ALL_OUT');
    });
  });

  describe('getStrainLevelDescription', () => {
    it('should return Whoop official descriptions', () => {
      expect(getStrainLevelDescription('LIGHT')).toBe('Minimal exertion, encourages active recovery');
      expect(getStrainLevelDescription('MODERATE')).toBe('Balances fitness gains and recovery');
      expect(getStrainLevelDescription('HIGH')).toBe('Builds fitness, harder to recover next day');
      expect(getStrainLevelDescription('ALL_OUT')).toBe('Significant exertion, risk for injury/overtraining');
    });
  });
});
