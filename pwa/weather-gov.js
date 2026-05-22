/**
 * weather-gov.js — National Weather Service API client
 *
 * Provides current observations, 7-day hourly forecasts, and active alerts
 * via the free, public api.weather.gov. US locations only.
 *
 * Flow:
 *   1. resolvePoint(lat, lon) → { wfo, gridX, gridY, stationId, zone }
 *   2. fetchCurrentObs(stationId) → current conditions snapshot
 *   3. fetchHourlyForecast(wfo, gridX, gridY) → next 7 days hourly
 *   4. fetchAlerts(lat, lon) → active weather alerts
 *   5. fetchForecastDaily(wfo, gridX, gridY) → 7-day daily summary
 *
 * All responses are transformed to a common format matching the Rust engine
 * Environment struct fields (temp_high_c, temp_low_c, humidity_pct, etc.)
 *
 * US-only: resolvePoint will throw for non-US coordinates.
 * The caller (weather.js) should catch and fall back to Open-Meteo.
 */

const API_BASE = 'https://api.weather.gov';
const USER_AGENT = 'companion-garden-app (github.com/JoshuaWink/companion-plant-app-v2)';
const POINT_CACHE_KEY = 'nws-point-cache';
const POINT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — grid rarely changes

// ── API helpers ──

async function nwsFetch(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/geo+json',
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`NWS API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

// ── Point resolution (lat/lon → grid + station) ──

/**
 * Resolve a lat/lon to NWS grid coordinates and nearest station.
 * Caches in localStorage because grid assignments are stable.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{wfo: string, gridX: number, gridY: number, stationId: string, zone: string, county: string}>}
 */
export async function resolvePoint(lat, lon) {
  const cacheKey = `${POINT_CACHE_KEY}-${lat.toFixed(2)}_${lon.toFixed(2)}`;

  // Check cache
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < POINT_CACHE_MAX_AGE_MS) return data;
    }
  } catch { /* ignore */ }

  // Fetch point metadata
  const pointData = await nwsFetch(`${API_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const props = pointData.properties;

  // Find nearest observation station
  const stationsData = await nwsFetch(props.observationStations);
  const stations = stationsData.features || stationsData.observationStations || [];
  const stationId = stations.length > 0
    ? (stations[0].properties?.stationIdentifier || stations[0].split('/').pop())
    : null;

  const result = {
    wfo: props.gridId,
    gridX: props.gridX,
    gridY: props.gridY,
    stationId,
    zone: props.forecastZone?.split('/').pop() || '',
    county: props.county?.split('/').pop() || '',
  };

  // Cache
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: result }));
  } catch { /* quota */ }

  return result;
}

// ── Current observations ──

/**
 * Fetch the latest observation from a weather station.
 * Returns a snapshot with units matching our Rust engine.
 *
 * @param {string} stationId — e.g. "KTAN"
 * @returns {Promise<{timestamp: string, temp_c: number, dewpoint_c: number, humidity_pct: number, wind_speed_ms: number, wind_dir_deg: number, pressure_hpa: number, precip_mm: number|null, visibility_m: number, description: string}>}
 */
export async function fetchCurrentObs(stationId) {
  const data = await nwsFetch(`${API_BASE}/stations/${stationId}/observations/latest`);
  const p = data.properties;

  return {
    timestamp: p.timestamp,
    temp_c: qvValue(p.temperature),
    dewpoint_c: qvValue(p.dewpoint),
    humidity_pct: qvValue(p.relativeHumidity),
    wind_speed_ms: convertWind(qvValue(p.windSpeed), qvUnit(p.windSpeed)),
    wind_dir_deg: qvValue(p.windDirection),
    pressure_hpa: convertPressure(qvValue(p.barometricPressure), qvUnit(p.barometricPressure)),
    precip_mm: qvValue(p.precipitationLastHour) ?? qvValue(p.precipitationLast3Hours),
    visibility_m: qvValue(p.visibility),
    description: p.textDescription || '',
    cloud_layers: (p.cloudLayers || []).map(l => ({
      base_m: qvValue(l.base),
      coverage: l.amount, // OVC, BKN, SCT, FEW, SKC, CLR
    })),
  };
}

// ── Hourly forecast ──

/**
 * Fetch hourly forecast (next ~156 hours / 7 days).
 * Returns array of hourly periods with our common format.
 *
 * @param {string} wfo — forecast office ID
 * @param {number} gridX
 * @param {number} gridY
 * @returns {Promise<Array<{start: string, temp_c: number, humidity_pct: number, dewpoint_c: number, wind_speed_ms: number, wind_dir: string, precip_prob: number, sky_cover: string, description: string}>>}
 */
