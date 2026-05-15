import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createLocationWebhookHandler } from '../../src/webhooks/location.js';
import type { IntervalsClient } from '../../src/clients/intervals.js';

const SECRET = 'location-webhook-secret';

const JACKSON_COMPONENTS = [
  { long_name: 'Wilson', short_name: 'Wilson', types: ['locality'] },
  { long_name: 'Teton County', short_name: 'Teton County', types: ['administrative_area_level_2'] },
  { long_name: 'Wyoming', short_name: 'WY', types: ['administrative_area_level_1'] },
  { long_name: 'United States', short_name: 'US', types: ['country'] },
];

function makeDeps() {
  const intervals = {
    getAthleteProfile: vi.fn().mockResolvedValue({}),
    getWeatherForecastsRaw: vi.fn().mockResolvedValue([]),
    updateAthleteProfile: vi.fn().mockResolvedValue(undefined),
    updateWeatherConfig: vi.fn().mockResolvedValue(undefined),
    invalidateAthleteCaches: vi.fn(),
  };
  const deps = {
    intervals: intervals as unknown as IntervalsClient,
    geocoding: {
      reverseGeocode: vi.fn().mockResolvedValue({
        address_components: JACKSON_COMPONENTS,
        formatted_address: 'Wilson, WY 83014, USA',
      }),
    },
    timezone: { getTimezone: vi.fn().mockResolvedValue('America/Denver') },
    secret: SECRET,
  };
  return { deps, intervals };
}

function makeApp(deps: ReturnType<typeof makeDeps>['deps']) {
  const app = express();
  app.use(express.json());
  app.post('/webhooks/location', createLocationWebhookHandler(deps as never));
  return app;
}

async function post(
  app: express.Express,
  body: unknown,
  opts: { auth?: string; query?: string } = {}
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = (server.address() as { port: number }).port;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.auth) headers.Authorization = opts.auth;
        const res = await fetch(
          `http://127.0.0.1:${port}/webhooks/location${opts.query ?? ''}`,
          { method: 'POST', headers, body: JSON.stringify(body) }
        );
        const json = await res.json().catch(() => ({}));
        server.close();
        resolve({ status: res.status, body: json });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

describe('location webhook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 when no token is provided', async () => {
    const { deps } = makeDeps();
    const res = await post(makeApp(deps), { latitude: 43.48, longitude: -110.76 });
    expect(res.status).toBe(401);
  });

  it('403 when the token is wrong', async () => {
    const { deps } = makeDeps();
    const res = await post(makeApp(deps), { latitude: 43.48, longitude: -110.76 }, {
      auth: 'Bearer nope',
    });
    expect(res.status).toBe(403);
  });

  it('400 when coordinates are missing or invalid', async () => {
    const { deps } = makeDeps();
    const res = await post(makeApp(deps), { latitude: 999, longitude: 'x' }, {
      auth: `Bearer ${SECRET}`,
    });
    expect(res.status).toBe(400);
  });

  it('200 and applies the location with a valid Bearer token', async () => {
    const { deps, intervals } = makeDeps();
    const res = await post(makeApp(deps), { latitude: 43.48, longitude: -110.76 }, {
      auth: `Bearer ${SECRET}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.location).toBe('Jackson Hole, Wyoming, United States');
    expect(res.body.profileUpdated).toBe(true);
    expect(intervals.updateAthleteProfile).toHaveBeenCalled();
    expect(intervals.updateWeatherConfig).toHaveBeenCalled();
  });

  it('accepts the secret via ?token= and string coordinates', async () => {
    const { deps } = makeDeps();
    const res = await post(
      makeApp(deps),
      { latitude: '43.48', longitude: '-110.76' },
      { query: `?token=${SECRET}` }
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
