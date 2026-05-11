#!/usr/bin/env tsx
/**
 * Backfill historical WhoopStrain wellness values into Intervals.icu.
 *
 * Walks Whoop's entire cycle history, computes each cycle's local date from
 * its own `timezone_offset`, and bulk-writes the strain values into
 * Intervals.icu wellness via PUT /wellness-bulk.
 *
 * Usage:
 *   npm run whoop:backfill          # dry-run (prints what would change)
 *   npm run whoop:backfill -- --apply
 *
 * Requirements:
 * - WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, REDIS_URL (Whoop tokens loaded from Redis)
 * - INTERVALS_API_KEY, INTERVALS_ATHLETE_ID
 */

import { WhoopClient } from '../clients/whoop.js';
import { IntervalsClient } from '../clients/intervals.js';
import { getRedisClient, closeRedis } from '../utils/redis.js';

const HISTORY_START = '2009-01-01'; // Whoop launched in 2012; this is a safe floor.
const BULK_CHUNK_SIZE = 100;

interface BackfillRecord {
  id: string; // YYYY-MM-DD
  WhoopStrain: number;
  cycleEnd: string; // UTC timestamp (or 'now' ISO for in-progress), used for last-wins dedupe
}

/**
 * Parse a Whoop `timezone_offset` (e.g. "Z", "-05:00", "+02:00") to milliseconds.
 */
function parseOffsetMs(offset: string): number {
  if (offset === 'Z') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) {
    throw new Error(`Unrecognized Whoop timezone_offset: ${offset}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

/**
 * Determine a Whoop cycle's local calendar date.
 *
 * Whoop cycles span ~24h between successive sleep onsets, so `end` is the
 * moment that closes out the cycle's strain accumulation and is the right
 * timestamp for picking a calendar day. For in-progress cycles (no `end`),
 * fall back to "now" in the cycle's own timezone.
 */
export function localDateForCycle(
  end: string | undefined,
  offset: string,
  now: Date = new Date()
): string {
  const offsetMs = parseOffsetMs(offset);
  const baseMs = end ? new Date(end).getTime() : now.getTime();
  const local = new Date(baseMs + offsetMs);
  return local.toISOString().slice(0, 10);
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log('\nWhoop strain backfill\n');
  console.log(apply ? 'Mode: APPLY (will write to Intervals.icu)' : 'Mode: DRY RUN (no writes)');

  const whoopClientId = process.env.WHOOP_CLIENT_ID;
  const whoopClientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redisUrl = process.env.REDIS_URL;
  const intervalsApiKey = process.env.INTERVALS_API_KEY;
  const intervalsAthleteId = process.env.INTERVALS_ATHLETE_ID;

  const missing: string[] = [];
  if (!whoopClientId) missing.push('WHOOP_CLIENT_ID');
  if (!whoopClientSecret) missing.push('WHOOP_CLIENT_SECRET');
  if (!redisUrl) missing.push('REDIS_URL');
  if (!intervalsApiKey) missing.push('INTERVALS_API_KEY');
  if (!intervalsAthleteId) missing.push('INTERVALS_ATHLETE_ID');
  if (missing.length > 0) {
    console.error('\nMissing required environment variables:');
    for (const v of missing) console.error(`   - ${v}`);
    process.exit(1);
  }

  // Verify Redis is up (tokens live there).
  const redis = await getRedisClient();
  if (!redis) {
    console.error('\nFailed to connect to Redis.');
    process.exit(1);
  }

  const whoop = new WhoopClient({
    accessToken: '',
    refreshToken: '',
    clientId: whoopClientId!,
    clientSecret: whoopClientSecret!,
  });

  const intervals = new IntervalsClient({
    apiKey: intervalsApiKey!,
    athleteId: intervalsAthleteId!,
  });

  const endDate = todayYMD();
  console.log(`\nFetching Whoop cycles from ${HISTORY_START} to ${endDate}...`);

  const cycles = await whoop.getRawCycles(HISTORY_START, endDate);
  console.log(`Fetched ${cycles.length} cycles total.`);

  // Filter to scored cycles and map to one record per local date.
  // If multiple cycles map to the same date (rare; only on travel/DST edges),
  // the one with the latest UTC `end` wins (in-progress cycles use "now").
  const byDate = new Map<string, BackfillRecord>();
  let skippedUnscored = 0;
  const nowIso = new Date().toISOString();
  for (const cycle of cycles) {
    if (cycle.score_state !== 'SCORED') {
      skippedUnscored++;
      continue;
    }
    const date = localDateForCycle(cycle.end, cycle.timezone_offset);
    const endForDedupe = cycle.end ?? nowIso;
    const existing = byDate.get(date);
    if (!existing || endForDedupe > existing.cycleEnd) {
      byDate.set(date, {
        id: date,
        WhoopStrain: cycle.score.strain,
        cycleEnd: endForDedupe,
      });
    }
  }

  const records = Array.from(byDate.values()).sort((a, b) => a.id.localeCompare(b.id));
  console.log(`Scored cycles: ${cycles.length - skippedUnscored} (skipped ${skippedUnscored} unscored).`);
  console.log(`Unique dates: ${records.length}.`);

  if (records.length === 0) {
    console.log('\nNothing to write.');
    await closeRedis();
    process.exit(0);
  }

  console.log(`Date range: ${records[0].id} -> ${records[records.length - 1].id}`);

  const preview = (label: string, rows: BackfillRecord[]) => {
    console.log(`\n${label}:`);
    for (const r of rows) {
      console.log(`  ${r.id}  WhoopStrain=${r.WhoopStrain.toFixed(4)}`);
    }
  };
  preview('First 5', records.slice(0, 5));
  preview('Last 5', records.slice(-5));

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write to Intervals.icu.');
    await closeRedis();
    process.exit(0);
  }

  console.log(`\nWriting ${records.length} records in chunks of ${BULK_CHUNK_SIZE}...`);
  let written = 0;
  for (let i = 0; i < records.length; i += BULK_CHUNK_SIZE) {
    const chunk = records.slice(i, i + BULK_CHUNK_SIZE).map(({ id, WhoopStrain }) => ({
      id,
      WhoopStrain,
    }));
    await intervals.updateWellnessBulk(chunk);
    written += chunk.length;
    console.log(`  ${written}/${records.length} (${chunk[0].id} -> ${chunk[chunk.length - 1].id})`);
  }

  console.log(`\nDone. Wrote ${written} WhoopStrain values.`);
  await closeRedis();
}

const isMainModule =
  process.argv[1]?.endsWith('backfill-whoop-strain.js') ||
  process.argv[1]?.endsWith('backfill-whoop-strain.ts');

if (isMainModule) {
  main().catch(async (error) => {
    console.error('\nUnexpected error:', error);
    await closeRedis();
    process.exit(1);
  });
}
