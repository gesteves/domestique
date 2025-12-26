import { describe, it, expect } from 'vitest';
import { buildToolResponse, buildEmptyResponse } from '../../src/utils/response-builder.js';

describe('response-builder', () => {
  describe('buildToolResponse', () => {
    it('should build response with data and field descriptions', () => {
      const data = { metric: 42, name: 'test' };
      const fieldDescriptions = {
        metric: 'A numeric value',
        name: 'A string identifier',
      };

      const result = buildToolResponse({
        data,
        fieldDescriptions,
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const text = result.content[0].text;
      expect(text).toContain('"metric": 42');
      expect(text).toContain('"name": "test"');
      expect(text).toContain('FIELD DESCRIPTIONS:');
      expect(text).toContain('"metric": "A numeric value"');
    });

    it('should include warnings when provided', () => {
      const data = { value: 100 };
      const fieldDescriptions = { value: 'A value' };
      const warnings = ['Data may be incomplete', 'Timezone not configured'];

      const result = buildToolResponse({
        data,
        fieldDescriptions,
        warnings,
      });

      const text = result.content[0].text;
      expect(text).toContain('NOTES:');
      expect(text).toContain('- Data may be incomplete');
      expect(text).toContain('- Timezone not configured');
    });

    it('should include next actions when provided', () => {
      const data = { id: 'workout-123' };
      const fieldDescriptions = { id: 'Workout identifier' };
      const nextActions = [
        'Use get_workout_intervals(id) for detailed breakdown',
        'Use get_workout_notes(id) for athlete comments',
      ];

      const result = buildToolResponse({
        data,
        fieldDescriptions,
        nextActions,
      });

      const text = result.content[0].text;
      expect(text).toContain('SUGGESTED NEXT ACTIONS:');
      expect(text).toContain('- Use get_workout_intervals(id) for detailed breakdown');
      expect(text).toContain('- Use get_workout_notes(id) for athlete comments');
    });

    it('should handle empty warnings array', () => {
      const data = { test: true };
      const fieldDescriptions = { test: 'A boolean' };

      const result = buildToolResponse({
        data,
        fieldDescriptions,
        warnings: [],
      });

      const text = result.content[0].text;
      expect(text).not.toContain('NOTES:');
    });

    it('should handle empty next actions array', () => {
      const data = { test: true };
      const fieldDescriptions = { test: 'A boolean' };

      const result = buildToolResponse({
        data,
        fieldDescriptions,
        nextActions: [],
      });

      const text = result.content[0].text;
      expect(text).not.toContain('SUGGESTED NEXT ACTIONS:');
    });

    it('should format complex nested data', () => {
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
      };

      const result = buildToolResponse({
        data,
        fieldDescriptions,
      });

      const text = result.content[0].text;
      // JSON should be pretty-printed
      expect(text).toContain('"workouts": [');
      expect(text).toContain('"total_tss": 125');
    });

    it('should handle null and undefined in data', () => {
      const data = {
        value: null,
        optional: undefined,
        present: 'yes',
      };
      const fieldDescriptions = { value: 'Nullable value' };

      const result = buildToolResponse({
        data,
        fieldDescriptions,
      });

      const text = result.content[0].text;
      expect(text).toContain('"value": null');
      expect(text).toContain('"present": "yes"');
    });

    it('should handle both warnings and next actions together', () => {
      const data = { recovery_score: 45 };
      const fieldDescriptions = { recovery_score: 'Recovery percentage (0-100)' };
      const warnings = ['Low recovery detected'];
      const nextActions = ['Consider reducing training load'];

      const result = buildToolResponse({
        data,
        fieldDescriptions,
        warnings,
        nextActions,
      });

      const text = result.content[0].text;
      expect(text).toContain('NOTES:');
      expect(text).toContain('- Low recovery detected');
      expect(text).toContain('SUGGESTED NEXT ACTIONS:');
      expect(text).toContain('- Consider reducing training load');
      expect(text).toContain('FIELD DESCRIPTIONS:');
    });
  });

  describe('buildEmptyResponse', () => {
    it('should build empty response with resource type', () => {
      const result = buildEmptyResponse('workouts');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('No workouts found.');
    });

    it('should include suggestion when provided', () => {
      const result = buildEmptyResponse(
        'activities',
        'Try expanding the date range or removing sport filters.'
      );

      const text = result.content[0].text;
      expect(text).toContain('No activities found.');
      expect(text).toContain('Suggestion: Try expanding the date range or removing sport filters.');
    });

    it('should handle various resource types', () => {
      expect(buildEmptyResponse('recovery data').content[0].text).toBe('No recovery data found.');
      expect(buildEmptyResponse('planned workouts').content[0].text).toBe('No planned workouts found.');
      expect(buildEmptyResponse('intervals').content[0].text).toBe('No intervals found.');
    });
  });
});

