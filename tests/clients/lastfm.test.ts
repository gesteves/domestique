import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LastFmClient } from '../../src/clients/lastfm.js';
import { LastFmApiError } from '../../src/errors/index.js';

function createMockResponse<T>(
  data: T,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
): Partial<Response> {
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

describe('LastFmClient', () => {
  let client: LastFmClient;
  const mockFetch = vi.fn();

  const defaultConfig = { username: 'gesteves', apiKey: 'test-api-key' };

  beforeEach(() => {
    client = new LastFmClient(defaultConfig);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getRecentTracks', () => {
    it('sends the correct query parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recenttracks: { track: [] } })
      );

      await client.getRecentTracks(1776530000, 1776540000, 200);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('https://ws.audioscrobbler.com/2.0/');
      expect(url).toContain('method=user.getrecenttracks');
      expect(url).toContain('user=gesteves');
      expect(url).toContain('api_key=test-api-key');
      expect(url).toContain('format=json');
      expect(url).toContain('limit=200');
      expect(url).toContain('from=1776530000');
      expect(url).toContain('to=1776540000');
      expect(url).toContain('extended=1');
    });

    it('wraps a single track object into an array', async () => {
      const singleTrack = {
        name: 'Old Man',
        url: 'https://www.last.fm/music/Neil+Young/_/Old+Man',
        artist: { '#text': 'Neil Young' },
        album: { '#text': 'Harvest' },
        date: { uts: '1776535043', '#text': '18 Apr 2026, 17:57' },
      };
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recenttracks: { track: singleTrack } })
      );

      const result = await client.getRecentTracks(0, 999999, 200);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Old Man');
    });

    it('returns [] when recenttracks.track is missing', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recenttracks: {} })
      );

      const result = await client.getRecentTracks(0, 999999, 200);

      expect(result).toEqual([]);
    });

    it('returns [] for an empty array of tracks', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recenttracks: { track: [] } })
      );

      const result = await client.getRecentTracks(0, 999999, 200);

      expect(result).toEqual([]);
    });

    it('throws LastFmApiError on a Last.fm API error body (HTTP 200)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 6, message: 'User not found' })
      );

      await expect(client.getRecentTracks(0, 999999, 200)).rejects.toThrow(LastFmApiError);
    });

    it('throws LastFmApiError on HTTP 404', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: 6, message: 'Not found' }, { ok: false, status: 404 })
      );

      await expect(client.getRecentTracks(0, 999999, 200)).rejects.toThrow(LastFmApiError);
    });

    it('throws LastFmApiError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(client.getRecentTracks(0, 999999, 200)).rejects.toThrow(LastFmApiError);
    });

    it('throws LastFmApiError on unparseable JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<html>nope</html>'),
      });

      await expect(client.getRecentTracks(0, 999999, 200)).rejects.toThrow(LastFmApiError);
    });
  });

  describe('getPlayedSongsDuring', () => {
    const sampleResponse = {
      recenttracks: {
        track: [
          {
            name: 'Old Man',
            url: 'https://www.last.fm/music/Neil+Young/_/Old+Man',
            artist: { mbid: '75167b8b', '#text': 'Neil Young' },
            album: { '#text': 'Harvest (50th Anniversary Edition)' },
            date: { uts: '1776535049', '#text': '18 Apr 2026, 18:00' },
            loved: '1',
          },
          {
            name: 'Crawling - One More Light Live',
            url: 'https://www.last.fm/music/Linkin+Park/_/Crawling',
            artist: { mbid: 'f59c5520', '#text': 'Linkin Park' },
            album: { '#text': 'One More Light Live' },
            date: { uts: '1776535045', '#text': '18 Apr 2026, 17:57' },
            loved: '0',
          },
          {
            // "Now playing" track — no date, has @attr.nowplaying
            name: 'Current Track',
            url: 'https://www.last.fm/music/Artist/_/Current',
            artist: { '#text': 'Now Playing Artist' },
            album: { '#text': 'Live Album' },
            '@attr': { nowplaying: 'true' },
          },
        ],
      },
    };

    it('widens the query by 10 minutes on each side of the workout window', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ recenttracks: { track: [] } }));

      const startMs = 1776530000500;
      const endMs = 1776540000500;
      const BUFFER_MS = 10 * 60 * 1000;
      await client.getPlayedSongsDuring(startMs, endMs);

      const url = mockFetch.mock.calls[0][0] as string;
      // from = floor((start - 10min) / 1000); to = ceil((end + 10min) / 1000)
      expect(url).toContain(`from=${Math.floor((startMs - BUFFER_MS) / 1000)}`);
      expect(url).toContain(`to=${Math.ceil((endMs + BUFFER_MS) / 1000)}`);
    });

    it('keeps songs scrobbled in the pre-buffer (likely bridging workout start)', async () => {
      const startMs = 1_776_000_000_000;
      const endMs = startMs + 3600 * 1000;
      const preBufferUts = Math.floor((startMs - 180 * 1000) / 1000); // 3 min before start
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          recenttracks: {
            track: [
              {
                name: 'Pre-Buffer Song',
                url: 'https://www.last.fm/music/x',
                artist: { '#text': 'Artist' },
                album: { '#text': 'Album' },
                date: { uts: String(preBufferUts) },
              },
            ],
          },
        })
      );

      const result = await client.getPlayedSongsDuring(startMs, endMs);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pre-Buffer Song');
    });

    it('drops songs scrobbled in the post-buffer (started after workout ended)', async () => {
      const startMs = 1_776_000_000_000;
      const endMs = startMs + 3600 * 1000; // 1 hr workout
      const duringUts = Math.floor((startMs + 1000) / 1000);
      const postBufferUts = Math.floor((endMs + 120 * 1000) / 1000); // 2 min past end

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          recenttracks: {
            track: [
              {
                name: 'Post-Buffer Song',
                url: 'https://www.last.fm/music/post',
                artist: { '#text': 'A' },
                album: { '#text': 'B' },
                date: { uts: String(postBufferUts) },
              },
              {
                name: 'During Workout',
                url: 'https://www.last.fm/music/during',
                artist: { '#text': 'C' },
                album: { '#text': 'D' },
                date: { uts: String(duringUts) },
              },
            ],
          },
        })
      );

      const result = await client.getPlayedSongsDuring(startMs, endMs);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('During Workout');
    });

    it('returns songs in chronological order', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(sampleResponse));

      const result = await client.getPlayedSongsDuring(1776535000000, 1776535100000);

      expect(result).toHaveLength(2); // nowplaying filtered out
      expect(result[0].name).toBe('Crawling - One More Light Live'); // earlier
      expect(result[1].name).toBe('Old Man'); // later
    });

    it('filters out now-playing tracks (no date field)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(sampleResponse));

      const result = await client.getPlayedSongsDuring(1776535000000, 1776535100000);

      expect(result.find((s) => s.name === 'Current Track')).toBeUndefined();
    });

    it('normalizes track fields with artist #text', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(sampleResponse));

      const result = await client.getPlayedSongsDuring(0, 9999999999999);
      const neil = result.find((s) => s.name === 'Old Man');

      expect(neil).toBeDefined();
      expect(neil!.artist_name).toBe('Neil Young');
      expect(neil!.album_name).toBe('Harvest (50th Anniversary Edition)');
      expect(neil!.url).toBe('https://www.last.fm/music/Neil+Young/_/Old+Man');
      expect(neil!.played_at).toBe(new Date(1776535049 * 1000).toISOString());
    });

    it('sets loved=true when the API reports loved=1 and omits it otherwise', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(sampleResponse));

      const result = await client.getPlayedSongsDuring(0, 9999999999999);
      const loved = result.find((s) => s.name === 'Old Man');
      const notLoved = result.find((s) => s.name === 'Crawling - One More Light Live');

      expect(loved!.loved).toBe(true);
      expect(notLoved!.loved).toBeUndefined();
      expect('loved' in notLoved!).toBe(false);
    });

    it('omits loved when the API omits the field', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          recenttracks: {
            track: [
              {
                name: 'No Loved Field',
                url: 'https://www.last.fm/x',
                artist: { '#text': 'Artist' },
                album: { '#text': 'Album' },
                date: { uts: '1776535049' },
              },
            ],
          },
        })
      );

      const result = await client.getPlayedSongsDuring(0, 9999999999999);

      expect(result[0].loved).toBeUndefined();
      expect('loved' in result[0]).toBe(false);
    });

    it('handles empty album text', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          recenttracks: {
            track: [
              {
                name: 'Something',
                url: 'https://www.last.fm/music/x/_/y',
                artist: { '#text': 'Some Artist' },
                album: { '#text': '' },
                date: { uts: '1776535049' },
              },
            ],
          },
        })
      );

      const result = await client.getPlayedSongsDuring(0, 9999999999999);

      expect(result[0].album_name).toBe('');
    });

    it('falls back to artist.name when #text is absent', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          recenttracks: {
            track: [
              {
                name: 'Test',
                url: 'https://www.last.fm/x',
                artist: { name: 'Alt Format Artist' },
                album: { '#text': 'Test Album' },
                date: { uts: '1776535049' },
              },
            ],
          },
        })
      );

      const result = await client.getPlayedSongsDuring(0, 9999999999999);

      expect(result[0].artist_name).toBe('Alt Format Artist');
    });

    it('returns an empty array when Last.fm returns no tracks', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recenttracks: { track: [] } })
      );

      const result = await client.getPlayedSongsDuring(0, 9999999999999);

      expect(result).toEqual([]);
    });
  });
});
