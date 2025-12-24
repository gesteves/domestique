#!/usr/bin/env tsx
/**
 * Whoop OAuth Setup Script
 *
 * This script helps you obtain initial Whoop OAuth tokens.
 * Run with: npm run whoop:auth
 *
 * Requirements:
 * - WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in environment
 * - REDIS_URL for storing tokens
 *
 * Redirect URI is determined automatically:
 * - If FLY_APP_NAME is set: https://{FLY_APP_NAME}.fly.dev/callback
 * - If WHOOP_REDIRECT_URI is set: uses that value
 * - Otherwise: http://localhost:3000/callback
 */

import * as readline from 'readline';
import { storeWhoopTokens, getRedisClient, closeRedis } from '../utils/redis.js';

const WHOOP_AUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export function getRedirectUri(): string {
  // Use Fly.io URL if deployed there
  const flyAppName = process.env.FLY_APP_NAME;
  if (flyAppName) {
    return `https://${flyAppName}.fly.dev/callback`;
  }

  // Use explicit redirect URI if set
  if (process.env.WHOOP_REDIRECT_URI) {
    return process.env.WHOOP_REDIRECT_URI;
  }

  // Default to localhost
  return 'http://localhost:3000/callback';
}

async function main() {
  console.log('\n🏋️  Whoop OAuth Setup\n');

  // Check required environment variables
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redirectUri = getRedirectUri();
  const redisUrl = process.env.REDIS_URL;

  if (!clientId || !clientSecret) {
    console.error('❌ Missing required environment variables:');
    if (!clientId) console.error('   - WHOOP_CLIENT_ID');
    if (!clientSecret) console.error('   - WHOOP_CLIENT_SECRET');
    console.error('\nSet these in your .env file and try again.');
    process.exit(1);
  }

  if (!redisUrl) {
    console.error('❌ REDIS_URL is required to store tokens.');
    console.error('   Start Redis and set REDIS_URL in your .env file.');
    process.exit(1);
  }

  // Verify Redis connection
  try {
    const client = await getRedisClient();
    if (!client) {
      throw new Error('Failed to connect to Redis');
    }
    console.log('✅ Connected to Redis\n');
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    process.exit(1);
  }

  // Build authorization URL
  const { url: authUrl, state } = buildAuthorizationUrl(clientId, redirectUri);

  console.log('Step 1: Open this URL in your browser to authorize:\n');
  console.log(`   ${authUrl}\n`);
  console.log('Step 2: After authorizing, you\'ll be redirected to:');
  console.log(`   ${redirectUri}?code=AUTHORIZATION_CODE&state=${state}\n`);
  console.log('Step 3: Copy the authorization code from the URL (the "code" parameter).\n');

  // Prompt for authorization code
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise<string>((resolve) => {
    rl.question('Enter the authorization code: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!code) {
    console.error('❌ No authorization code provided.');
    await closeRedis();
    process.exit(1);
  }

  // Exchange code for tokens
  console.log('\n⏳ Exchanging code for tokens...');

  try {
    const tokens = await exchangeCodeForTokens(
      code,
      clientId,
      clientSecret,
      redirectUri
    );

    // Validate token response
    if (!tokens.access_token || !tokens.refresh_token) {
      console.error('\n❌ Invalid token response from Whoop API');
      console.error('   Response:', JSON.stringify(tokens, null, 2));
      await closeRedis();
      process.exit(1);
    }

    // Store tokens in Redis
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    const stored = await storeWhoopTokens({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    });

    if (!stored) {
      console.error('\n❌ Failed to store tokens in Redis');
      await closeRedis();
      process.exit(1);
    }

    console.log('\n✅ Success! Tokens have been stored in Redis.');
    console.log('\n   Access token expires in:', Math.round(tokens.expires_in / 60), 'minutes');
    console.log('   Refresh token stored permanently.');
    console.log('\n   You can now start the server - it will use these tokens automatically.\n');
  } catch (error) {
    console.error('\n❌ Failed to exchange code for tokens:', error);
    await closeRedis();
    process.exit(1);
  }

  await closeRedis();
}

function generateState(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let state = '';
  for (let i = 0; i < 32; i++) {
    state += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return state;
}

function buildAuthorizationUrl(clientId: string, redirectUri: string): { url: string; state: string } {
  const state = generateState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement',
    state,
  });

  return { url: `${WHOOP_AUTH_BASE}/auth?${params.toString()}`, state };
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TokenResponse> {
  const response = await fetch(`${WHOOP_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  return response.json() as Promise<TokenResponse>;
}

// Only run main() when executed directly, not when imported
const isMainModule = process.argv[1]?.endsWith('whoop-oauth.js') ||
                     process.argv[1]?.endsWith('whoop-oauth.ts');

if (isMainModule) {
  main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
