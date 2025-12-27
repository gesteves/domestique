/**
 * Stream data response from Intervals.icu API for temperature.
 */
interface StreamDataPoint {
  type: string;
  data: number[];
}

/**
 * Temperature metrics calculated from stream data
 */
export interface TemperatureMetrics {
  min_ambient_temperature: number;
  max_ambient_temperature: number;
  avg_ambient_temperature: number;
  start_ambient_temperature: number;
  end_ambient_temperature: number;
}

/**
 * Parse stream data response from Intervals.icu API for temperature.
 *
 * @param streams - Array of stream data from the API
 * @returns Object with time and temp arrays, or null if temperature data not available
 */
export function parseTemperatureStreams(
  streams: StreamDataPoint[]
): { time: number[]; temp: number[] } | null {
  const timeStream = streams.find((s) => s.type === 'time');
  const tempStream = streams.find((s) => s.type === 'temp');

  if (!timeStream || !tempStream) {
    return null;
  }

  return {
    time: timeStream.data,
    temp: tempStream.data,
  };
}

/**
 * Calculate comprehensive temperature metrics from activity stream data.
 *
 * @param timeData - Array of time values in seconds
 * @param tempData - Array of temperature values in Celsius (aligned with timeData)
 * @returns Temperature metrics including min, max, avg, start, and end
 */
export function calculateTemperatureMetrics(
  timeData: number[],
  tempData: number[]
): TemperatureMetrics {
  if (timeData.length !== tempData.length) {
    throw new Error('Time and temperature data arrays must have the same length');
  }

  // Calculate min and max temperature
  const minTemp = tempData.length > 0 ? Math.min(...tempData) : 0;
  const maxTemp = tempData.length > 0 ? Math.max(...tempData) : 0;

  // Calculate average temperature
  const avgTemp = tempData.length > 0
    ? tempData.reduce((sum, temp) => sum + temp, 0) / tempData.length
    : 0;

  // Start is first value, end is last value
  const startTemp = tempData.length > 0 ? tempData[0] : 0;
  const endTemp = tempData.length > 0 ? tempData[tempData.length - 1] : 0;

  return {
    min_ambient_temperature: Math.round(minTemp * 10) / 10, // Round to 1 decimal
    max_ambient_temperature: Math.round(maxTemp * 10) / 10, // Round to 1 decimal
    avg_ambient_temperature: Math.round(avgTemp * 10) / 10, // Round to 1 decimal
    start_ambient_temperature: Math.round(startTemp * 10) / 10, // Round to 1 decimal
    end_ambient_temperature: Math.round(endTemp * 10) / 10, // Round to 1 decimal
  };
}
