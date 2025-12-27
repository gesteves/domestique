import { describe, it, expect } from 'vitest';
import { parseTemperatureStreams, calculateTemperatureMetrics } from '../../src/utils/temperature-metrics.js';

describe('temperature-metrics', () => {
  describe('parseTemperatureStreams', () => {
    it('should parse valid stream data', () => {
      const streams = [
        {
          type: 'time',
          data: [0, 1, 2, 3, 4],
        },
        {
          type: 'temp',
          data: [18.5, 19.0, 19.5, 20.0, 20.5],
        },
      ];

      const result = parseTemperatureStreams(streams);

      expect(result).not.toBeNull();
      expect(result?.time).toEqual([0, 1, 2, 3, 4]);
      expect(result?.temp).toEqual([18.5, 19.0, 19.5, 20.0, 20.5]);
    });

    it('should return null if time stream is missing', () => {
      const streams = [
        {
          type: 'temp',
          data: [18.5, 19.0, 19.5],
        },
      ];

      const result = parseTemperatureStreams(streams);

      expect(result).toBeNull();
    });

    it('should return null if temp stream is missing', () => {
      const streams = [
        {
          type: 'time',
          data: [0, 1, 2, 3],
        },
      ];

      const result = parseTemperatureStreams(streams);

      expect(result).toBeNull();
    });

    it('should return null if both streams are missing', () => {
      const streams = [
        {
          type: 'power',
          data: [100, 200, 300],
        },
      ];

      const result = parseTemperatureStreams(streams);

      expect(result).toBeNull();
    });

    it('should handle empty streams array', () => {
      const streams: { type: string; data: number[] }[] = [];

      const result = parseTemperatureStreams(streams);

      expect(result).toBeNull();
    });

    it('should handle streams with additional fields', () => {
      const streams = [
        {
          type: 'time',
          data: [0, 1],
          name: null,
          valueType: 'java.lang.Integer',
        },
        {
          type: 'temp',
          data: [18.5, 19.5],
          name: null,
          valueType: 'java.lang.Float',
        },
      ];

      const result = parseTemperatureStreams(streams);

      expect(result).not.toBeNull();
      expect(result?.time).toEqual([0, 1]);
      expect(result?.temp).toEqual([18.5, 19.5]);
    });
  });

  describe('calculateTemperatureMetrics', () => {
    it('should calculate all temperature metrics correctly', () => {
      const timeData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const tempData = [18.5, 19.0, 19.5, 20.0, 20.5, 21.0, 21.5, 22.0, 22.5, 23.0];

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(18.5);
      expect(metrics.max_ambient_temperature).toBe(23.0);
      expect(metrics.start_ambient_temperature).toBe(18.5);
      expect(metrics.end_ambient_temperature).toBe(23.0);

      // Average should be sum / count, then rounded to 1 decimal
      // (18.5 + 19.0 + 19.5 + 20.0 + 20.5 + 21.0 + 21.5 + 22.0 + 22.5 + 23.0) / 10 = 207.5 / 10 = 20.75
      // Rounded to 1 decimal: Math.round(20.75 * 10) / 10 = 20.8
      expect(metrics.avg_ambient_temperature).toBe(20.8);
    });

    it('should handle single value correctly', () => {
      const timeData = [0];
      const tempData = [20.5];

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(20.5);
      expect(metrics.max_ambient_temperature).toBe(20.5);
      expect(metrics.avg_ambient_temperature).toBe(20.5);
      expect(metrics.start_ambient_temperature).toBe(20.5);
      expect(metrics.end_ambient_temperature).toBe(20.5);
    });

    it('should round values to 1 decimal place', () => {
      const timeData = [0, 1, 2];
      const tempData = [18.456, 19.789, 20.123];

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      // Check that values are rounded to 1 decimal
      expect(metrics.min_ambient_temperature.toString()).toMatch(/^\d+\.\d$/);
      expect(metrics.max_ambient_temperature.toString()).toMatch(/^\d+\.\d$/);
      expect(metrics.avg_ambient_temperature.toString()).toMatch(/^\d+\.\d$/);
      expect(metrics.start_ambient_temperature.toString()).toMatch(/^\d+\.\d$/);
      expect(metrics.end_ambient_temperature.toString()).toMatch(/^\d+\.\d$/);
    });

    it('should handle empty arrays', () => {
      const timeData: number[] = [];
      const tempData: number[] = [];

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(0);
      expect(metrics.max_ambient_temperature).toBe(0);
      expect(metrics.avg_ambient_temperature).toBe(0);
      expect(metrics.start_ambient_temperature).toBe(0);
      expect(metrics.end_ambient_temperature).toBe(0);
    });

    it('should handle negative temperatures', () => {
      const timeData = [0, 1, 2, 3, 4];
      const tempData = [-2.5, -1.0, 0.0, 1.5, 3.0];

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(-2.5);
      expect(metrics.max_ambient_temperature).toBe(3.0);
      expect(metrics.start_ambient_temperature).toBe(-2.5);
      expect(metrics.end_ambient_temperature).toBe(3.0);

      const expectedAvg = (-2.5 + -1.0 + 0.0 + 1.5 + 3.0) / 5;
      expect(metrics.avg_ambient_temperature).toBeCloseTo(expectedAvg, 1);
    });

    it('should handle mixed positive and negative temperatures', () => {
      const timeData = [0, 1, 2];
      const tempData = [5.0, -3.0, 2.0];

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(-3.0);
      expect(metrics.max_ambient_temperature).toBe(5.0);
      expect(metrics.start_ambient_temperature).toBe(5.0);
      expect(metrics.end_ambient_temperature).toBe(2.0);

      const expectedAvg = (5.0 + -3.0 + 2.0) / 3;
      expect(metrics.avg_ambient_temperature).toBeCloseTo(expectedAvg, 1);
    });

    it('should throw error when arrays have different lengths', () => {
      const timeData = [0, 1, 2];
      const tempData = [18.5, 19.0]; // Mismatched length

      expect(() => calculateTemperatureMetrics(timeData, tempData)).toThrow(
        'Time and temperature data arrays must have the same length'
      );
    });

    it('should handle water temperature for swimming (cold water)', () => {
      const timeData = [0, 1, 2, 3, 4];
      const tempData = [14.0, 14.5, 15.0, 15.5, 16.0]; // Cold water temp

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(14.0);
      expect(metrics.max_ambient_temperature).toBe(16.0);
      expect(metrics.start_ambient_temperature).toBe(14.0);
      expect(metrics.end_ambient_temperature).toBe(16.0);
    });

    it('should handle hot weather temperatures', () => {
      const timeData = [0, 1, 2, 3, 4];
      const tempData = [32.0, 33.5, 35.0, 36.5, 38.0]; // Hot weather

      const metrics = calculateTemperatureMetrics(timeData, tempData);

      expect(metrics.min_ambient_temperature).toBe(32.0);
      expect(metrics.max_ambient_temperature).toBe(38.0);
      expect(metrics.start_ambient_temperature).toBe(32.0);
      expect(metrics.end_ambient_temperature).toBe(38.0);
    });
  });
});
