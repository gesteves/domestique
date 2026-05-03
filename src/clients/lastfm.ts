import type { PlayedSong } from '../types/index.js';
import { LastFmApiError, type ErrorContext } from '../errors/index.js';
import { logApiError } from '../utils/logger.js';
import { httpRequestText } from './http.js';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Buffer added to the pre-start side of the workout window when querying Last.fm.
 * Captures songs scrobbled before the workout that may have still been playing
 * when it started; their actual overlap is then verified via track.getInfo.
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
  loved?: string;
  '@attr'?: { nowplaying?: string };
}

interface LastFmRecentTracksResponse {
  recenttracks?: {
    track?: LastFmTrack | LastFmTrack[];
  };
  error?: number;
  message?: string;
}

interface LastFmTrackInfo {
  name?: string;
  duration?: string;
  mbid?: string;
}

interface LastFmTrackInfoResponse {
  track?: LastFmTrackInfo;
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
      extended: '1',
    });
    const url = `${LASTFM_API_BASE}?${params.toString()}`;

    console.log(`[Last.fm] Making API call to ${LASTFM_API_BASE}?method=user.getrecenttracks&user=${this.config.username}&from=${fromSec}&to=${toSec}&limit=${limit}&extended=1`);

    const bodyText = await httpRequestText({
      url,
      context,
      toHttpError: (status, ctx, body) => LastFmApiError.fromHttpStatus(status, ctx, body),
      toNetworkError: (ctx, err) => LastFmApiError.networkError(ctx, err),
    });

    let data: LastFmRecentTracksResponse;
    try {
      data = JSON.parse(bodyText) as LastFmRecentTracksResponse;
    } catch (error) {
      const err = new LastFmApiError(
        'Last.fm returned an unparseable response.',
        'internal',
        false,
        context,
        undefined,
        bodyText
      );
      logApiError(err, {
        method: 'GET',
        url,
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
        responseBody: bodyText,
      });
      throw err;
    }

    const raw = data.recenttracks?.track;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  /**
   * Fetch a single track's metadata via track.getInfo. Returns the track's duration in
   * milliseconds, or null when Last.fm doesn't have a duration for the track (the field
   * is missing or "0" for sparsely-cataloged tracks).
   */
  async getTrackInfo(artist: string, track: string): Promise<number | null> {
    const context: ErrorContext = {
      operation: 'fetch track info',
      resource: `${artist} - ${track}`,
      parameters: { artist, track },
    };

    const params = new URLSearchParams({
      method: 'track.getInfo',
      artist,
      track,
      api_key: this.config.apiKey,
      format: 'json',
      autocorrect: '1',
    });
    const url = `${LASTFM_API_BASE}?${params.toString()}`;

    const bodyText = await httpRequestText({
      url,
      context,
      toHttpError: (status, ctx, body) => LastFmApiError.fromHttpStatus(status, ctx, body),
      toNetworkError: (ctx, err) => LastFmApiError.networkError(ctx, err),
    });

    let data: LastFmTrackInfoResponse;
    try {
      data = JSON.parse(bodyText) as LastFmTrackInfoResponse;
    } catch (error) {
      const err = new LastFmApiError(
        'Last.fm returned an unparseable response.',
        'internal',
        false,
        context,
        undefined,
        bodyText
      );
      logApiError(err, {
        method: 'GET',
        url,
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
        responseBody: bodyText,
      });
      throw err;
    }

    const durationStr = data.track?.duration;
    if (!durationStr) return null;
    const durationMs = Number(durationStr);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    return durationMs;
  }

  /**
   * Fetch songs played during a time window (ms since epoch), returned in chronological order.
   * Drops "now playing" entries (which have no date).
   *
   * Expands the search by 10 minutes on the pre-buffer side to catch songs that started
   * before the workout but were still playing when it began. For each pre-buffer scrobble,
   * fetches the track's duration via track.getInfo and keeps it only if the song was still
   * playing at startMs. Tracks with unknown duration (or a track.getInfo error) are kept
   * conservatively — better a false positive than a silent drop.
   *
   * Last.fm's scrobble timestamp is the track's start time, so any scrobble after endMs
   * started after the workout and never overlapped. We don't widen the query past endMs;
   * the playedAtMs <= endMs filter is kept as a millisecond-precision guard since Last.fm's
   * `to` parameter is in seconds and inclusive.
   */
  async getPlayedSongsDuring(startMs: number, endMs: number): Promise<PlayedSong[]> {
    const fromSec = Math.floor((startMs - WINDOW_BUFFER_MS) / 1000);
    const toSec = Math.ceil(endMs / 1000);
    const tracks = await this.getRecentTracks(fromSec, toSec, 200);

    const songs = tracks
      .filter((t) => t.date?.uts)
      .map(normalizeTrack)
      .filter((song) => new Date(song.played_at).getTime() <= endMs);

    const verified = await Promise.all(
      songs.map(async (song) => {
        const playedAtMs = new Date(song.played_at).getTime();
        if (playedAtMs >= startMs) return song;
        let durationMs: number | null;
        try {
          durationMs = await this.getTrackInfo(song.artist, song.name);
        } catch {
          return song;
        }
        if (durationMs == null) return song;
        return playedAtMs + durationMs > startMs ? song : null;
      })
    );

    return verified
      .filter((s): s is PlayedSong => s !== null)
      .sort((a, b) => a.played_at.localeCompare(b.played_at));
  }
}

function normalizeTrack(track: LastFmTrack): PlayedSong {
  const uts = Number(track.date!.uts);
  const song: PlayedSong = {
    name: track.name,
    played_at: new Date(uts * 1000).toISOString(),
    url: track.url,
    album: track.album?.['#text'] ?? '',
    artist: track.artist?.['#text'] ?? track.artist?.name ?? '',
  };
  if (track.loved === '1') {
    song.loved = true;
  }
  return song;
}
