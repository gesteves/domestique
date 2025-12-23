# Domestique

A TypeScript MCP (Model Context Protocol) server that integrates with Intervals.icu, Whoop, and TrainerRoad to provide unified access to fitness data across all activities and sports.

## Features

- Query completed workouts from Intervals.icu
- Access recovery metrics (HRV, sleep, recovery score) from Whoop
- View planned workouts from TrainerRoad and Intervals.icu calendars
- Analyze fitness trends (CTL/ATL/TSB)
- Cross-platform activity matching

## Available Tools

### Current/Recent Data
- `get_todays_recovery` - Today's Whoop recovery, sleep, and HRV data
- `get_recent_workouts` - Completed workouts from Intervals.icu with matched Whoop strain data. Returns expanded metrics including speed, cadence, efficiency, power data, and per-activity fitness snapshot
- `get_recent_strain` - Whoop strain scores and activities for the specified number of days
- `get_todays_planned_workouts` - Today's scheduled workouts from both TrainerRoad and Intervals.icu calendars
- `get_athlete_profile` - Athlete profile from Intervals.icu including power zones, heart rate zones, pace zones, and current threshold values (FTP, LTHR, max HR, W', Pmax) for each configured sport

### Historical/Trends
- `get_workout_history` - Historical workouts with flexible date ranges. Supports ISO dates or natural language (e.g., "30 days ago")
- `get_recovery_trends` - HRV, sleep, and recovery patterns over time with summary statistics
- `get_training_load_trends` - Training load trends including CTL (fitness), ATL (fatigue), TSB (form), ramp rate, and Acute:Chronic Workload Ratio (ACWR) for injury risk assessment. Returns daily data sorted oldest to newest. ACWR between 0.8-1.3 is optimal; above 1.5 indicates high injury risk

### Planning
- `get_upcoming_workouts` - Planned workouts for a future date range from both TrainerRoad and Intervals.icu calendars
- `get_planned_workout_details` - Detailed information about a specific planned workout by ID or date

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
- `MCP_AUTH_TOKEN` - Secret token for MCP authentication

For Intervals.icu integration:
- `INTERVALS_API_KEY` - Your Intervals.icu API key
- `INTERVALS_ATHLETE_ID` - Your Intervals.icu athlete ID

For Whoop integration:
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`
- `WHOOP_REDIRECT_URI` - Defaults to `http://localhost:3000/callback`
- `REDIS_URL` - Required for token storage (e.g., `redis://localhost:6379`)

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

6. After authorizing, you'll be redirected to a URL like:
   ```
   http://localhost:3000/callback?code=AUTHORIZATION_CODE
   ```

7. Copy the `code` parameter value and paste it into the script

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

The MCP Inspector is a useful tool for testing and debugging your MCP server:

```bash
# Install MCP Inspector globally (if not already installed)
npm install -g @modelcontextprotocol/inspector

# Run inspector pointing to your local server
npx @modelcontextprotocol/inspector http://localhost:3000/mcp?token=YOUR_SECRET_TOKEN

# Or with Authorization header (if your terminal supports it)
npx @modelcontextprotocol/inspector http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_SECRET_TOKEN"
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

Follow the prompts to authorize with Whoop and store the tokens in Redis.

## Connecting to Claude

Add this MCP server to your Claude configuration. The server supports two authentication methods:

### Method 1: Authorization Header (Recommended)

```json
{
  "mcpServers": {
    "domestique": {
      "url": "https://domestique.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_TOKEN"
      }
    }
  }
}
```

### Method 2: Query Parameter (For Claude UI)

If you're using Claude's custom connector UI (which doesn't support custom headers), use the query parameter method:

```json
{
  "mcpServers": {
    "domestique": {
      "url": "https://domestique.fly.dev/mcp?token=YOUR_SECRET_TOKEN"
    }
  }
}
```

**Note:** Replace `YOUR_SECRET_TOKEN` with your actual `MCP_AUTH_TOKEN` value.

## Example Queries

Once connected, you can ask Claude:

- "How did my workout go today?"
- "What's my recovery like this morning?"
- "Show me my fitness trends for the last month"
- "What workouts do I have planned this week?"
- "How has my HRV trended compared to my training load?"
