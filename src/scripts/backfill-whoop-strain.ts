#!/usr/bin/env tsx
/**
 * Backfill historical Whoop wellness values into Intervals.icu.
 *
 * Walks Whoop's entire cycle/sleep/recovery history, assigns each record to
 * a local calendar date via its own `timezone_offset`, and bulk-writes
 * three wellness fields into Intervals.icu via PUT /wellness-bulk:
 *
 *   - WhoopStrain               (from `/cycle`, by cycle end date)
 *   - WhoopSleepPerformance     (from `/activity/sleep`, by sleep end date)
 *   - WhoopRecovery             (from `/recovery`, joined to its sleep)
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
import { formatYMDFromOffset } from '../utils/tz.js';
import { isMissingCustomFieldError } from '../errors/index.js';

const HISTORY_START = '2009-01-01'; // Whoop launched in 2012; this is a safe floor.
const BULK_CHUNK_SIZE = 100;

interface DayRecord {
  id: string; // YYYY-MM-DD
  WhoopStrain?: number;
  WhoopSleepPerformance?: number;
  WhoopRecovery?: number;
  // Tracking timestamps used for last-wins dedupe per field.
  strainAt?: string;
  sleepAt?: string;
  recoveryAt?: string;
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreate(byDate: Map<string, DayRecord>, date: string): DayRecord {
  let r = byDate.get(date);
  if (!r) {
    r = { id: date };
    byDate.set(date, r);
  }
  return r;
}

async function main() {
  const apply = process.argv.includes('--apply');

  console.log('\nWhoop wellness backfill\n');
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
  const nowIso = new Date().toISOString();

  console.log(`\nFetching Whoop history from ${HISTORY_START} to ${endDate}...`);
  const [cycles, sleeps, recoveries] = await Promise.all([
    whoop.getRawCycles(HISTORY_START, endDate),
    whoop.getRawSleeps(HISTORY_START, endDate),
    whoop.getRawRecoveries(HISTORY_START, endDate),
  ]);
  console.log(`  cycles=${cycles.length}, sleeps=${sleeps.length}, recoveries=${recoveries.length}`);

  const byDate = new Map<string, DayRecord>();

  // --- Cycles -> WhoopStrain (keyed by cycle end date; in-progress = now). ---
  let unscoredCycles = 0;
  for (const cycle of cycles) {
    if (cycle.score_state !== 'SCORED') {
      unscoredCycles++;
      continue;
    }
    const date = formatYMDFromOffset(cycle.end, cycle.timezone_offset);
    const at = cycle.end ?? nowIso;
    const r = getOrCreate(byDate, date);
    if (!r.strainAt || at > r.strainAt) {
      r.WhoopStrain = cycle.score.strain;
      r.strainAt = at;
    }
  }

  // --- Sleeps -> WhoopSleepPerformance + sleepId -> date map (for recoveries). ---
  // Naps are skipped for sleep performance writes but kept in the id map so any
  // stray recovery that points at a nap can still be located.
  const sleepIdToDate = new Map<string, string>();
  let unscoredSleeps = 0;
  let naps = 0;
  let sleepsWithoutPerf = 0;
  for (const sleep of sleeps) {
    const date = formatYMDFromOffset(sleep.end, sleep.timezone_offset);
    sleepIdToDate.set(String(sleep.id), date);
    if (sleep.score_state !== 'SCORED') {
      unscoredSleeps++;
      continue;
    }
    if (sleep.nap) {
      naps++;
      continue;
    }
    const perf = sleep.score?.sleep_performance_percentage;
    if (perf == null) {
      sleepsWithoutPerf++;
      continue;
    }
    const r = getOrCreate(byDate, date);
    if (!r.sleepAt || sleep.end > r.sleepAt) {
      r.WhoopSleepPerformance = perf;
      r.sleepAt = sleep.end;
    }
  }

  // --- Recoveries -> WhoopRecovery (date comes from the recovery's sleep). ---
  let unscoredRecoveries = 0;
  let recoveriesWithoutSleep = 0;
  for (const recovery of recoveries) {
    if (recovery.score_state !== 'SCORED') {
      unscoredRecoveries++;
      continue;
    }
    const date = sleepIdToDate.get(String(recovery.sleep_id));
    if (!date) {
      recoveriesWithoutSleep++;
      continue;
    }
    const r = getOrCreate(byDate, date);
    // Recoveries don't carry a timestamp; use the source sleep's updated_at as
    // a proxy so later edits win over earlier ones on the same day.
    const at = recovery.updated_at ?? '';
    if (!r.recoveryAt || at > r.recoveryAt) {
      r.WhoopRecovery = recovery.score.recovery_score;
      r.recoveryAt = at;
    }
  }

  const records = Array.from(byDate.values()).sort((a, b) => a.id.localeCompare(b.id));

  console.log(
    `Skipped: cycles(unscored)=${unscoredCycles}, sleeps(unscored)=${unscoredSleeps}, ` +
    `naps=${naps}, sleeps(no-perf)=${sleepsWithoutPerf}, ` +
    `recoveries(unscored)=${unscoredRecoveries}, recoveries(no-sleep-match)=${recoveriesWithoutSleep}`
  );
  console.log(`Unique dates with any data: ${records.length}.`);

  if (records.length === 0) {
    console.log('\nNothing to write.');
    await closeRedis();
    process.exit(0);
  }

  console.log(`Date range: ${records[0].id} -> ${records[records.length - 1].id}`);

  const fmt = (n: number | undefined, digits: number) =>
    n == null ? '   --' : n.toFixed(digits);
  const preview = (label: string, rows: DayRecord[]) => {
    console.log(`\n${label}:`);
    console.log('  date         strain    sleep%    rec%');
    for (const r of rows) {
      console.log(
        `  ${r.id}  ${fmt(r.WhoopStrain, 2).padStart(7)}   ${fmt(r.WhoopSleepPerformance, 1).padStart(6)}   ${fmt(r.WhoopRecovery, 1).padStart(5)}`
      );
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
    const chunk = records.slice(i, i + BULK_CHUNK_SIZE).map((r) => {
      const out: { id: string; WhoopStrain?: number; WhoopSleepPerformance?: number; WhoopRecovery?: number } = {
        id: r.id,
      };
      if (r.WhoopStrain != null) out.WhoopStrain = r.WhoopStrain;
      if (r.WhoopSleepPerformance != null) out.WhoopSleepPerformance = r.WhoopSleepPerformance;
      if (r.WhoopRecovery != null) out.WhoopRecovery = r.WhoopRecovery;
      return out;
    });
    try {
      await intervals.updateWellnessBulk(chunk);
    } catch (error) {
      if (isMissingCustomFieldError(error)) {
        console.error(
          '\nIntervals.icu rejected the bulk write (422). One or more of these wellness ' +
          'custom fields likely hasn\'t been created in your Intervals.icu settings:\n' +
          '  - WhoopStrain\n' +
          '  - WhoopSleepPerformance\n' +
          '  - WhoopRecovery\n' +
          '\nCreate them under Intervals.icu → Settings → Custom Fields → Wellness, then re-run.'
        );
        console.error(`\nResponse body: ${error.responseBody ?? '(empty)'}`);
        await closeRedis();
        process.exit(0);
      }
      throw error;
    }
    written += chunk.length;
    console.log(`  ${written}/${records.length} (${chunk[0].id} -> ${chunk[chunk.length - 1].id})`);
  }

  console.log(`\nDone. Wrote ${written} records.`);
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
