# Domestique

A TypeScript MCP (Model Context Protocol) server that integrates with [Intervals.icu](https://intervals.icu), [Whoop](https://www.whoop.com) and [TrainerRoad](https://www.trainerroad.com) to provide unified access to fitness data across all activities and sports.

## Features

- Completed workouts from Intervals.icu with matched Whoop strain
- Recovery, HRV, sleep, and strain from Whoop
- Planned workouts from TrainerRoad and Intervals.icu
- Sync TrainerRoad running workouts to Intervals.icu (for Zwift/Garmin)
- Fitness trends (CTL/ATL/TSB) and detailed workout analysis with intervals, notes, and weather
- Heat strain and heat adaptation score from a [CORE Body Temperature](https://corebodytemp.com/) sensor
- Weather, AQI, and pollen forecasts up to 10 days out for Intervals.icu weather locations or any geocoded place
- Whoop webhook receiver: refreshes daily Whoop strain on Intervals.icu wellness, sets per-activity Whoop strain on the matched Intervals.icu activity, and auto-generates an activity description on completion

**Note:** Workouts imported from Strava can't be analyzed due to API restrictions. Sync them from Zwift, Garmin Connect, Dropbox, etc. instead.

## Available Tools

### Today's Data
- `get_todays_summary` - Full snapshot of today: recovery, sleep, HRV, strain, fitness (CTL/ATL/TSB), wellness, completed and planned workouts, race, calendar annotations (sick/injured/holiday/notes), and weather.
- `get_todays_activities` - Today's completed and planned workouts, race, and calendar annotations (sick/injured/holiday/notes). Leaner alternative to `get_todays_summary`.

### Profile & Settings
- `get_athlete_profile` - Athlete profile, unit preferences, age, and location.
- `get_sports_settings` - FTP, zones, and thresholds per sport.

### Historical/Trends
- `get_strain_history` - Whoop strain and activities over a date range.
- `get_activity_history` - Past completed workouts with matched Whoop strain and calendar annotations.
- `get_recovery_trends` - HRV, sleep, and recovery patterns over time.
- `get_wellness_trends` - Daily Intervals.icu wellness metrics over a date range.
- `get_activity_totals` - Aggregated totals over a date range: duration, distance, training load, and zone distributions by sport.

### Planning
- `get_upcoming_activities` - Planned workouts (TrainerRoad + Intervals.icu) and races for a future date range, plus calendar annotations.

### Workout Management
- `create_workout` - Create a structured cycling/running/swimming workout from a plain-language description.
- `update_workout` - Update a Domestique-created workout..
- `delete_workout` - Delete a Domestique-created workout.
- `sync_trainerroad_runs` - Sync running workouts from TrainerRoad to Intervals.icu, detecting changes and orphans.
- `set_workout_intervals` - Set intervals on a completed activity.
- `update_activity` - Update name and/or description of a completed activity.

### Calendar Annotations
- `create_annotation` - Add a sick/injured/holiday/note annotation to the Intervals.icu calendar.
- `update_annotation` - Update a Domestique-created annotation.
- `delete_annotation` - Delete a Domestique-created annotation.

### Analysis
- `get_training_load_trends` - CTL, ATL, TSB, ramp rate, and ACWR over time.
- `get_workout_details` - All details for one workout: intervals, notes, weather, zones, music, and matched Whoop strain.

### Performance Curves
- `get_power_curve` - Best watts at various durations with W/kg, estimated FTP, and period comparison.
- `get_pace_curve` - Best running/swimming times at key distances.
- `get_hr_curve` - Max sustained HR at various durations.

### Weather

- `get_weather_forecast` - Forecast for a date and optional location, with AQI and pollen.

## Setup

### Prerequisites

- Node.js 20+
- Intervals.icu account with API key
- Whoop account with OAuth credentials
- TrainerRoad account with calendar feed URL

### Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `MCP_AUTH_TOKEN` - Secret token for MCP authentication. You can quickly generate one with:

```bash
openssl rand -hex 32
```

For Intervals.icu integration:
- `INTERVALS_API_KEY` - Your Intervals.icu API key
- `INTERVALS_ATHLETE_ID` - Your Intervals.icu athlete ID

For Whoop integration:
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `REDIS_URL` - Required for token storage (e.g., `redis://localhost:6379`)
- `WHOOP_REDIRECT_URI` - Optional. Auto-detected based on environment:
  - On Fly.io: `https://{FLY_APP_NAME}.fly.dev/callback`
  - Otherwise: `http://localhost:3000/callback`

For TrainerRoad integration:
- `TRAINERROAD_CALENDAR_URL` - Private iCal feed URL

For weather forecasts (optional):
- `GOOGLE_API_KEY` - Google Cloud API key with the Weather, Air Quality, Pollen, Elevation, Geocoding, and Time Zone APIs enabled.

For Last.fm integration (optional):
- `LASTFM_USERNAME` - Last.fm username.
- `LASTFM_API_KEY` - Last.fm API key.

When both are set, `get_workout_details` and `get_todays_activities` include tracks played during the workout. ("Why not use Spotify?" you may be wondering. Ingesting Spotify data into AI is against their [developer policy](https://developer.spotify.com/policy).)

For Anthropic API integration:
- `ANTHROPIC_API_KEY` - Required for `create_workout` and `update_workout` on cycling and running (server converts the plain-language `structure` field into Intervals.icu workout-doc syntax). Also enables, when set, Claude for TrainerRoad annotation categorization (Sick/Injured/Holiday/Note), triathlon race priority extraction (A/B/C from the umbrella description), auto-generated activity descriptions on `workout.updated` Whoop webhooks, and debug token counting.
- `ANTHROPIC_CLASSIFIER_MODEL` - Optional override for the model used by the annotation and race-priority classifiers. Defaults to `claude-haiku-4-5`.
- `ANTHROPIC_DESCRIPTION_MODEL` - Optional override for the model used by the activity-description generator. Defaults to `claude-sonnet-4-6`.
- `ANTHROPIC_WORKOUT_MODEL` - Optional override for the model used by the `create_workout` / `update_workout` structure-to-syntax converter. Defaults to `claude-sonnet-4-6`.

For error reporting (optional):
- `BUGSNAG_API_KEY` - Reports upstream API failures (Intervals.icu, Whoop, TrainerRoad) to Bugsnag.

### Whoop OAuth Setup

Whoop uses OAuth 2.0 with single-use refresh tokens stored in Redis. One-time setup:

1. Create a Whoop developer app at https://developer.whoop.com to get your `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET`.
2. Ensure Redis is running and `REDIS_URL` is set in `.env`.
3. Start Docker: `docker compose up -d`
4. Run the OAuth script: `docker compose exec domestique npm run whoop:auth`
5. Open the displayed URL, authorize, and paste the resulting code back into the script.

The server refreshes tokens automatically thereafter.

### Whoop Webhooks (optional)

When Whoop is configured, Domestique exposes `POST /webhooks/whoop` and uses it to:

- Sync the day's Whoop strain to Intervals.icu wellness.
- Set per-workout Whoop strain on the matching Intervals.icu activity.
- Auto-generate a description for the completed activity (requires `ANTHROPIC_API_KEY`).

**One-time setup in Intervals.icu** — create these custom fields:
- Wellness: `WhoopStrain` (Number)
- Activity: `WhoopWorkoutStrain` (Number)

**One-time setup in Whoop** — in your Whoop developer dashboard, add the webhook URL `https://{your-host}/webhooks/whoop` and select **Model Version: v2**.

## Local Development

Recommended: `docker compose up` (hot reload, server at `http://localhost:3000`). Use `docker compose exec domestique <command>` to run commands inside the container (e.g., `npm run typecheck`, `npm run whoop:auth`).

Without Docker:

```bash
npm install
npm run dev          # hot reload
npm run build && npm start
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector --server-url "http://localhost:3000/mcp?token=YOUR_SECRET_TOKEN"
```

### Debug Token Counting

In development mode, set `ANTHROPIC_API_KEY` to include a `token_count` field in `_meta` on tool responses. `_meta` is out-of-band per the MCP spec, so it isn't shown to the model.

### MCP Request Logging

Set `LOG_MCP_REQUESTS=true` to log incoming JSON-RPC requests on `/mcp`.

## Deployment to Fly.io

1. **Install Fly CLI and log in**: `curl -L https://fly.io/install.sh | sh && fly auth login`
2. **Deploy Redis** (required for Whoop tokens):
   ```bash
   cd fly-redis
   fly apps create domestique-redis
   fly volumes create redis_data --region iad --size 1
   fly deploy
   cd ..
   ```
3. **Deploy Domestique**:
   ```bash
   fly apps create domestique
   fly secrets set MCP_AUTH_TOKEN=... INTERVALS_API_KEY=... INTERVALS_ATHLETE_ID=... \
     WHOOP_CLIENT_ID=... WHOOP_CLIENT_SECRET=... REDIS_URL=redis://domestique-redis.internal:6379
   fly deploy
   ```
4. **Whoop tokens** (if using Whoop): `fly ssh console -C "npm run whoop:auth"`. The redirect URI is auto-set to `https://{your-app}.fly.dev/callback` — register it in your Whoop app.

## Connecting to Claude

Add as a connector with: `https://{FLY_APP_NAME}.fly.dev/mcp?token=YOUR_SECRET_TOKEN` (substitute your `MCP_AUTH_TOKEN` and host).

## Example Queries

- "How did my workout go today?"
- "What's my recovery like this morning?"
- "Show me my fitness trends for the last month"
- "How has my HRV trended compared to my training load?"
- "What's my power curve for the last 90 days?"
- "Show me my running pace curve—what's my best 5km time?"
- "How has my weight changed over the last 30 days?"
- "Sync my TrainerRoad runs to Intervals.icu"
- "What's the weather like for my race in Boulder next Saturday?"

## MCP Client Compatibility Notes

Tested with Claude and ChatGPT. Notes:

- **Tool responses**: Every tool declares an `outputSchema` per the [2025-11-25 MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). The payload is returned as `structuredContent` and also serialized into `content` for older clients. Field descriptions are delivered via `tools/list`, not embedded per response.
- **`_meta` fields**: ChatGPT [provides](https://developers.openai.com/apps-sdk/reference#_meta-fields-the-client-provides) `_meta` (location, locale, etc.) on tool inputs; Claude doesn't.
