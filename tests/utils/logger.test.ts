import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logApiError, logUnexpectedError, initBugsnag, getBugsnagClient, _setBugsnagClientForTesting } from '../../src/utils/logger.js';
import { IntervalsApiError, TrainerRoadApiError } from '../../src/errors/index.js';

describe('Logger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    _setBugsnagClientForTesting(null);
    vi.restoreAllMocks();
  });

  describe('logApiError', () => {
    it('should log error with source, operation, and message', () => {
      const error = IntervalsApiError.fromHttpStatus(500, {
        operation: 'update activity intervals',
        resource: 'activity i135509974',
      });

      logApiError(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Intervals]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('update activity intervals')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('activity i135509974')
      );
    });

    it('should log HTTP method and URL when provided', () => {
      const error = IntervalsApiError.fromHttpStatus(502, {
        operation: 'update activity',
        resource: 'activity i123',
      });

      logApiError(error, {
        method: 'PUT',
        url: 'https://intervals.icu/api/v1/activity/i123',
        statusCode: 502,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('PUT https://intervals.icu/api/v1/activity/i123')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('status 502')
      );
    });

    it('should log response body when provided', () => {
      const error = IntervalsApiError.fromHttpStatus(500, {
        operation: 'set intervals',
        resource: 'activity i123',
      });

      const responseBody = '{"error": "Internal Server Error", "details": "Something went wrong"}';

      logApiError(error, {
        method: 'PUT',
        url: 'https://intervals.icu/api/v1/activity/i123/intervals',
        statusCode: 500,
        responseBody,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Response body:')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Internal Server Error')
      );
    });

    it('should not log response body line when not provided', () => {
      const error = IntervalsApiError.networkError(
        { operation: 'fetch data' },
        new Error('ECONNREFUSED')
      );

      logApiError(error);

      // Should only have one console.error call (the main message)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should log TrainerRoad errors with correct source prefix', () => {
      const error = TrainerRoadApiError.fromHttpStatus(503, {
        operation: 'fetch planned workouts',
        resource: 'TrainerRoad calendar',
      });

      logApiError(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Trainerroad]')
      );
    });

    it('should include error category in the log', () => {
      const error = IntervalsApiError.fromHttpStatus(404, {
        operation: 'fetch workout details',
        resource: 'activity i999',
      });

      logApiError(error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not_found')
      );
    });
  });

  describe('logUnexpectedError', () => {
    it('should log Error instances with stack trace', () => {
      const error = new Error('Something broke');

      logUnexpectedError(error, 'get_todays_summary');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Tool:get_todays_summary]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Something broke')
      );
      // Stack trace logged separately
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stack:')
      );
    });

    it('should log non-Error values', () => {
      logUnexpectedError('string error', 'test_tool');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('string error')
      );
    });

    it('should work without a tool name', () => {
      logUnexpectedError(new Error('oops'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Error]')
      );
    });
  });

  describe('initBugsnag', () => {
    it('should not initialize without BUGSNAG_API_KEY', () => {
      delete process.env.BUGSNAG_API_KEY;

      const consoleSpy = vi.spyOn(console, 'log');
      initBugsnag();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No BUGSNAG_API_KEY set')
      );
    });
  });

  describe('Bugsnag integration', () => {
    it('should report API errors to Bugsnag with metadata', () => {
      const mockNotify = vi.fn();
      _setBugsnagClientForTesting({ notify: mockNotify });

      const error = IntervalsApiError.fromHttpStatus(500, {
        operation: 'update activity intervals',
        resource: 'activity i135509974',
      }, '{"error": "server error"}');

      logApiError(error, {
        method: 'PUT',
        url: 'https://intervals.icu/api/v1/activity/i135509974/intervals',
        statusCode: 500,
        responseBody: '{"error": "server error"}',
      });

      expect(mockNotify).toHaveBeenCalledWith(
        error,
        expect.any(Function)
      );

      // Verify the callback sets metadata correctly
      const callback = mockNotify.mock.calls[0][1];
      const mockEvent = {
        context: '',
        addMetadata: vi.fn(),
      };
      callback(mockEvent);

      expect(mockEvent.context).toBe('update activity intervals');
      expect(mockEvent.addMetadata).toHaveBeenCalledWith('api', expect.objectContaining({
        source: 'intervals',
        statusCode: 500,
        method: 'PUT',
        responseBody: '{"error": "server error"}',
      }));
    });

    it('should report unexpected errors to Bugsnag with tool context', () => {
      const mockNotify = vi.fn();
      _setBugsnagClientForTesting({ notify: mockNotify });

      logUnexpectedError(new Error('unexpected'), 'test_tool');

      expect(mockNotify).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Function)
      );

      // Verify the callback sets tool metadata
      const callback = mockNotify.mock.calls[0][1];
      const mockEvent = {
        context: '',
        addMetadata: vi.fn(),
      };
      callback(mockEvent);

      expect(mockEvent.context).toBe('test_tool');
      expect(mockEvent.addMetadata).toHaveBeenCalledWith('tool', { name: 'test_tool' });
    });

    it('should not report when Bugsnag is not configured', () => {
      // Bugsnag client is null by default
      _setBugsnagClientForTesting(null);

      // These should not throw
      const error = IntervalsApiError.fromHttpStatus(500, {
        operation: 'test',
      });
      logApiError(error);
      logUnexpectedError(new Error('test'));

      // Just verify no crash - console.error was called for logging
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
