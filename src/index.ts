import { validateEnvironment, getConfig } from './auth/middleware.js';
import { startServer } from './server.js';
import { initBugsnag, logInfo, logError } from './utils/logger.js';

async function main() {
  try {
    // Initialize error reporting
    initBugsnag();

    // Validate environment variables before starting
    validateEnvironment();

    const config = getConfig();

    logInfo('Startup', 'Starting Domestique MCP Server...');
    logInfo('Startup', `Intervals.icu: configured for athlete ${config.intervals.athleteId}`);
    logInfo('Startup', `Whoop: ${config.whoop ? 'configured' : 'not configured'}`);
    logInfo('Startup', `TrainerRoad: ${config.trainerRoad ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Last.fm: ${config.lastfm ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Google Weather: ${config.googleWeather ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Google Air Quality: ${config.googleAirQuality ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Google Pollen: ${config.googlePollen ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Google Elevation: ${config.googleElevation ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Google Geocoding: ${config.googleGeocoding ? 'configured' : 'not configured'}`);
    logInfo('Startup', `Google Time Zone: ${config.googleTimezone ? 'configured' : 'not configured'}`);

    await startServer({ port: config.port });
  } catch (error) {
    logError('Startup', 'Failed to start server', error);
    process.exit(1);
  }
}

main();
