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
    it('should return Sufficient for recovery >= 67%', () => {
      expect(getRecoveryLevel(67)).toBe('Sufficient');
      expect(getRecoveryLevel(95)).toBe('Sufficient');
      expect(getRecoveryLevel(100)).toBe('Sufficient');
    });

    it('should return Adequate for recovery 34-66%', () => {
      expect(getRecoveryLevel(34)).toBe('Adequate');
      expect(getRecoveryLevel(50)).toBe('Adequate');
      expect(getRecoveryLevel(66)).toBe('Adequate');
    });

    it('should return Low for recovery < 34%', () => {
      expect(getRecoveryLevel(33)).toBe('Low');
      expect(getRecoveryLevel(10)).toBe('Low');
      expect(getRecoveryLevel(0)).toBe('Low');
    });
  });

  describe('getRecoveryLevelDescription', () => {
    it('should return Whoop official descriptions', () => {
      expect(getRecoveryLevelDescription('Sufficient')).toBe('Your body is well recovered and ready to perform. Whether it\'s at work or the gym, your body is signaling it can handle a strenuous day.');
      expect(getRecoveryLevelDescription('Adequate')).toBe('Your body is maintaining health. You may not need rest and can still handle a moderately strenuous day.');
      expect(getRecoveryLevelDescription('Low')).toBe('Your body is working hard to recover. Your body is signaling it needs an active rest day.');
    });
  });

  describe('getSleepPerformanceLevel', () => {
    it('should return Optimal for sleep performance >= 85%', () => {
      expect(getSleepPerformanceLevel(85)).toBe('Optimal');
      expect(getSleepPerformanceLevel(100)).toBe('Optimal');
    });

    it('should return Sufficient for sleep performance 70-84%', () => {
      expect(getSleepPerformanceLevel(70)).toBe('Sufficient');
      expect(getSleepPerformanceLevel(75)).toBe('Sufficient');
      expect(getSleepPerformanceLevel(84)).toBe('Sufficient');
    });

    it('should return Poor for sleep performance < 70%', () => {
      expect(getSleepPerformanceLevel(69)).toBe('Poor');
      expect(getSleepPerformanceLevel(45)).toBe('Poor');
      expect(getSleepPerformanceLevel(0)).toBe('Poor');
    });
  });

  describe('getSleepPerformanceLevelDescription', () => {
    it('should return Whoop official descriptions', () => {
      expect(getSleepPerformanceLevelDescription('Optimal')).toBe('You\'re getting most or all of your Sleep Need with consistent timing, high efficiency, and low sleep stress that best support recovery and long-term health.');
      expect(getSleepPerformanceLevelDescription('Sufficient')).toBe('Your sleep is generally workable for day-to-day functioning but not fully optimized for recovery or long-term health.');
      expect(getSleepPerformanceLevelDescription('Poor')).toBe('You\'re meaningfully under-sleeping or your timing/quality is disrupted enough that it\'s likely to undermine your recovery and next-day performance.');
    });
  });

  describe('getStrainLevel', () => {
    it('should return Light for strain 0-9', () => {
      expect(getStrainLevel(0)).toBe('Light');
      expect(getStrainLevel(5.5)).toBe('Light');
      expect(getStrainLevel(9)).toBe('Light');
      expect(getStrainLevel(9.9)).toBe('Light');
    });

    it('should return Moderate for strain 10-13', () => {
      expect(getStrainLevel(10)).toBe('Moderate');
      expect(getStrainLevel(12)).toBe('Moderate');
      expect(getStrainLevel(13)).toBe('Moderate');
      expect(getStrainLevel(13.9)).toBe('Moderate');
    });

    it('should return High for strain 14-17', () => {
      expect(getStrainLevel(14)).toBe('High');
      expect(getStrainLevel(16)).toBe('High');
      expect(getStrainLevel(17)).toBe('High');
      expect(getStrainLevel(17.9)).toBe('High');
    });

    it('should return All out for strain >= 18', () => {
      expect(getStrainLevel(18)).toBe('All out');
      expect(getStrainLevel(19.5)).toBe('All out');
      expect(getStrainLevel(21)).toBe('All out');
    });
  });

  describe('getStrainLevelDescription', () => {
    it('should return Whoop official descriptions', () => {
      expect(getStrainLevelDescription('Light')).toBe('Minimal exertion is being put on the body, which encourages active recovery.');
      expect(getStrainLevelDescription('Moderate')).toBe('Moderate exertion is being put on the body, which balances fitness gains and recovery.');
      expect(getStrainLevelDescription('High')).toBe('Increased exertion which builds fitness gains, but makes it more difficult for your body to recover the next day.');
      expect(getStrainLevelDescription('All out')).toBe('Significant exertion which increases fitness gains, but puts your body at greater risk for injury or overtraining.');
    });
  });
});
