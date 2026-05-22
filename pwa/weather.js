/**
 * weather.js — Real weather data via Open-Meteo
 *
 * Free API, no key required, CORS-enabled.
 * Historical archive back to 1940, forecast up to 16 days.
 * Caches results in localStorage to avoid redundant fetches.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const CACHE_PREFIX = 'weather-cache-';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Fetch daily weather data for a location and date range.
 *
 * @param {number} lat  Latitude
 * @param {number} lon  Longitude
 * @param {string} startDate  ISO date string (YYYY-MM-DD)
 * @param {string} endDate    ISO date string (YYYY-MM-DD)
 * @returns {Promise<{days: Array<{date:string, temp_high_c:number, temp_low_c:number, precip_mm:number, sunshine_hours:number|null}>}>}
 */
export async function fetchDailyWeather(lat, lon, startDate, endDate) {
  const cacheKey = buildCacheKey(lat, lon, startDate, endDate);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration',
    temperature_unit: 'celsius',
    timezone: 'auto',
  });

  const resp = await fetch(`${ARCHIVE_URL}?${params}`);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Weather API ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const result = transformResponse(data);

  writeCache(cacheKey, result);
  return result;
}

/** Transform Open-Meteo response to our format. */
function transformResponse(data) {
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
  }));

  return { days };
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
  // If we're past June, last year is safe; otherwise two years ago
  return now.getMonth() >= 5 ? now.getFullYear() - 1 : now.getFullYear() - 2;
}

// ── Cache helpers ──

function buildCacheKey(lat, lon, start, end) {
  return `${CACHE_PREFIX}${lat.toFixed(1)}_${lon.toFixed(1)}_${start}_${end}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // localStorage quota exceeded — silently ignore
  }
}
