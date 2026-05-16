/**
 * Barrel for the API client classes. Import clients from here
 * (`../clients/index.js`) rather than reaching into individual modules, so
 * adding or renaming a client touches one place. Client-specific types and
 * error classes still live in their own modules — import those directly.
 */
export { IntervalsClient } from './intervals.js';
export { WhoopClient } from './whoop.js';
export { TrainerRoadClient } from './trainerroad.js';
export { LastFmClient } from './lastfm.js';
export { GoogleWeatherClient } from './google-weather.js';
export { GoogleAirQualityClient } from './google-air-quality.js';
export { GooglePollenClient } from './google-pollen.js';
export { GoogleElevationClient } from './google-elevation.js';
export { GoogleGeocodingClient } from './google-geocoding.js';
export { GoogleTimezoneClient } from './google-timezone.js';
