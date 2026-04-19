import type { PlayedSong } from '../types/index.js';
import { LastFmApiError, type ErrorContext } from '../errors/index.js';
import { logApiError } from '../utils/logger.js';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Buffer added to each side of the workout window when querying Last.fm.
 * Captures songs that bridge the workout's start or end boundary.
 */
const WINDOW_BUFFER_MS = 10 * 60 * 1000;

export interface LastFmConfig {
  username: string;
  apiKey: string;
}

interface LastFmArtist {
  '#text'?: string;
  name?: string;
  mbid?: string;
}

interface LastFmAlbum {
  '#text'?: string;
  mbid?: string;
}

interface LastFmDate {
  uts: string;
  '#text'?: string;
}

export interface LastFmTrack {
  name: string;
  url: string;
  artist?: LastFmArtist;
  album?: LastFmAlbum;
  date?: LastFmDate;
  '@attr'?: { nowplaying?: string };
}

interface LastFmRecentTracksResponse {
  recenttracks?: {
    track?: LastFmTrack | LastFmTrack[];
  };
  error?: number;
  message?: string;
}

/**
 * Client for Last.fm's user.getRecentTracks endpoint.
 * Uses a username + API key (no OAuth).
 */
export class LastFmClient {
  constructor(private config: LastFmConfig) {}

  /**
   * Fetch raw recent tracks for the configured user within a time range.
   * `fromSec` and `toSec` are Unix-seconds; both are inclusive per Last.fm docs.
   */
  async getRecentTracks(fromSec: number, toSec: number, limit = 200): Promise<LastFmTrack[]> {
    const context: ErrorContext = {
      operation: 'fetch recent tracks',
      resource: `user ${this.config.username}`,
      parameters: { from: fromSec, to: toSec, limit },
    };

    const params = new URLSearchParams({
      method: 'user.getrecenttracks',
      user: this.config.username,
      api_key: this.config.apiKey,
      format: 'json',
      limit: String(limit),
      from: String(fromSec),
      to: String(toSec),
    });
    const url = `${LASTFM_API_BASE}?${params.toString()}`;

    console.log(`[Last.fm] Making API call to ${LASTFM_API_BASE}?method=user.getrecenttracks&user=${this.config.username}&from=${fromSec}&to=${toSec}&limit=${limit}`);

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      const err = LastFmApiError.networkError(
        context,
        error instanceof Error ? error : undefined
      );
      logApiError(err, { method: 'GET', url });
      throw err;
    }

    const bodyText = await response.text();

    if (!response.ok) {
      const err = LastFmApiError.fromHttpStatus(response.status, context, bodyText);
      logApiError(err, {
        method: 'GET',
        url,
        statusCode: response.status,
        responseBody: bodyText,
      });
      throw err;
    }

    let data: LastFmRecentTracksResponse;
    try {
      data = JSON.parse(bodyText) as LastFmRecentTracksResponse;
    } catch (error) {
      const err = new LastFmApiError(
        'Last.fm returned an unparseable response.',
        'internal',
        false,
        context,
        response.status,
        bodyText
      );
      logApiError(err, {
        method: 'GET',
        url,
        statusCode: response.status,
        responseBody: bodyText,
      });
      throw err;
    }

    if (typeof data.error === 'number') {
      const err = LastFmApiError.fromApiErrorBody(
        data.error,
        data.message ?? 'Unknown error',
        context
      );
      logApiError(err, {
        method: 'GET',
        url,
        statusCode: response.status,
        responseBody: bodyText,
      });
      throw err;
    }

    const raw = data.recenttracks?.track;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  /**
   * Fetch songs played during a time window (ms since epoch), returned in chronological order.
   * Drops "now playing" entries (which have no date).
   *
   * Expands the search by 10 minutes on each side of the workout to catch songs that
   * bridge the workout's start or end boundary, then filters out songs that played
   * entirely outside the workout window. Last.fm's scrobble timestamp is the track's
   * start time, so a scrobble *after* the workout ended belongs to a song that
   * started after the workout — it never overlapped and is removed.
   */
  async getPlayedSongsDuring(startMs: number, endMs: number): Promise<PlayedSong[]> {
    const fromSec = Math.floor((startMs - WINDOW_BUFFER_MS) / 1000);
    const toSec = Math.ceil((endMs + WINDOW_BUFFER_MS) / 1000);
    const tracks = await this.getRecentTracks(fromSec, toSec, 200);
    return tracks
      .filter((t) => t.date?.uts)
      .map(normalizeTrack)
      .filter((song) => {
        // Drop songs that started after the workout ended — they played entirely
        // outside the workout window. Songs in the pre-buffer [start-10min, start)
        // are kept because they likely bridged the workout's start.
        const playedAtMs = new Date(song.played_at).getTime();
        return playedAtMs <= endMs;
      })
      .sort((a, b) => a.played_at.localeCompare(b.played_at));
  }
}

function normalizeTrack(track: LastFmTrack): PlayedSong {
  const uts = Number(track.date!.uts);
  return {
    name: track.name,
    played_at: new Date(uts * 1000).toISOString(),
    url: track.url,
    album_name: track.album?.['#text'] ?? '',
    artist_name: track.artist?.['#text'] ?? track.artist?.name ?? '',
  };
}
