import { validateEnvironment, getConfig } from './auth/middleware.js';
import { startServer } from './server.js';

async function main() {
  try {
    // Validate environment variables before starting
    validateEnvironment();

    const config = getConfig();

    console.log('Starting Domestique MCP Server...');
    console.log(`Intervals.icu: configured for athlete ${config.intervals.athleteId}`);
    console.log(`Whoop: ${config.whoop ? 'configured' : 'not configured'}`);
    console.log(`TrainerRoad: ${config.trainerRoad ? 'configured' : 'not configured'}`);

    await startServer({ port: config.port });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
