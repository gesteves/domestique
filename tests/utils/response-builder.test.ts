import { describe, it, expect } from 'vitest';
import { buildToolResponse, buildEmptyResponse } from '../../src/utils/response-builder.js';

describe('response-builder', () => {
  describe('buildToolResponse', () => {
    it('should build response with structuredContent containing data and field descriptions', async () => {
      const data = { metric: 42, name: 'test' };
      const fieldDescriptions = {
        metric: 'A numeric value',
        name: 'A string identifier',
      };

      const result = await buildToolResponse({
        data,
        fieldDescriptions,
      });

      // Should have content array for backwards compatibility
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      // Text content should be serialized JSON
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.response.metric).toBe(42);
      expect(parsed.response.name).toBe('test');
      expect(parsed.field_descriptions.metric).toBe('A numeric value');

      // Should have structuredContent
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.response).toEqual({ metric: 42, name: 'test' });
      expect(result.structuredContent.field_descriptions).toEqual({
        metric: 'A numeric value',
        name: 'A string identifier',
      });
    });

    it('should format complex nested data', async () => {
      const data = {
        workouts: [
          { id: '1', tss: 50 },
          { id: '2', tss: 75 },
        ],
        summary: {
          total_tss: 125,
          count: 2,
        },
      };
      const fieldDescriptions = {
        workouts: 'Array of workout objects',
        summary: 'Summary statistics',
        id: 'Workout ID',
        tss: 'Training stress score',
        total_tss: 'Total TSS',
        count: 'Count of workouts',
      };

      const result = await buildToolResponse({
        data,
        fieldDescriptions,
      });

      // Verify structuredContent has the nested data
      expect(result.structuredContent.response).toEqual(data);

      // Field descriptions should include nested fields
      expect(result.structuredContent.field_descriptions.workouts).toBe('Array of workout objects');
      expect(result.structuredContent.field_descriptions.tss).toBe('Training stress score');
    });

    it('should remove null and undefined from data', async () => {
      const data = {
        value: null,
        optional: undefined,
        present: 'yes',
      };
      const fieldDescriptions = { value: 'Nullable value', present: 'Present field' };

      const result = await buildToolResponse({
        data,
        fieldDescriptions,
      });

      // Null and undefined fields should be removed to save tokens
      expect(result.structuredContent.response).toEqual({ present: 'yes' });

      // Field descriptions should only include fields present in data
      expect(result.structuredContent.field_descriptions).toEqual({ present: 'Present field' });
    });

    it('should include heat zones summary only when heat data is present', async () => {
      // Data WITH heat zones
      const dataWithHeat = {
        workouts: [
          {
            id: 'w1',
            heat_zones: [
              { name: 'Zone 1', time_in_zone: '0:10:00' },
            ],
          },
        ],
      };
      const fieldDescriptions = {
        workouts: 'Array of workouts',
        heat_zones: 'Heat zone data',
        id: 'Workout ID',
        name: 'Zone name',
        time_in_zone: 'Time in zone',
      };

      const resultWithHeat = await buildToolResponse({
        data: dataWithHeat,
        fieldDescriptions,
      });

      // Heat zones summary should be added to field descriptions
      expect(resultWithHeat.structuredContent.field_descriptions.heat_zones).toContain('Heat Zones Summary');
      expect(resultWithHeat.structuredContent.field_descriptions.heat_zones).toContain('Zone 1: No Heat Strain');

      // Data WITHOUT heat zones
      const dataWithoutHeat = {
        workouts: [
          {
            id: 'w1',
            tss: 50,
          },
        ],
      };

      const resultWithoutHeat = await buildToolResponse({
        data: dataWithoutHeat,
        fieldDescriptions,
      });

      // Field description should be filtered out when field is not present
      expect(resultWithoutHeat.structuredContent.field_descriptions.heat_zones).toBeUndefined();
    });

    it('should return text content as formatted JSON for backwards compatibility', async () => {
      const data = { value: 123 };
      const fieldDescriptions = { value: 'A value' };

      const result = await buildToolResponse({
        data,
        fieldDescriptions,
      });

      // Text should be valid JSON with 2-space indentation
      const text = result.content[0].text;
      expect(text).toContain('{\n  "response"');

      // Should be parseable
      const parsed = JSON.parse(text);
      expect(parsed.response.value).toBe(123);
    });

    it('should not include _debug in production mode', async () => {
      // In test environment, NODE_ENV is 'test', not 'development',
      // so _debug should not be included
      const data = { value: 123 };
      const fieldDescriptions = { value: 'A value' };

      const result = await buildToolResponse({
        data,
        fieldDescriptions,
      });

      // _debug should not be present when NODE_ENV is not 'development'
      expect(result.structuredContent._debug).toBeUndefined();
    });
  });

  describe('buildEmptyResponse', () => {
    it('should build empty response with structuredContent', () => {
      const result = buildEmptyResponse('workouts');

      // Should have content array
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      // Should have structuredContent with message
      expect(result.structuredContent.response).toEqual({ message: 'No workouts found.' });
      expect(result.structuredContent.field_descriptions).toEqual({});
    });

    it('should handle various resource types', () => {
      expect(buildEmptyResponse('recovery data').structuredContent.response.message).toBe('No recovery data found.');
      expect(buildEmptyResponse('planned workouts').structuredContent.response.message).toBe('No planned workouts found.');
      expect(buildEmptyResponse('intervals').structuredContent.response.message).toBe('No intervals found.');
    });

    it('should return text content as formatted JSON', () => {
      const result = buildEmptyResponse('activities');

      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.response.message).toBe('No activities found.');
    });
  });
});