export async function fetchHourlyForecast(wfo, gridX, gridY) {
  const data = await nwsFetch(`${API_BASE}/gridpoints/${wfo}/${gridX},${gridY}/forecast/hourly?units=si`);
  const periods = data.properties?.periods || [];

  return periods.map(p => ({
    start: p.startTime,
    temp_c: typeof p.temperature === 'object' ? qvValue(p.temperature) : p.temperature,
    humidity_pct: qvValue(p.relativeHumidity),
    dewpoint_c: qvValue(p.dewpoint),
    wind_speed_ms: parseWindSpeed(p.windSpeed),
    wind_dir: p.windDirection || '',
    precip_prob: qvValue(p.probabilityOfPrecipitation) ?? 0,
    description: p.shortForecast || '',
    is_daytime: p.isDaytime,
  }));
}

/**
 * Aggregate hourly forecast into daily summaries matching our engine format.
 * Groups hours by date, computes daily high/low, avg humidity, total precip prob, etc.
 *
 * @param {Array} hourlyPeriods — from fetchHourlyForecast
 * @returns {Array<{date: string, temp_high_c: number, temp_low_c: number, humidity_pct: number, wind_speed_ms: number, precip_prob: number, description: string}>}
 */
export function aggregateHourlyToDaily(hourlyPeriods) {
  const byDate = {};

  for (const h of hourlyPeriods) {
    const date = h.start.slice(0, 10); // YYYY-MM-DD
    if (!byDate[date]) {
      byDate[date] = { temps: [], humidities: [], winds: [], precipProbs: [], descs: [] };
    }
    const d = byDate[date];
    if (h.temp_c != null) d.temps.push(h.temp_c);
    if (h.humidity_pct != null) d.humidities.push(h.humidity_pct);
    if (h.wind_speed_ms != null) d.winds.push(h.wind_speed_ms);
    if (h.precip_prob != null) d.precipProbs.push(h.precip_prob);
    if (h.description && h.is_daytime) d.descs.push(h.description);
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      temp_high_c: d.temps.length > 0 ? Math.max(...d.temps) : null,
      temp_low_c: d.temps.length > 0 ? Math.min(...d.temps) : null,
      humidity_pct: d.humidities.length > 0
        ? +(d.humidities.reduce((a, b) => a + b, 0) / d.humidities.length).toFixed(1)
        : null,
      wind_speed_ms: d.winds.length > 0
        ? +(d.winds.reduce((a, b) => a + b, 0) / d.winds.length).toFixed(1)
        : null,
      precip_prob: d.precipProbs.length > 0
        ? Math.max(...d.precipProbs)
        : 0,
      precip_mm: null, // Forecast doesn't give exact mm
      sunshine_hours: null, // Not available from NWS hourly
      description: [...new Set(d.descs)].join(', '),
      source: 'nws',
    }));
}

// ── Daily forecast (7-day, 12h periods) ──

/**
 * Fetch the 7-day daily forecast (12-hour periods: day/night).
 * Returns day-level summaries with narrative text.
 *
 * @param {string} wfo
 * @param {number} gridX
 * @param {number} gridY
 * @returns {Promise<Array<{name: string, start: string, temp_c: number, is_daytime: boolean, wind_speed_ms: number, wind_dir: string, precip_prob: number, short_forecast: string, detailed: string}>>}
 */
export async function fetchDailyForecast(wfo, gridX, gridY) {
  const data = await nwsFetch(`${API_BASE}/gridpoints/${wfo}/${gridX},${gridY}/forecast?units=si`);
  const periods = data.properties?.periods || [];

  return periods.map(p => ({
    name: p.name || '',
    start: p.startTime,
    temp_c: typeof p.temperature === 'object' ? qvValue(p.temperature) : p.temperature,
    is_daytime: p.isDaytime,
    wind_speed_ms: parseWindSpeed(p.windSpeed),
    wind_dir: p.windDirection || '',
    precip_prob: qvValue(p.probabilityOfPrecipitation) ?? 0,
    short_forecast: p.shortForecast || '',
    detailed: p.detailedForecast || '',
  }));
}

// ── Alerts ──

/**
 * Fetch active weather alerts for a location.
 * Filters to agriculture-relevant alerts by default.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Array<{event: string, severity: string, urgency: string, headline: string, description: string, instruction: string, onset: string, expires: string}>>}
 */
