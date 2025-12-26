# Agent Instructions

This document contains everything an AI agent needs to know to work on this repository.

## Project Overview

Domestique is a TypeScript MCP (Model Context Protocol) server that integrates with fitness platforms:
- **Intervals.icu** - Training data, workouts, fitness metrics (CTL/ATL/TSB)
- **Whoop** - Recovery, HRV, sleep, strain data
- **TrainerRoad** - Planned workouts via iCal feed

## Development Environment

### Commands Run in Docker

This project uses Docker Compose for development. When possible, run commands in Docker, and not directly on the host machine, like so:

```bash
docker compose exec domestique <command>
```

Examples:
```bash
# Type checking
docker compose exec domestique npm run typecheck

# Run dev server (already running via docker compose up)
docker compose up

# View logs
docker compose logs domestique -f

# Restart after code changes (hot reload is enabled, but sometimes needed)
docker compose restart domestique
```

If any commands need to be run directly on the host machine, run `nvm use` first to ensure you're using the correct version of Node, defined in @.nvmrc.

### Starting Development

```bash
# Start all services (domestique + redis)
docker compose up

# Or in background
docker compose up -d
```

The development server runs on `http://localhost:3000` with hot reload enabled.

### Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `domestique` | 3000 | Main MCP server (dev mode with hot reload) |
| `domestique-prod` | 3001 | Production-like build (use `--profile prod`) |
| `redis` | 6379 | Token storage for Whoop OAuth |

### Claude Code on the Web

When using Claude Code on the Web, Docker is not available in the cloud environment. Commands should be run directly using Node.js:

```bash
# Install dependencies (done automatically via SessionStart hook)
npm install

# Run tests
npm test

# Type checking
npm run typecheck

# Build
npm run build
```

## MCP Transport

The server uses Streamable HTTP Transport:

- Single endpoint: `/mcp`
- Authentication: `Authorization: Bearer <token>` header or `?token=<token>` query param
- Session management via `mcp-session-id` header
- Session termination via `DELETE /mcp` endpoint

## Environment Variables

Required in `.env`:
```bash
MCP_AUTH_TOKEN=          # Secret token for MCP authentication
INTERVALS_API_KEY=       # Intervals.icu API key
INTERVALS_ATHLETE_ID=    # Intervals.icu athlete ID
```

Optional:
```bash
# Whoop (requires all three + Redis)
WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=
WHOOP_REDIRECT_URI=        # OAuth redirect URI (defaults to http://localhost:3000/callback)
REDIS_URL=redis://redis:6379

# TrainerRoad
TRAINERROAD_CALENDAR_URL=  # Private iCal feed URL
```

## Testing

Tests are in the `tests/` directory mirroring `src/` structure.

```bash
# Tests must run with the test Docker target or locally (not in dev container)
# The dev container doesn't mount the tests/ directory

# Run tests locally
nvm use && npm test

# Or build and run test container
docker build --target test -t domestique-test .
docker run domestique-test
```

**Note:** The dev container only mounts `src/` and `tsconfig.json` for hot reload. Tests directory is not mounted.

## Common Tasks

### Adding a New Tool

1. Add tool implementation in appropriate file (`tools/current.ts`, `tools/historical.ts`, or `tools/planning.ts`)
2. Register in `tools/index.ts` in the `registerTools()` method
3. Add any new API methods to the relevant client (`clients/*.ts`)
4. Ensure the new tool, any new API methods to the existing clients, and/or new clients have extensive test coverage.
5. Ensure the tool description and field descriptions are accurate.
6. Ensure the new tool is represented in the @README.md file.

### Adding a New API Client

1. Create client in `src/clients/`
2. Add configuration in `src/auth/middleware.ts` `getConfig()`
3. Add to `ToolRegistry` constructor in `src/tools/index.ts`
4. Update environment validation if required

### Debugging

```bash
# View container logs
docker compose logs domestique -f

# Check health
curl http://localhost:3000/health

# Test auth
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Code Style

- Use TypeScript strict mode
- Async/await over promises
- Descriptive error messages with context
- JSDoc comments for public APIs
- No default exports (use named exports)

## Important Notes

1. **Whoop uses OAuth** - Tokens stored in Redis, refreshed automatically. Initial setup requires running `npm run whoop:auth` interactively.
2. **Hot reload** - The dev container uses `tsx watch` for hot reload of `src/` files.
3. **express.json() middleware** - Used for Streamable HTTP transport to parse JSON request bodies.
4. **Tool registry is shared** - Created once at server start, but each MCP session gets its own `McpServer` instance.
5. When making changes, ensure that @README.md is up to date.
6. When adding new tools or modifying existing ones, ensure that the tool descriptions and the field descriptions are up to date.
7. Always ensure tests pass with `nvm use && npm test` and always add tests for new functionality.
