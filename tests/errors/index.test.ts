import { describe, it, expect } from 'vitest';
import {
  ApiError,
  DateParseError,
  IntervalsApiError,
  TrainerRoadApiError,
} from '../../src/errors/index.js';

describe('Error Classes', () => {
  describe('ApiError', () => {
    it('should create an error with all properties', () => {
      const error = new ApiError(
        'Test error message',
        'not_found',
        false,
        { operation: 'fetch data', resource: 'activity 123' },
        'intervals',
        404
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.message).toBe('Test error message');
      expect(error.category).toBe('not_found');
      expect(error.isRetryable).toBe(false);
      expect(error.context.operation).toBe('fetch data');
      expect(error.context.resource).toBe('activity 123');
      expect(error.source).toBe('intervals');
      expect(error.statusCode).toBe(404);
    });

    it('should generate what happened description', () => {
      const error = new ApiError(
        'Test error',
        'not_found',
        false,
        { operation: 'fetch intervals', resource: 'activity 123' },
        'intervals'
      );

      expect(error.getWhatHappened()).toContain('fetch intervals');
      expect(error.getWhatHappened()).toContain('activity 123');
    });

    it('should generate how to fix guidance based on category', () => {
      const notFoundError = new ApiError(
        'Not found',
        'not_found',
        false,
        { operation: 'test' },
        'intervals'
      );
      expect(notFoundError.getHowToFix()).toContain('Double-check');

      const authError = new ApiError(
        'Auth failed',
        'authentication',
        false,
        { operation: 'test' },
        'intervals'
      );
      expect(authError.getHowToFix()).toContain('credentials');

      const rateLimitError = new ApiError(
        'Rate limited',
        'rate_limit',
        true,
        { operation: 'test' },
        'intervals'
      );
      expect(rateLimitError.getHowToFix()).toContain('Wait');
    });
  });

  describe('DateParseError', () => {
    it('should create a date parse error with input and parameter name', () => {
      const error = new DateParseError('invalid date', 'oldest');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toBeInstanceOf(DateParseError);
      expect(error.input).toBe('invalid date');
      expect(error.parameterName).toBe('oldest');
      expect(error.category).toBe('date_parse');
      expect(error.isRetryable).toBe(false);
      expect(error.source).toBe('date_parser');
    });

    it('should include input and parameter name in message', () => {
      const error = new DateParseError('invalid input', 'newest');

      expect(error.message).toContain('invalid input');
      expect(error.message).toContain('newest');
    });

    it('should include helpful format examples in message', () => {
      const error = new DateParseError('bad date', 'oldest');
      expect(error.message).toContain('2024-12-25');
      expect(error.message).toContain('yesterday');
      expect(error.message).toContain('7 days ago');
    });

    it('should generate what happened description', () => {
      const error = new DateParseError('invalid', 'oldest');
      expect(error.getWhatHappened()).toContain('oldest');
      expect(error.getWhatHappened()).toContain("couldn't be parsed");
    });

    it('should generate how to fix guidance', () => {
      const error = new DateParseError('invalid', 'date');
      expect(error.getHowToFix()).toContain('2024-12-25');
      expect(error.getHowToFix()).toContain('yesterday');
      expect(error.getHowToFix()).toContain('7 days ago');
    });

    it('should accept custom message', () => {
      const error = new DateParseError('test', 'date', 'Custom error message');
      expect(error.message).toBe('Custom error message');
    });
  });

  describe('IntervalsApiError', () => {
    it('should create error from HTTP status 404', () => {
      const error = IntervalsApiError.fromHttpStatus(404, {
        operation: 'fetch workout',
        resource: 'activity i123456',
      });

      expect(error).toBeInstanceOf(IntervalsApiError);
      expect(error.category).toBe('not_found');
      expect(error.isRetryable).toBe(false);
      expect(error.statusCode).toBe(404);
      expect(error.source).toBe('intervals');
      expect(error.message).toContain("couldn't find");
      expect(error.message).toContain('i123456');
    });

    it('should create error from HTTP status 401', () => {
      const error = IntervalsApiError.fromHttpStatus(401, {
        operation: 'fetch data',
      });

      expect(error.category).toBe('authentication');
      expect(error.isRetryable).toBe(false);
      expect(error.message).toContain('Authentication failed');
    });

    it('should create error from HTTP status 429', () => {
      const error = IntervalsApiError.fromHttpStatus(429, {
        operation: 'fetch data',
      });

      expect(error.category).toBe('rate_limit');
      expect(error.isRetryable).toBe(true);
      expect(error.message).toContain('limiting requests');
    });

    it('should create error from HTTP status 500', () => {
      const error = IntervalsApiError.fromHttpStatus(500, {
        operation: 'fetch data',
      });

      expect(error.category).toBe('service_unavailable');
      expect(error.isRetryable).toBe(true);
      expect(error.message).toContain('temporarily unavailable');
    });

    it('should create network error', () => {
      const originalError = new Error('Connection refused');
      const error = IntervalsApiError.networkError(
        { operation: 'fetch workout' },
        originalError
      );

      expect(error.category).toBe('network');
      expect(error.isRetryable).toBe(true);
      expect(error.message).toContain('trouble connecting');
      expect(error.message).toContain('Connection refused');
    });
  });

  describe('TrainerRoadApiError', () => {
    it('should create error from HTTP status 404', () => {
      const error = TrainerRoadApiError.fromHttpStatus(404, {
        operation: 'fetch calendar',
      });

      expect(error).toBeInstanceOf(TrainerRoadApiError);
      expect(error.category).toBe('not_found');
      expect(error.isRetryable).toBe(false);
      expect(error.source).toBe('trainerroad');
      expect(error.message).toContain("couldn't find");
    });

    it('should create error from HTTP status 401', () => {
      const error = TrainerRoadApiError.fromHttpStatus(401, {
        operation: 'fetch calendar',
      });

      expect(error.category).toBe('authentication');
      expect(error.message).toContain('calendar URL may be invalid');
    });

    it('should create network error', () => {
      const error = TrainerRoadApiError.networkError(
        { operation: 'fetch workouts' },
        new Error('ECONNRESET')
      );

      expect(error.category).toBe('network');
      expect(error.isRetryable).toBe(true);
      expect(error.message).toContain('trouble connecting');
    });

    it('should create parse error', () => {
      const error = TrainerRoadApiError.parseError(
        { operation: 'parse calendar' },
        new Error('Invalid ICS format')
      );

      expect(error.category).toBe('validation');
      expect(error.isRetryable).toBe(false);
      expect(error.message).toContain("couldn't read");
      expect(error.message).toContain('unexpected format');
    });
  });
});

