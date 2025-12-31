# Domestique

A TypeScript MCP (Model Context Protocol) server that integrates with [Intervals.icu](https://intervals.icu), [Whoop](https://www.whoop.com), and [TrainerRoad](https://www.trainerroad.com) to provide unified access to fitness data across all activities and sports.

## Features

- Query completed workouts from Intervals.icu with matched Whoop strain data
- Access sleep and recovery metrics (HRV, sleep, recovery score) from Whoop
- View planned workouts from TrainerRoad and Intervals.icu
- Analyze fitness trends (CTL/ATL/TSB)
- Comprehensive workout analysis with intervals, notes, and weather data
- Incorporates heat strain data recorded from a [CORE Body Temperature](https://corebodytemp.com/) sensor for analysis

**Note:** Due to Strava API restrictions, workouts imported from Strava to Intervals.icu cannot be analyzed. To work around this, ensure that workouts are synced to Intervals.icu from other sources (Zwift, Garmin Connect, Dropbox, etc.)

## Available Tools

### Daily Overview
- `get_daily_summary` - Complete snapshot of today including recovery, strain, fitness metrics (CTL/ATL/TSB), wellness, completed workouts, planned workouts, and today's race, if any

### Today's Data
- `get_todays_recovery` - Today's Whoop recovery, sleep, and HRV data
- `get_todays_strain` - Today's Whoop strain data including strain score, heart rate, and logged activities
- `get_todays_completed_workouts` - Today's completed workouts from Intervals.icu with matched Whoop strain data
- `get_todays_planned_workouts` - Today's scheduled workouts from both TrainerRoad and Intervals.icu calendars

### Profile & Settings
- `get_athlete_profile` - Athlete's profile including unit preferences (metric/imperial), age, and location
- `get_sports_settings` - Sport-specific settings (FTP, zones, thresholds) for cycling, running, or swimming

### Historical/Trends
- `get_strain_history` - Whoop strain scores and activities for a date range
- `get_workout_history` - Historical workouts with matched Whoop strain data
- `get_recovery_trends` - HRV, sleep, and recovery patterns over time
- `get_wellness_trends` - Wellness data trends (weight) over a date range
- `get_activity_totals` - Aggregated activity totals over a date range, including duration, distance, training load, and zone distributions by sport

### Planning
- `get_upcoming_workouts` - Planned workouts for a future date range from both TrainerRoad and Intervals.icu calendars
- `get_planned_workout_details` - Detailed information about a specific planned workout for a future date
- `get_upcoming_races` - Upcoming races from the TrainerRoad calendar (only triathlons for now)

### Analysis
- `get_training_load_trends` - Training load trends including CTL (fitness), ATL (fatigue), TSB (form), ramp rate, and ACWR
- `get_workout_intervals` - Detailed interval breakdown for a specific workout including power, HR, cadence, and timing data
- `get_workout_weather` - Weather conditions during a specific outdoor workout
- `get_workout_heat_zones` - Heat zone analysis for a specific workout showing time spent in each heat strain zone

### Performance Curves
- `get_power_curve` - Cycling power curve analysis showing best watts at various durations with W/kg, estimated FTP, and period comparison
- `get_pace_curve` - Running/swimming pace curve analysis showing best times at key distances
- `get_hr_curve` - Heart rate curve analysis showing max sustained HR at various durations

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

### Whoop OAuth Setup

Whoop uses OAuth 2.0, which requires a one-time authorization flow to obtain refresh tokens. The refresh tokens are single-use, so each time the server refreshes the access token, it receives a new refresh token that gets stored in Redis.

**First-time setup:**

1. Create a Whoop developer app at https://developer.whoop.com to get your `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET`

2. Make sure Redis is running and `REDIS_URL` is set in your `.env`

3. Start the Docker environment:
   ```bash
   docker compose up -d
   ```

4. Run the OAuth setup script:
   ```bash
   docker compose exec domestique npm run whoop:auth
   ```

5. The script will display an authorization URL. Open it in your browser and log in to Whoop

6. After authorizing, you'll be redirected to a callback page that displays your authorization code

7. Copy the authorization code and paste it into the script

8. The script exchanges the code for tokens and stores them in Redis. You're done!

The server will automatically refresh tokens as needed and store new refresh tokens in Redis.

## Common Commands

### Docker Commands

All commands should be run in the Docker container:

```bash
# Start development server with hot reload
docker compose up

# Start in background
docker compose up -d

# View logs
docker compose logs domestique -f

# Restart container
docker compose restart domestique

# Stop containers
docker compose down

# Rebuild containers after dependency changes
docker compose build

# Run commands in container
docker compose exec domestique <command>

# Examples:
docker compose exec domestique npm run typecheck
docker compose exec domestique npm run whoop:auth
```

### Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a useful tool for testing and debugging your MCP server:

```bash
# Install MCP Inspector globally (if not already installed)
npm install -g @modelcontextprotocol/inspector

# Run inspector pointing to your local server
npx @modelcontextprotocol/inspector --server-url "http://localhost:3000/mcp?token=YOUR_SECRET_TOKEN"

# Or with Authorization header
npx @modelcontextprotocol/inspector --server-url "http://localhost:3000/mcp" \
  --header "{ \"Authorization\": \"Bearer YOUR_SECRET_TOKEN\" }"
```

The inspector will open a web interface where you can:
- Browse available tools
- Test tool calls with different parameters
- View request/response payloads
- Debug connection issues

## Local Development

### Using Docker Compose (recommended)

```bash
# Start development server with hot reload
docker compose up

# Server runs at http://localhost:3000
```

### Using Node.js directly

```bash
# Install dependencies
npm install

# Run in development mode with hot reload
npm run dev

# Or build and run production
npm run build
npm start
```

## Deployment to Fly.io

### 1. Install Fly CLI and Login

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 2. Deploy Redis

Redis is required for Whoop token storage. Deploy it first:

```bash
cd fly-redis

# Create the Redis app (first time only)
fly apps create domestique-redis

# Create a volume for persistence
fly volumes create redis_data --region iad --size 1

# Deploy Redis
fly deploy

cd ..
```

### 3. Deploy Domestique

```bash
# Create the app (first time only)
fly apps create domestique

# Set secrets
fly secrets set MCP_AUTH_TOKEN=your-secret-token
fly secrets set INTERVALS_API_KEY=your-api-key
fly secrets set INTERVALS_ATHLETE_ID=your-athlete-id
fly secrets set WHOOP_CLIENT_ID=your-client-id
fly secrets set WHOOP_CLIENT_SECRET=your-client-secret
fly secrets set REDIS_URL=redis://domestique-redis.internal:6379

# Deploy
fly deploy

# View logs
fly logs
```

### 4. Set Up Whoop Tokens (if using Whoop)

After deploying, run the OAuth setup to get initial Whoop tokens:

```bash
fly ssh console -C "npm run whoop:auth"
```

The redirect URI is automatically set to `https://{your-app}.fly.dev/callback` when running on Fly.io. Make sure this URL is registered in your Whoop developer app settings.

Follow the prompts to authorize with Whoop and store the tokens in Redis.

## Connecting to Claude

Add this MCP server as a connector to your Claude configuration using this URL:

```
https://{FLY_APP_NAME}.fly.dev/mcp?token=YOUR_SECRET_TOKEN
```

**Note:** Replace `YOUR_SECRET_TOKEN` with your actual `MCP_AUTH_TOKEN` value and `FLY_APP_NAME` with the name of the Fly.io app (or the URL wherever you have it hosted). 

## Example Queries

Once connected, you can ask Claude:

- "How did my workout go today?"
- "What's my recovery like this morning?"
- "Show me my fitness trends for the last month"
- "What workouts do I have planned this week?"
- "How has my HRV trended compared to my training load?"
- "What workout do I have scheduled for next Wednesday?"
- "Show me my workouts from last Friday"
- "How many workouts did I complete in the last 2 weeks?"
- "What was my training load in the last 42 days?"
- "What's my power curve for the last 90 days?"
- "How has my 5-minute power improved compared to last quarter?"
- "Show me my running pace curve—what's my best 5km time?"
- "Compare my cycling power from the last 3 months vs the previous 3 months"
- "What's my FTP?"
- "What are my running zones?"
- "How has my weight changed over the last 30 days?"
- "What are my swimming, cycling and running totals for the past month?"
- "How much time did I spend in each power zone this month?"