export async function fetchAlerts(lat, lon) {
  const data = await nwsFetch(
    `${API_BASE}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual`
  );
  const features = data.features || [];

  return features.map(f => {
    const p = f.properties;
    return {
      event: p.event || '',
      severity: p.severity || 'Unknown',
      urgency: p.urgency || 'Unknown',
      headline: p.headline || '',
      description: p.description || '',
      instruction: p.instruction || '',
      onset: p.onset || p.effective || '',
      expires: p.expires || '',
    };
  });
}

/**
 * Filter alerts to those relevant to agriculture/gardening.
 * @param {Array} alerts — from fetchAlerts
 * @returns {Array} — filtered alerts
 */
export function filterCropAlerts(alerts) {
  const CROP_EVENTS = [
    'Frost Advisory', 'Freeze Warning', 'Freeze Watch',
    'Hard Freeze Warning', 'Hard Freeze Watch',
    'Heat Advisory', 'Excessive Heat Warning', 'Excessive Heat Watch',
    'Flood Warning', 'Flood Watch', 'Flash Flood Warning', 'Flash Flood Watch',
    'Wind Advisory', 'High Wind Warning', 'High Wind Watch',
    'Severe Thunderstorm Warning', 'Severe Thunderstorm Watch',
    'Tornado Warning', 'Tornado Watch',
    'Winter Storm Warning', 'Winter Storm Watch',
    'Ice Storm Warning', 'Blizzard Warning',
    'Dense Fog Advisory',
    'Red Flag Warning', 'Fire Weather Watch',
    'Drought',
  ];

  return alerts.filter(a =>
    CROP_EVENTS.some(e => a.event.toLowerCase().includes(e.toLowerCase()))
    || a.severity === 'Extreme'
    || a.severity === 'Severe'
  );
}

// ── Unit conversion helpers ──

/** Extract numeric value from QuantitativeValue object or number */
function qvValue(qv) {
  if (qv == null) return null;
  if (typeof qv === 'number') return qv;
  if (typeof qv === 'object' && 'value' in qv) return qv.value;
  return null;
}

/** Extract unit string from QuantitativeValue */
function qvUnit(qv) {
  if (qv == null) return '';
  if (typeof qv === 'object' && 'unitCode' in qv) return qv.unitCode || '';
  return '';
}

/** Convert wind speed to m/s */
function convertWind(value, unit) {
  if (value == null) return null;
  if (unit.includes('km_h') || unit.includes('km/h')) return +(value / 3.6).toFixed(1);
  if (unit.includes('kt') || unit.includes('knot')) return +(value * 0.5144).toFixed(1);
  if (unit.includes('mi_h') || unit.includes('mph')) return +(value * 0.4470).toFixed(1);
  // Assume m/s if unrecognized
  return +value.toFixed(1);
}

/** Convert pressure to hPa */
function convertPressure(value, unit) {
  if (value == null) return null;
  if (unit.includes('Pa') && !unit.includes('hPa')) return +(value / 100).toFixed(1);
  return +value.toFixed(1);
}

/** Parse wind speed from string "8 mph" or "12 km/h" or QuantitativeValue */
function parseWindSpeed(ws) {
  if (ws == null) return null;
  if (typeof ws === 'object') return convertWind(qvValue(ws), qvUnit(ws));
  if (typeof ws === 'number') return ws;
  // String format: "8 mph" or "12 km/h"
  const match = String(ws).match(/([\d.]+)\s*(mph|km\/h|m\/s|kt)/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'mph') return +(val * 0.4470).toFixed(1);
  if (unit === 'km/h') return +(val / 3.6).toFixed(1);
  if (unit === 'kt') return +(val * 0.5144).toFixed(1);
  return val;
}

// ── Utility: check if coordinates are in US ──

/**
 * Quick check if coordinates are roughly within US bounds.
 * Weather.gov only covers US territories.
 */
export function isUSLocation(lat, lon) {
  // Continental US
  if (lat >= 24.5 && lat <= 49.5 && lon >= -125 && lon <= -66) return true;
  // Alaska
  if (lat >= 51 && lat <= 72 && lon >= -180 && lon <= -129) return true;
  // Hawaii
  if (lat >= 18.5 && lat <= 22.5 && lon >= -161 && lon <= -154) return true;
  // Puerto Rico / USVI
  if (lat >= 17.5 && lat <= 18.6 && lon >= -68 && lon <= -64) return true;
  // Guam
  if (lat >= 13 && lat <= 14 && lon >= 144 && lon <= 145) return true;
  return false;
}
