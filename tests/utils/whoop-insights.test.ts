import { describe, it, expect } from 'vitest';
import {
  computeRecoveryInsights,
  computeStrainInsights,
} from '../../src/utils/whoop-insights.js';
import type { RecoveryData, StrainData } from '../../src/types/index.js';

describe('whoop-insights', () => {
  describe('computeRecoveryInsights', () => {
    const baseRecovery: RecoveryData = {
      date: '2024-12-15',
      recovery_score: 72,
      hrv_rmssd: 45,
      resting_heart_rate: 52,
      sleep_performance_percentage: 90,
      sleep_duration_hours: 7.5,
    };

    describe('recovery level', () => {
      it('should return SUFFICIENT for recovery >= 67%', () => {
        const recovery = { ...baseRecovery, recovery_score: 67 };
        expect(computeRecoveryInsights(recovery).recovery_level).toBe('SUFFICIENT');

        const highRecovery = { ...baseRecovery, recovery_score: 95 };
        expect(computeRecoveryInsights(highRecovery).recovery_level).toBe('SUFFICIENT');
      });

      it('should return ADEQUATE for recovery 34-66%', () => {
        const recovery = { ...baseRecovery, recovery_score: 34 };
        expect(computeRecoveryInsights(recovery).recovery_level).toBe('ADEQUATE');

        const midRecovery = { ...baseRecovery, recovery_score: 50 };
        expect(computeRecoveryInsights(midRecovery).recovery_level).toBe('ADEQUATE');

        const upperAdequate = { ...baseRecovery, recovery_score: 66 };
        expect(computeRecoveryInsights(upperAdequate).recovery_level).toBe('ADEQUATE');
      });

      it('should return LOW for recovery < 34%', () => {
        const recovery = { ...baseRecovery, recovery_score: 33 };
        expect(computeRecoveryInsights(recovery).recovery_level).toBe('LOW');

        const veryLow = { ...baseRecovery, recovery_score: 10 };
        expect(computeRecoveryInsights(veryLow).recovery_level).toBe('LOW');
      });

      it('should return Whoop official descriptions', () => {
        const sufficient = { ...baseRecovery, recovery_score: 72 };
        expect(computeRecoveryInsights(sufficient).recovery_level_description).toBe('Well recovered, ready to perform');

        const adequate = { ...baseRecovery, recovery_score: 50 };
        expect(computeRecoveryInsights(adequate).recovery_level_description).toBe('Maintaining health, can handle moderate stress');

        const low = { ...baseRecovery, recovery_score: 25 };
        expect(computeRecoveryInsights(low).recovery_level_description).toBe('Working hard to recover, needs rest');
      });
    });

    describe('sleep performance level', () => {
      it('should return OPTIMAL for sleep performance >= 85%', () => {
        const recovery = { ...baseRecovery, sleep_performance_percentage: 85 };
        expect(computeRecoveryInsights(recovery).sleep_performance_level).toBe('OPTIMAL');

        const highSleep = { ...baseRecovery, sleep_performance_percentage: 100 };
        expect(computeRecoveryInsights(highSleep).sleep_performance_level).toBe('OPTIMAL');
      });

      it('should return SUFFICIENT for sleep performance 70-84%', () => {
        const recovery = { ...baseRecovery, sleep_performance_percentage: 70 };
        expect(computeRecoveryInsights(recovery).sleep_performance_level).toBe('SUFFICIENT');

        const midSleep = { ...baseRecovery, sleep_performance_percentage: 75 };
        expect(computeRecoveryInsights(midSleep).sleep_performance_level).toBe('SUFFICIENT');

        const upperSufficient = { ...baseRecovery, sleep_performance_percentage: 84 };
        expect(computeRecoveryInsights(upperSufficient).sleep_performance_level).toBe('SUFFICIENT');
      });

      it('should return POOR for sleep performance < 70%', () => {
        const recovery = { ...baseRecovery, sleep_performance_percentage: 69 };
        expect(computeRecoveryInsights(recovery).sleep_performance_level).toBe('POOR');

        const lowSleep = { ...baseRecovery, sleep_performance_percentage: 45 };
        expect(computeRecoveryInsights(lowSleep).sleep_performance_level).toBe('POOR');
      });

      it('should return Whoop official descriptions for sleep performance', () => {
        const optimal = { ...baseRecovery, sleep_performance_percentage: 90 };
        expect(computeRecoveryInsights(optimal).sleep_performance_level_description).toBe('Got enough sleep to fully recover');

        const sufficient = { ...baseRecovery, sleep_performance_percentage: 75 };
        expect(computeRecoveryInsights(sufficient).sleep_performance_level_description).toBe('Got adequate sleep for basic recovery');

        const poor = { ...baseRecovery, sleep_performance_percentage: 50 };
        expect(computeRecoveryInsights(poor).sleep_performance_level_description).toBe('Did not get enough sleep, recovery impacted');
      });

      it('should format sleep duration as human-readable', () => {
        const recovery = { ...baseRecovery, sleep_duration_hours: 7.5 };
        expect(computeRecoveryInsights(recovery).sleep_duration_human).toBe('7:30:00');

        const shortSleep = { ...baseRecovery, sleep_duration_hours: 5.25 };
        expect(computeRecoveryInsights(shortSleep).sleep_duration_human).toBe('5:15:00');
      });
    });

    it('should include HRV value', () => {
      const recovery = { ...baseRecovery, hrv_rmssd: 55 };
      expect(computeRecoveryInsights(recovery).hrv_rmssd_ms).toBe(55);
    });
  });

  describe('computeStrainInsights', () => {
    const baseStrain: StrainData = {
      date: '2024-12-15',
      strain_score: 12.5,
      average_heart_rate: 95,
      max_heart_rate: 175,
      calories: 2500,
      activities: [],
    };

    describe('strain level', () => {
      it('should return LIGHT for strain 0-9', () => {
        const strain = { ...baseStrain, strain_score: 0 };
        expect(computeStrainInsights(strain).strain_level).toBe('LIGHT');

        const lightStrain = { ...baseStrain, strain_score: 9 };
        expect(computeStrainInsights(lightStrain).strain_level).toBe('LIGHT');

        const midLight = { ...baseStrain, strain_score: 5.5 };
        expect(computeStrainInsights(midLight).strain_level).toBe('LIGHT');
      });

      it('should return MODERATE for strain 10-13', () => {
        const strain = { ...baseStrain, strain_score: 10 };
        expect(computeStrainInsights(strain).strain_level).toBe('MODERATE');

        const modStrain = { ...baseStrain, strain_score: 12 };
        expect(computeStrainInsights(modStrain).strain_level).toBe('MODERATE');

        const upperMod = { ...baseStrain, strain_score: 13 };
        expect(computeStrainInsights(upperMod).strain_level).toBe('MODERATE');
      });

      it('should return HIGH for strain 14-17', () => {
        const strain = { ...baseStrain, strain_score: 14 };
        expect(computeStrainInsights(strain).strain_level).toBe('HIGH');

        const highStrain = { ...baseStrain, strain_score: 16 };
        expect(computeStrainInsights(highStrain).strain_level).toBe('HIGH');

        const upperHigh = { ...baseStrain, strain_score: 17 };
        expect(computeStrainInsights(upperHigh).strain_level).toBe('HIGH');
      });

      it('should return ALL_OUT for strain >= 18', () => {
        const strain = { ...baseStrain, strain_score: 18 };
        expect(computeStrainInsights(strain).strain_level).toBe('ALL_OUT');

        const maxStrain = { ...baseStrain, strain_score: 21 };
        expect(computeStrainInsights(maxStrain).strain_level).toBe('ALL_OUT');

        const midAllOut = { ...baseStrain, strain_score: 19.5 };
        expect(computeStrainInsights(midAllOut).strain_level).toBe('ALL_OUT');
      });

      it('should return Whoop official descriptions for strain levels', () => {
        const lightStrain = { ...baseStrain, strain_score: 5.5 };
        expect(computeStrainInsights(lightStrain).strain_level_description).toBe('Minimal exertion, encourages active recovery');

        const modStrain = { ...baseStrain, strain_score: 12.5 };
        expect(computeStrainInsights(modStrain).strain_level_description).toBe('Balances fitness gains and recovery');

        const highStrain = { ...baseStrain, strain_score: 15.0 };
        expect(computeStrainInsights(highStrain).strain_level_description).toBe('Builds fitness, harder to recover next day');

        const allOutStrain = { ...baseStrain, strain_score: 19.5 };
        expect(computeStrainInsights(allOutStrain).strain_level_description).toBe('Significant exertion, risk for injury/overtraining');
      });
    });
  });
});
