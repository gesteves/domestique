import { describe, it, expect } from 'vitest';
import { calculateHeatZones, calculateHeatMetrics, parseHeatStrainStreams } from '../../src/utils/heat-zones.js';

describe('heat-zones', () => {
  describe('calculateHeatZones', () => {
    it('should calculate time in each heat zone correctly', () => {
      // Mock stream data: 10 seconds total
      const timeData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const heatStrainData = [
        0.5, // Zone 1: No Heat Strain (0-<1)
        0.8, // Zone 1
        1.5, // Zone 2: Moderate Heat Strain (1-<3)
        2.0, // Zone 2
        3.5, // Zone 3: High Heat Strain (3-<7)
        5.0, // Zone 3
        6.0, // Zone 3
        7.5, // Zone 4: Extremely High Heat Strain (>=7)
        8.0, // Zone 4
        9.0, // Zone 4
      ];

      const zones = calculateHeatZones(timeData, heatStrainData);

      expect(zones).toHaveLength(4);

      // Zone 1: 2 seconds (0.5, 0.8)
      expect(zones[0].name).toBe('Zone 1: No Heat Strain');
      expect(zones[0].low_heat_strain_index).toBe(0);
      expect(zones[0].high_heat_strain_index).toBe(1);
      expect(zones[0].time_in_zone).toBe('0:00:02');

      // Zone 2: 2 seconds (1.5, 2.0)
      expect(zones[1].name).toBe('Zone 2: Moderate Heat Strain');
      expect(zones[1].low_heat_strain_index).toBe(1);
      expect(zones[1].high_heat_strain_index).toBe(3);
      expect(zones[1].time_in_zone).toBe('0:00:02');

      // Zone 3: 3 seconds (3.5, 5.0, 6.0)
      expect(zones[2].name).toBe('Zone 3: High Heat Strain');
      expect(zones[2].low_heat_strain_index).toBe(3);
      expect(zones[2].high_heat_strain_index).toBe(7);
      expect(zones[2].time_in_zone).toBe('0:00:03');

      // Zone 4: 3 seconds (7.5, 8.0, 9.0)
      expect(zones[3].name).toBe('Zone 4: Extremely High Heat Strain');
      expect(zones[3].low_heat_strain_index).toBe(7);
      expect(zones[3].high_heat_strain_index).toBe(null);
      expect(zones[3].time_in_zone).toBe('0:00:03');
    });

    it('should handle all data points in a single zone', () => {
      const timeData = [0, 1, 2, 3, 4];
      const heatStrainData = [0.5, 0.6, 0.7, 0.8, 0.9]; // All in Zone 1

      const zones = calculateHeatZones(timeData, heatStrainData);

      expect(zones[0].time_in_zone).toBe('0:00:05');
      expect(zones[1].time_in_zone).toBe('0:00:00');
      expect(zones[2].time_in_zone).toBe('0:00:00');
      expect(zones[3].time_in_zone).toBe('0:00:00');
    });

    it('should handle boundary values correctly', () => {
      const timeData = [0, 1, 2, 3];
      const heatStrainData = [
        0.9,  // Zone 1 (0-<1)
        1.0,  // Zone 2 (1-<3)
        2.9,  // Zone 2
        3.0,  // Zone 3 (3-<7)
      ];

      const zones = calculateHeatZones(timeData, heatStrainData);

      expect(zones[0].time_in_zone).toBe('0:00:01'); // 0.9
      expect(zones[1].time_in_zone).toBe('0:00:02'); // 1.0, 2.9
      expect(zones[2].time_in_zone).toBe('0:00:01'); // 3.0
      expect(zones[3].time_in_zone).toBe('0:00:00');
    });

    it('should handle non-uniform time intervals', () => {
      const timeData = [0, 2, 5, 10]; // Different time intervals
      const heatStrainData = [0.5, 1.5, 4.0, 8.0];

      const zones = calculateHeatZones(timeData, heatStrainData);

      // Zone 1: 0-2s (2 seconds)
      expect(zones[0].time_in_zone).toBe('0:00:02');
      // Zone 2: 2-5s (3 seconds)
      expect(zones[1].time_in_zone).toBe('0:00:03');
      // Zone 3: 5-10s (5 seconds)
      expect(zones[2].time_in_zone).toBe('0:00:05');
      // Zone 4: 10s+ (last point defaults to 1 second)
      expect(zones[3].time_in_zone).toBe('0:00:01');
    });

    it('should throw error when arrays have different lengths', () => {
      const timeData = [0, 1, 2];
      const heatStrainData = [0.5, 1.5]; // Mismatched length

      expect(() => calculateHeatZones(timeData, heatStrainData)).toThrow(
        'Time and heat strain data arrays must have the same length'
      );
    });

    it('should handle empty arrays', () => {
      const timeData: number[] = [];
      const heatStrainData: number[] = [];

      const zones = calculateHeatZones(timeData, heatStrainData);

      expect(zones).toHaveLength(4);
      expect(zones[0].time_in_zone).toBe('0:00:00');
      expect(zones[1].time_in_zone).toBe('0:00:00');
      expect(zones[2].time_in_zone).toBe('0:00:00');
      expect(zones[3].time_in_zone).toBe('0:00:00');
    });
  });

  describe('parseHeatStrainStreams', () => {
    it('should parse valid stream data', () => {
      const streams = [
        {
          type: 'time',
          data: [0, 1, 2, 3, 4],
        },
        {
          type: 'heat_strain_index',
          data: [0.5, 1.5, 2.5, 3.5, 4.5],
        },
      ];

      const result = parseHeatStrainStreams(streams);

      expect(result).not.toBeNull();
      expect(result?.time).toEqual([0, 1, 2, 3, 4]);
      expect(result?.heat_strain_index).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
    });

    it('should return null if time stream is missing', () => {
      const streams = [
        {
          type: 'heat_strain_index',
          data: [0.5, 1.5, 2.5],
        },
      ];

      const result = parseHeatStrainStreams(streams);

      expect(result).toBeNull();
    });

    it('should return null if heat_strain_index stream is missing', () => {
      const streams = [
        {
          type: 'time',
          data: [0, 1, 2, 3],
        },
      ];

      const result = parseHeatStrainStreams(streams);

      expect(result).toBeNull();
    });

    it('should return null if both streams are missing', () => {
      const streams = [
        {
          type: 'power',
          data: [100, 200, 300],
        },
      ];

      const result = parseHeatStrainStreams(streams);

      expect(result).toBeNull();
    });

    it('should handle empty streams array', () => {
      const streams: { type: string; data: number[] }[] = [];

      const result = parseHeatStrainStreams(streams);

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
          type: 'heat_strain_index',
          data: [0.5, 1.5],
          name: null,
          valueType: 'java.lang.Float',
        },
      ];

      const result = parseHeatStrainStreams(streams);

      expect(result).not.toBeNull();
      expect(result?.time).toEqual([0, 1]);
      expect(result?.heat_strain_index).toEqual([0.5, 1.5]);
    });
  });

  describe('calculateHeatMetrics', () => {
    it('should calculate all heat metrics correctly', () => {
      const timeData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const heatStrainData = [0.5, 0.8, 1.5, 2.0, 3.5, 5.0, 6.0, 7.5, 8.0, 9.0];

      const metrics = calculateHeatMetrics(timeData, heatStrainData);

      // Check zones
      expect(metrics.zones).toHaveLength(4);
      expect(metrics.zones[0].time_in_zone).toBe('0:00:02'); // Zone 1
      expect(metrics.zones[1].time_in_zone).toBe('0:00:02'); // Zone 2
      expect(metrics.zones[2].time_in_zone).toBe('0:00:03'); // Zone 3
      expect(metrics.zones[3].time_in_zone).toBe('0:00:03'); // Zone 4

      // Check max HSI
      expect(metrics.max_heat_strain_index).toBe(9.0);

      // Check median HSI
      // Data: [0.5, 0.8, 1.5, 2.0, 3.5, 5.0, 6.0, 7.5, 8.0, 9.0] (sorted)
      // Even number (10), so median = (3.5 + 5.0) / 2 = 4.25
      // Rounded to 1 decimal: Math.round(4.25 * 10) / 10 = 4.3
      expect(metrics.median_heat_strain_index).toBe(4.3);
    });

    it('should handle empty data', () => {
      const timeData: number[] = [];
      const heatStrainData: number[] = [];

      const metrics = calculateHeatMetrics(timeData, heatStrainData);

      expect(metrics.max_heat_strain_index).toBe(0);
      expect(metrics.median_heat_strain_index).toBe(0);
      expect(metrics.zones).toHaveLength(4);
    });

    it('should round values to 1 decimal place', () => {
      const timeData = [0, 1, 2];
      const heatStrainData = [3.456, 5.789, 6.123];

      const metrics = calculateHeatMetrics(timeData, heatStrainData);

      // Check that values are rounded to 1 decimal
      expect(metrics.max_heat_strain_index.toString()).toMatch(/^\d+\.\d$/);
      expect(metrics.median_heat_strain_index.toString()).toMatch(/^\d+\.\d$/);
    });
  });
});
