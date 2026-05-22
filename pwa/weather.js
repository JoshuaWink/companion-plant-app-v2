/**
 * weather.js — Unified weather service
 *
 * Multi-source architecture:
 *   Past (historical):   Open-Meteo archive API (free, back to 1940)
 *   Present (current):   Weather.gov station observations (US) or Open-Meteo (non-US)
 *   Future (forecast):   Weather.gov hourly forecast (US) or Open-Meteo forecast (non-US)
 *   Alerts:              Weather.gov active alerts (US only)
 *
 * All methods return data in a common format matching the Rust engine's
 * Environment struct fields.
 */

import {
  resolvePoint,
  fetchCurrentObs,
  fetchHourlyForecast,
  aggregateHourlyToDaily,
  fetchDailyForecast,
  fetchAlerts,
  filterCropAlerts,
  isUSLocation,
} from './weather-gov.js';

// ── API endpoints ──
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_PREFIX = 'weather-cache-';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── NWS point resolution cache (module-level) ──
let _nwsPoint = null;
let _nwsPointKey = '';

/**
 * Resolve NWS point for a location, with module-level caching.
 * Returns null for non-US locations.
 */
async function getNwsPoint(lat, lon) {
  if (!isUSLocation(lat, lon)) return null;

  const key = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  if (_nwsPointKey === key && _nwsPoint) return _nwsPoint;

  try {
    _nwsPoint = await resolvePoint(lat, lon);
    _nwsPointKey = key;
    return _nwsPoint;
  } catch (err) {
    console.warn('NWS point resolution failed, using Open-Meteo:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// PAST — Historical daily weather
// ═══════════════════════════════════════════════════════

/**
 * Fetch daily weather data for a location and date range.
 * Always uses Open-Meteo archive (Weather.gov has no historical API).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string} startDate  ISO date string (YYYY-MM-DD)
 * @param {string} endDate    ISO date string (YYYY-MM-DD)
 * @returns {Promise<{days: Array<{date, temp_high_c, temp_low_c, precip_mm, sunshine_hours, humidity_pct, wind_speed_ms}>}>}
 */
export async function fetchDailyWeather(lat, lon, startDate, endDate) {
  const cacheKey = buildCacheKey('archive', lat, lon, startDate, endDate);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration,relative_humidity_2m_mean,wind_speed_10m_max',
    temperature_unit: 'celsius',
    timezone: 'auto',
  });

  const resp = await fetch(`${ARCHIVE_URL}?${params}`);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Open-Meteo Archive ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const result = transformArchiveResponse(data);

  writeCache(cacheKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════
// PRESENT — Current conditions
// ═══════════════════════════════════════════════════════

/**
 * Get current weather conditions for a location.
 * Uses Weather.gov for US locations, Open-Meteo current for others.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{source: string, timestamp: string, temp_c: number, dewpoint_c: number|null, humidity_pct: number, wind_speed_ms: number, pressure_hpa: number|null, description: string, vpd_kpa: number|null}>}
 */
export async function fetchCurrentConditions(lat, lon) {
  const nws = await getNwsPoint(lat, lon);

  if (nws && nws.stationId) {
    try {
      const obs = await fetchCurrentObs(nws.stationId);
      return {
        source: 'nws',
        station: nws.stationId,
        ...obs,
        vpd_kpa: calcVpdFromDewpoint(obs.temp_c, obs.dewpoint_c),
      };
    } catch (err) {
      console.warn('NWS observation failed, trying Open-Meteo:', err.message);
    }
  }

  // Fallback: Open-Meteo current weather
  return fetchOpenMeteoCurrent(lat, lon);
}

// ═══════════════════════════════════════════════════════
// FUTURE — Forecast (next 7 days)
// ═══════════════════════════════════════════════════════

/**
 * Get daily forecast for the next 7 days.
 * Uses Weather.gov hourly → aggregated for US, Open-Meteo forecast for others.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{source: string, days: Array<{date, temp_high_c, temp_low_c, humidity_pct, wind_speed_ms, precip_mm, precip_prob, description}>}>}
 */
export async function fetchForecast(lat, lon) {
  const nws = await getNwsPoint(lat, lon);

  if (nws) {
    try {
      const cacheKey = buildCacheKey('forecast-nws', lat, lon, '', '');
      const cached = readCache(cacheKey, 3600000); // 1 hour cache for forecasts
      if (cached) return cached;

      const hourly = await fetchHourlyForecast(nws.wfo, nws.gridX, nws.gridY);
      const days = aggregateHourlyToDaily(hourly);
      const result = { source: 'nws', wfo: nws.wfo, days };

      writeCache(cacheKey, result, 3600000);
      return result;
    } catch (err) {
      console.warn('NWS forecast failed, trying Open-Meteo:', err.message);
    }
  }

  return fetchOpenMeteoForecast(lat, lon);
}

/**
 * Get detailed 7-day narrative forecast (NWS only).
 * Falls back to null for non-US locations.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Array<{name, detailed, temp_c, is_daytime}>|null>}
 */
export async function fetchNarrativeForecast(lat, lon) {
  const nws = await getNwsPoint(lat, lon);
  if (!nws) return null;

  try {
    return await fetchDailyForecast(nws.wfo, nws.gridX, nws.gridY);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// ALERTS — Active weather hazards
// ═══════════════════════════════════════════════════════

/**
 * Get active weather alerts relevant to crops/gardening.
 * US only — returns empty array for non-US locations.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Array<{event, severity, headline, description, instruction, onset, expires}>>}
 */
export async function fetchCropAlerts(lat, lon) {
  if (!isUSLocation(lat, lon)) return [];

  try {
    const cacheKey = buildCacheKey('alerts', lat, lon, '', '');
    const cached = readCache(cacheKey, 300000); // 5 minute cache for alerts
    if (cached) return cached;

    const all = await fetchAlerts(lat, lon);
    const crop = filterCropAlerts(all);

    writeCache(cacheKey, crop, 300000);
    return crop;
  } catch (err) {
    console.warn('Alert fetch failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════
// COMBINED — All weather data for growth simulator
// ═══════════════════════════════════════════════════════

/**
 * Fetch combined weather data for the growth simulator.
 * Returns historical + forecast + current + alerts in a unified response.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string} startDate — planting date ISO
 * @param {string} endDate — end of sim ISO
 * @param {number} weatherYear — year for historical data
 * @returns {Promise<{historical: {days}, forecast: {days}, current: object|null, alerts: Array, source: string}>}
 */
export async function fetchGrowthWeather(lat, lon, startDate, endDate, weatherYear) {
  const results = await Promise.allSettled([
    fetchDailyWeather(lat, lon, startDate, endDate),
    fetchForecast(lat, lon),
    fetchCurrentConditions(lat, lon),
    fetchCropAlerts(lat, lon),
  ]);

  return {
    historical: results[0].status === 'fulfilled' ? results[0].value : { days: [] },
    forecast: results[1].status === 'fulfilled' ? results[1].value : { source: 'none', days: [] },
    current: results[2].status === 'fulfilled' ? results[2].value : null,
    alerts: results[3].status === 'fulfilled' ? results[3].value : [],
    source: results[1].status === 'fulfilled' ? results[1].value.source : 'open-meteo',
  };
}

// ═══════════════════════════════════════════════════════
// Open-Meteo fallbacks
// ═══════════════════════════════════════════════════════

async function fetchOpenMeteoCurrent(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure',
    temperature_unit: 'celsius',
    timezone: 'auto',
  });

  try {
    const resp = await fetch(`${FORECAST_URL}?${params}`);
    if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
    const data = await resp.json();
    const c = data.current;

    return {
      source: 'open-meteo',
      station: null,
      timestamp: c.time,
      temp_c: c.temperature_2m,
      dewpoint_c: null,
      humidity_pct: c.relative_humidity_2m,
      wind_speed_ms: c.wind_speed_10m != null ? +(c.wind_speed_10m / 3.6).toFixed(1) : null,
      wind_dir_deg: c.wind_direction_10m,
      pressure_hpa: c.surface_pressure,
      description: '',
      vpd_kpa: null,
    };
  } catch {
    return null;
  }
}

async function fetchOpenMeteoForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max,precipitation_probability_max',
    temperature_unit: 'celsius',
    timezone: 'auto',
    forecast_days: '7',
  });

  try {
    const resp = await fetch(`${FORECAST_URL}?${params}`);
    if (!resp.ok) throw new Error(`Open-Meteo forecast ${resp.status}`);
    const data = await resp.json();
    const d = data.daily;

    const days = (d.time || []).map((date, i) => ({
      date,
      temp_high_c: d.temperature_2m_max?.[i] ?? null,
      temp_low_c: d.temperature_2m_min?.[i] ?? null,
      humidity_pct: d.relative_humidity_2m_mean?.[i] ?? null,
      wind_speed_ms: d.wind_speed_10m_max?.[i] != null
        ? +(d.wind_speed_10m_max[i] / 3.6).toFixed(1)
        : null,
      precip_mm: d.precipitation_sum?.[i] ?? 0,
      precip_prob: d.precipitation_probability_max?.[i] ?? 0,
      sunshine_hours: null,
      description: '',
      source: 'open-meteo',
    }));

    return { source: 'open-meteo', days };
  } catch {
    return { source: 'none', days: [] };
  }
}

// ── Transform helpers ──

function transformArchiveResponse(data) {
  const d = data.daily;
  if (!d || !d.time) return { days: [] };

  const days = d.time.map((date, i) => ({
    date,
    temp_high_c: d.temperature_2m_max?.[i] ?? null,
    temp_low_c: d.temperature_2m_min?.[i] ?? null,
    precip_mm: d.precipitation_sum?.[i] ?? 0,
    sunshine_hours: d.sunshine_duration?.[i] != null
      ? +(d.sunshine_duration[i] / 3600).toFixed(1)
      : null,
    humidity_pct: d.relative_humidity_2m_mean?.[i] ?? 0,
    wind_speed_ms: d.wind_speed_10m_max?.[i] != null
      ? +(d.wind_speed_10m_max[i] / 3.6).toFixed(1)
      : 2.0,
    source: 'open-meteo-archive',
  }));

  return { days };
}

/** Compute VPD from air temperature and dewpoint (both °C) */
function calcVpdFromDewpoint(tempC, dewC) {
  if (tempC == null || dewC == null) return null;
  const esAir = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const esDew = 0.6108 * Math.exp((17.27 * dewC) / (dewC + 237.3));
  return +Math.max(0, esAir - esDew).toFixed(2);
}

// ── Date helpers ──

/** Convert day-of-year + year to ISO date string. */
export function doyToDate(doy, year) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + doy - 1);
  return d.toISOString().slice(0, 10);
}

/** Parse ISO date string to day-of-year. */
export function dateToDoy(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d - start) / 86400000) + 1;
}

/** Get the most recent complete year suitable for historical queries. */
export function defaultWeatherYear() {
  const now = new Date();
  return now.getMonth() >= 5 ? now.getFullYear() - 1 : now.getFullYear() - 2;
}

// ── Cache helpers ──

function buildCacheKey(prefix, lat, lon, start, end) {
  return `${CACHE_PREFIX}${prefix}-${lat.toFixed(1)}_${lon.toFixed(1)}_${start}_${end}`;
}

function readCache(key, maxAge) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > (maxAge || CACHE_MAX_AGE_MS)) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeCache(key, data, maxAge) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // localStorage quota exceeded — silently ignore
  }
}
