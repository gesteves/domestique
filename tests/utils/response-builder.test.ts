import { describe, it, expect } from 'vitest';
import { buildToolResponse, buildEmptyResponse } from '../../src/utils/response-builder.js';

describe('response-builder', () => {
  describe('buildToolResponse', () => {
    it('returns structuredContent equal to the cleaned data payload', async () => {
      const data = { metric: 42, name: 'test' };

      const result = await buildToolResponse({ data });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(data);
      expect(result.structuredContent).toEqual(data);
    });

    it('preserves nested data verbatim', async () => {
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

      const result = await buildToolResponse({ data });

      expect(result.structuredContent).toEqual(data);
    });

    it('strips null and undefined values from data to save tokens', async () => {
      const data = {
        value: null,
        optional: undefined,
        present: 'yes',
      };

      const result = await buildToolResponse({ data });

      expect(result.structuredContent).toEqual({ present: 'yes' });
    });

    it('serializes structuredContent into the content text block (formatted JSON)', async () => {
      const data = { value: 123 };

      const result = await buildToolResponse({ data });

      expect(result.content[0].text).toContain('"value": 123');
      expect(JSON.parse(result.content[0].text)).toEqual(data);
    });

    it('prepends hints to the content narration when provided', async () => {
      const data = { value: 123 };
      const hints = ['Try X next', 'Or Y'];

      const result = await buildToolResponse({ data, hints });

      const text = result.content[0].text;
      expect(text).toContain('- Try X next');
      expect(text).toContain('- Or Y');
      // JSON should still be present after the hints
      expect(text).toContain('"value": 123');
      // Hints should NOT pollute structuredContent
      expect(result.structuredContent).toEqual(data);
    });

    it('does not include _debug in production mode', async () => {
      // NODE_ENV is 'test' in vitest, so token counting is disabled
      const data = { value: 123 };

      const result = await buildToolResponse({ data });

      expect(result._meta).toBeUndefined();
    });

    it('routes widgetMeta into _meta (out-of-band, not visible to the model)', async () => {
      const data = { value: 123 };
      const widgetMeta = {
        largeData: { items: [1, 2, 3, 4, 5] },
        sensitiveInfo: 'widget-only',
      };

      const result = await buildToolResponse({ data, widgetMeta });

      expect(result._meta).toEqual(widgetMeta);
      // Widget data must not leak into structuredContent
      expect(result.structuredContent).toEqual(data);
    });

    it('omits _meta entirely when there is no widget metadata or debug info', async () => {
      const data = { value: 123 };

      const result = await buildToolResponse({ data });

      expect(result._meta).toBeUndefined();
    });
  });

  describe('buildEmptyResponse', () => {
    it('returns a structured "no results" payload', () => {
      const result = buildEmptyResponse('workouts');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('No workouts found.');
      expect(result.structuredContent).toEqual({ message: 'No workouts found.' });
    });

    it('handles various resource types', () => {
      expect(buildEmptyResponse('recovery data').structuredContent).toEqual({
        message: 'No recovery data found.',
      });
      expect(buildEmptyResponse('planned workouts').structuredContent).toEqual({
        message: 'No planned workouts found.',
      });
    });

    it('uses custom narration when provided (without changing the structured payload)', () => {
      const result = buildEmptyResponse('activities', 'No activities were found for this date range.');

      expect(result.content[0].text).toBe('No activities were found for this date range.');
      expect(result.structuredContent).toEqual({ message: 'No activities found.' });
    });

    it('falls back to default narration when not provided', () => {
      const result = buildEmptyResponse('workouts');

      expect(result.content[0].text).toBe('No workouts found.');
    });
  });
});
