import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRedirectUri } from '../../src/scripts/whoop-oauth.js';

describe('getRedirectUri', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.FLY_APP_NAME;
    delete process.env.WHOOP_REDIRECT_URI;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('should use FLY_APP_NAME when set', () => {
    process.env.FLY_APP_NAME = 'my-app';

    const result = getRedirectUri();

    expect(result).toBe('https://my-app.fly.dev/callback');
  });

  it('should prioritize FLY_APP_NAME over WHOOP_REDIRECT_URI', () => {
    process.env.FLY_APP_NAME = 'my-app';
    process.env.WHOOP_REDIRECT_URI = 'https://custom.example.com/callback';

    const result = getRedirectUri();

    expect(result).toBe('https://my-app.fly.dev/callback');
  });

  it('should use WHOOP_REDIRECT_URI when FLY_APP_NAME is not set', () => {
    process.env.WHOOP_REDIRECT_URI = 'https://custom.example.com/callback';

    const result = getRedirectUri();

    expect(result).toBe('https://custom.example.com/callback');
  });

  it('should default to localhost when no environment variables are set', () => {
    const result = getRedirectUri();

    expect(result).toBe('http://localhost:3000/callback');
  });

  it('should handle FLY_APP_NAME with hyphens', () => {
    process.env.FLY_APP_NAME = 'my-cool-app-123';

    const result = getRedirectUri();

    expect(result).toBe('https://my-cool-app-123.fly.dev/callback');
  });
});
