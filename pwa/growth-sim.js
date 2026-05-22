/**
 * Growth Simulator — UI module
 *
 * Wires the growth panel controls to the WASM simulate_season() function,
 * renders height/spread/root curves on canvas, shows snapshot cards,
 * and lets the user scrub through days with a slider.
 */
import { simulate_season, simulate_growth } from './pkg/companion_graph.js';
import { fetchDailyWeather, fetchCurrentConditions, fetchForecast, fetchCropAlerts, doyToDate as doyToIsoDate, defaultWeatherYear } from './weather.js';
import { optimizeGrowth, compareWithCurrent, sensitivityAnalysis, doyLabel } from './optimizer.js';

// ── Soil presets (mirrors planner.js) ──
const SOIL_TYPES = {
  sandy:       { waterFactor: 0.6, rootFactor: 1.3, n2Factor: 0.5 },
  'sandy-loam':{ waterFactor: 0.8, rootFactor: 1.2, n2Factor: 0.7 },
  loam:        { waterFactor: 1.0, rootFactor: 1.0, n2Factor: 1.0 },
  'silt-loam': { waterFactor: 1.1, rootFactor: 0.9, n2Factor: 1.1 },
  'clay-loam': { waterFactor: 1.2, rootFactor: 0.7, n2Factor: 1.2 },
  clay:        { waterFactor: 1.3, rootFactor: 0.5, n2Factor: 1.3 },
};

// ── Stage colors ──
const STAGE_COLORS = {
  seed:         '#8d6e63',
  germinating:  '#a5d6a7',
  seedling:     '#66bb6a',
  vegetative:   '#43a047',
  flowering:    '#ab47bc',
  fruiting:     '#ef5350',
  senescence:   '#ff8a65',
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function doyToDate(doy) {
  const d = new Date(new Date().getFullYear(), 0);
  d.setDate(doy);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function dateToDoy(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function doyToIso(doy) {
  const d = new Date(new Date().getFullYear(), 0);
  d.setDate(doy);
  return d.toISOString().slice(0, 10);
}

function cToF(c) { return (c * 9 / 5 + 32).toFixed(0); }
function mlToGalPerWeek(ml) { return (ml * 7 / 3785.41).toFixed(1); }
function cmToIn(cm) { return (cm / 2.54).toFixed(1); }
function kgM2ToLbFt2(kg) { return (kg * 0.2048).toFixed(2); }

const STAGE_DESC = {
  seed:         'Planted in soil, waiting for moisture and warmth to trigger germination',
  germinating:  'Root tip emerging, seed coat splitting — the plant is waking up',
  seedling:     'First true leaves visible, building its root system underground',
  vegetative:   'Rapid leaf and stem growth — this is when it needs the most nutrients',
  flowering:    'Producing flowers for pollination — reduce nitrogen, increase phosphorus',
  fruiting:     'Setting and ripening fruit or seed — keep watering consistently',
  senescence:   'Growth slowing down, leaves yellowing — the natural end of the season',
};


const STRESS_META = {
  frost_damage: {
    label: 'Frost Damage',
    description: 'Night temperature dropped below this crop\'s tolerance.',
  },
  heat_stress: {
    label: 'Heat Stress',
    description: 'Heat is above optimal range and slows normal growth.',
  },
  drought_stress: {
    label: 'Drought Stress',
    description: 'Water is below plant demand, reducing growth performance.',
  },
  root_rot_risk: {
    label: 'Root Rot Risk',
    description: 'Soil is too wet and roots may have low oxygen.',
  },
  nutrient_burn: {
    label: 'Nutrient Burn',
    description: 'Nutrient concentration is too high and can damage roots.',
  },
  nitrogen_deficiency: {
    label: 'Nitrogen Deficiency',
    description: 'Not enough available nitrogen for healthy vegetative growth.',
  },
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStressMeta(kind) {
  return STRESS_META[kind] || {
    label: kind.replace(/_/g, ' '),
    description: 'Environmental stress reducing ideal growth.',
  };
}

function getStressBand(severity) {
  if (severity >= 0.67) return 'severe';
  if (severity >= 0.34) return 'moderate';
  return 'mild';
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function getStressSeverity(snap, kind) {
  if (!snap || !Array.isArray(snap.stress_events)) return 0;

  return snap.stress_events.reduce((maxSev, event) => {
    if (event.kind !== kind) return maxSev;
    return Math.max(maxSev, event.severity || 0);
  }, 0);
}

// ── Zone → latitude mapping (approximate center of each zone band) ──
const ZONE_LAT = {
  '1a': 65, '1b': 63, '2a': 60, '2b': 58,
  '3a': 55, '3b': 53, '4a': 50, '4b': 48,
  '5a': 45, '5b': 43, '6a': 40, '6b': 38,
  '7a': 36, '7b': 34, '8a': 32, '8b': 31,
  '9a': 29, '9b': 28, '10a': 27, '10b': 26,
  '11a': 25, '11b': 24, '12a': 22, '12b': 20, '13a': 18, '13b': 16,
};

// ── US cities with lat, lon + typical temps + zone ──
const CITIES = [
  { name: 'Anchorage, AK',      lat: 61.2, lon: -149.9, zone: '4b', tempH: 18, tempL: 8 },
  { name: 'Minneapolis, MN',    lat: 44.9, lon: -93.3,  zone: '4b', tempH: 27, tempL: 16 },
  { name: 'Denver, CO',         lat: 39.7, lon: -105.0, zone: '5b', tempH: 30, tempL: 14 },
  { name: 'Chicago, IL',        lat: 41.9, lon: -87.6,  zone: '5b', tempH: 28, tempL: 17 },
  { name: 'Boston, MA',         lat: 42.4, lon: -71.1,  zone: '6a', tempH: 27, tempL: 17 },
  { name: 'Seattle, WA',        lat: 47.6, lon: -122.3, zone: '8b', tempH: 24, tempL: 13 },
  { name: 'Portland, OR',       lat: 45.5, lon: -122.7, zone: '8b', tempH: 26, tempL: 13 },
  { name: 'Kansas City, MO',    lat: 39.1, lon: -94.6,  zone: '6a', tempH: 31, tempL: 19 },
  { name: 'Nashville, TN',      lat: 36.2, lon: -86.8,  zone: '7a', tempH: 31, tempL: 19 },
  { name: 'Charlotte, NC',      lat: 35.2, lon: -80.8,  zone: '7b', tempH: 32, tempL: 20 },
  { name: 'Atlanta, GA',        lat: 33.7, lon: -84.4,  zone: '7b', tempH: 32, tempL: 21 },
  { name: 'Dallas, TX',         lat: 32.8, lon: -96.8,  zone: '8a', tempH: 35, tempL: 23 },
  { name: 'Austin, TX',         lat: 30.3, lon: -97.7,  zone: '8b', tempH: 35, tempL: 22 },
  { name: 'Phoenix, AZ',        lat: 33.4, lon: -112.1, zone: '9b', tempH: 41, tempL: 25 },
  { name: 'Los Angeles, CA',    lat: 34.1, lon: -118.2, zone: '10a', tempH: 28, tempL: 16 },
  { name: 'San Francisco, CA',  lat: 37.8, lon: -122.4, zone: '10a', tempH: 21, tempL: 12 },
  { name: 'San Diego, CA',      lat: 32.7, lon: -117.2, zone: '10b', tempH: 25, tempL: 16 },
  { name: 'Miami, FL',          lat: 25.8, lon: -80.2,  zone: '10b', tempH: 33, tempL: 24 },
  { name: 'Honolulu, HI',       lat: 21.3, lon: -157.9, zone: '12a', tempH: 31, tempL: 23 },
  { name: 'New York, NY',       lat: 40.7, lon: -74.0,  zone: '7a', tempH: 28, tempL: 18 },
  { name: 'Philadelphia, PA',   lat: 40.0, lon: -75.2,  zone: '7a', tempH: 29, tempL: 18 },
  { name: 'Washington, DC',     lat: 38.9, lon: -77.0,  zone: '7a', tempH: 30, tempL: 19 },
  { name: 'Detroit, MI',        lat: 42.3, lon: -83.0,  zone: '6a', tempH: 27, tempL: 16 },
  { name: 'St. Louis, MO',      lat: 38.6, lon: -90.2,  zone: '6b', tempH: 31, tempL: 19 },
  { name: 'Salt Lake City, UT', lat: 40.8, lon: -111.9, zone: '6b', tempH: 32, tempL: 15 },
  { name: 'Boise, ID',          lat: 43.6, lon: -116.2, zone: '6b', tempH: 32, tempL: 13 },
  { name: 'Albuquerque, NM',    lat: 35.1, lon: -106.6, zone: '7a', tempH: 33, tempL: 15 },
  { name: 'Raleigh, NC',        lat: 35.8, lon: -78.6,  zone: '7b', tempH: 31, tempL: 19 },
  { name: 'Pittsburgh, PA',     lat: 40.4, lon: -80.0,  zone: '6b', tempH: 27, tempL: 16 },
  { name: 'Columbus, OH',       lat: 40.0, lon: -83.0,  zone: '6a', tempH: 28, tempL: 16 },
  { name: 'Indianapolis, IN',   lat: 39.8, lon: -86.2,  zone: '5b', tempH: 28, tempL: 17 },
  { name: 'Milwaukee, WI',      lat: 43.0, lon: -87.9,  zone: '5b', tempH: 26, tempL: 15 },
  { name: 'Omaha, NE',          lat: 41.3, lon: -96.0,  zone: '5b', tempH: 29, tempL: 16 },
  { name: 'Tucson, AZ',         lat: 32.2, lon: -110.9, zone: '9a', tempH: 38, tempL: 21 },
  { name: 'Tampa, FL',          lat: 28.0, lon: -82.5,  zone: '9b', tempH: 33, tempL: 22 },
  { name: 'Sacramento, CA',     lat: 38.6, lon: -121.5, zone: '9b', tempH: 34, tempL: 14 },
  { name: 'Des Moines, IA',     lat: 41.6, lon: -93.6,  zone: '5a', tempH: 28, tempL: 16 },
  { name: 'Dubuque, IA',        lat: 42.5, lon: -90.7,  zone: '5a', tempH: 27, tempL: 14 },
];

let plants = [];
let seasonData = null;
let transplantAdvisorCache = null;
let weatherData = null; // per-day weather (historical)
let forecastData = null; // 7-day forecast from NWS/Open-Meteo
let currentConditions = null; // current observation snapshot
let activeAlerts = []; // active weather alerts for location
let currentLocation = { lat: 42, lon: -71.1, label: '' };

function getChartDayFromClientX(canvas, clientX) {
  if (!seasonData || seasonData.length < 2 || !canvas._chartParams) return null;

  const rect = canvas.getBoundingClientRect();
  const { pad, cw } = canvas._chartParams;
  const rawX = clientX - rect.left;
  const clampedX = Math.max(pad.left, Math.min(pad.left + cw, rawX));
  const ratio = cw > 0 ? (clampedX - pad.left) / cw : 0;
  return Math.round(ratio * (seasonData.length - 1));
}

function positionChartTooltip(tooltip, event, tooltipWidth = 300, tooltipHeight = 220) {
  const margin = 8;
  const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';

  if (isTouchLike || window.innerWidth <= 720) {
    const x = Math.max(margin, Math.min((window.innerWidth - tooltipWidth) / 2, window.innerWidth - tooltipWidth - margin));
    const y = Math.max(margin, window.innerHeight - tooltipHeight - margin);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    return;
  }

  const x = Math.min(window.innerWidth - tooltipWidth - margin, event.clientX + 14);
  const y = Math.min(window.innerHeight - tooltipHeight - margin, event.clientY + 14);
  tooltip.style.left = `${Math.max(margin, x)}px`;
  tooltip.style.top = `${Math.max(margin, y)}px`;
}

function setDayFromChartClientX(canvas, clientX) {
  const day = getChartDayFromClientX(canvas, clientX);
  if (day === null) return;

  const slider = document.getElementById('growth-day-slider');
  if (!slider) return;

  const nextValue = String(day);
  if (slider.value !== nextValue) {
    slider.value = nextValue;
    onDaySlider();
  }
}

function getCurrentSliderDay() {
  const slider = document.getElementById('growth-day-slider');
  if (!slider) return 0;
  return parseInt(slider.value, 10) || 0;
}

function bindChartScrubber(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas._scrubberBound) return;

  canvas._scrubberBound = true;
  canvas.style.cursor = 'ew-resize';
  canvas.style.touchAction = 'none';

  let dragging = false;

  canvas.addEventListener('pointerdown', (event) => {
    if (!seasonData) return;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    setDayFromChartClientX(canvas, event.clientX);
    event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setDayFromChartClientX(canvas, event.clientX);
    event.preventDefault();
  });

  const stopDragging = (event) => {
    dragging = false;
    if (
      event &&
      typeof event.pointerId === 'number' &&
      canvas.hasPointerCapture(event.pointerId)
    ) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('lostpointercapture', () => { dragging = false; });
}

function setLocation(lat, lon, label) {
  document.getElementById('growth-latitude').value = lat.toFixed(1);
  const el = document.getElementById('growth-loc-label');
  if (el) el.textContent = label || '';
  currentLocation = { lat, lon, label };
  try { localStorage.setItem('growth-location', JSON.stringify({ lat, lon, label })); } catch(e) {}
}

function initLocationPicker() {
  const method = document.getElementById('growth-loc-method');
  const zoneSelect = document.getElementById('growth-zone-select');
  const citySelect = document.getElementById('growth-city-select');
  const latInput = document.getElementById('growth-latitude');
  if (!method) return;

  // Populate zone dropdown
  const zones = Object.keys(ZONE_LAT).sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    return na !== nb ? na - nb : a.localeCompare(b);
  });
  zoneSelect.innerHTML = zones.map(z =>
    `<option value="${z}">Zone ${z}</option>`
  ).join('');

  // Populate city dropdown
  const sortedCities = [...CITIES].sort((a, b) => a.name.localeCompare(b.name));
  citySelect.innerHTML = sortedCities.map((c, i) =>
    `<option value="${i}">${c.name} (${c.zone})</option>`
  ).join('');
  // Store sorted ref
  citySelect._cities = sortedCities;

  // Method switcher
  method.addEventListener('change', () => {
    const m = method.value;
    zoneSelect.hidden = m !== 'zone';
    citySelect.hidden = m !== 'city';
    latInput.hidden   = m !== 'manual';

    if (m === 'gps') {
      zoneSelect.hidden = true;
      citySelect.hidden = true;
      latInput.hidden = true;
      requestGeolocation();
    } else if (m === 'zone') {
      onZoneChange();
    } else if (m === 'city') {
      onCityChange();
    }
  });

  // Zone change
  zoneSelect.addEventListener('change', onZoneChange);
  function onZoneChange() {
    const z = zoneSelect.value;
    const lat = ZONE_LAT[z] || 42;
    setLocation(lat, 0, `Zone ${z} (~${lat}°N)`);
  }

  // City change
  citySelect.addEventListener('change', onCityChange);
  function onCityChange() {
    const idx = parseInt(citySelect.value);
    const city = citySelect._cities[idx];
    if (!city) return;
    setLocation(city.lat, city.lon, `${city.name}`);
    // Also set temp defaults from city data
    document.getElementById('growth-temp-high').value = city.tempH;
    document.getElementById('growth-temp-low').value = city.tempL;
  }

  // Manual lat change
  latInput.addEventListener('change', () => {
    const lat = parseFloat(latInput.value) || 42;
    setLocation(lat, currentLocation.lon, `${lat.toFixed(1)}°`);
  });

  // Restore saved preference
  try {
    const saved = JSON.parse(localStorage.getItem('growth-location'));
    if (saved) {
      setLocation(saved.lat, saved.lon || 0, saved.label || '');
    }
  } catch(e) {}

  // Default: trigger zone change
  onZoneChange();
}

function requestGeolocation() {
  const label = document.getElementById('growth-loc-label');
  if (!navigator.geolocation) {
    if (label) label.textContent = 'Geolocation not supported';
    return;
  }
  if (label) label.textContent = 'Locating...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setLocation(lat, lon, `📍 ${lat.toFixed(2)}°N`);
    },
    (err) => {
      if (label) label.textContent = 'Location denied — using default';
      console.warn('Geolocation error:', err.message);
    },
    { timeout: 10000, maximumAge: 300000 }
  );
}

// ── Init ──
export function initGrowthSim(plantList) {
  plants = plantList.filter(p =>
    p.timing?.days_to_maturity &&
    p.properties?.metric?.mature_height_cm
  );

  const select = document.getElementById('growth-plant-select');
  if (!select) return;

  // Populate dropdown
  plants.sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = plants.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join('');

  // Init location picker
  initLocationPicker();

  // Run button
  document.getElementById('growth-run-btn')
    .addEventListener('click', runSimulation);

  // Day slider
  document.getElementById('growth-day-slider')
    .addEventListener('input', onDaySlider);

  // Click/drag directly on charts to scrub days.
  bindChartScrubber('growth-chart-height');
  bindChartScrubber('growth-chart-stress');

  // Hover tooltip for growth curve metric explanations.
  initGrowthMetricsTooltip();

  // Hover tooltip for stress chart explanations.
  initStressTooltip();

  // Planting date picker → DOY sync
  const dateInput = document.getElementById('growth-planting-date');
  const doyHidden = document.getElementById('growth-planting-doy');
  if (dateInput) {
    dateInput.value = doyToIso(parseInt(doyHidden.value) || 120);
    dateInput.addEventListener('change', () => {
      const doy = dateToDoy(dateInput.value);
      if (doy > 0 && doy <= 365) doyHidden.value = doy;
    });
  }

  // Live °F display on temp fields
  const tempH = document.getElementById('growth-temp-high');
  const tempL = document.getElementById('growth-temp-low');
  const tempHF = document.getElementById('growth-temp-high-f');
  const tempLF = document.getElementById('growth-temp-low-f');
  function updateTempF() {
    if (tempHF) tempHF.textContent = '(' + cToF(parseFloat(tempH.value) || 0) + ' °F)';
    if (tempLF) tempLF.textContent = '(' + cToF(parseFloat(tempL.value) || 0) + ' °F)';
  }
  tempH.addEventListener('input', updateTempF);
  tempL.addEventListener('input', updateTempF);
  updateTempF();

  // Live gallon/week display on water field
  const waterInput = document.getElementById('growth-water');
  const waterEquiv = document.getElementById('growth-water-equiv');
  function updateWaterEquiv() {
    const ml = parseFloat(waterInput.value) || 0;
    if (waterEquiv) waterEquiv.textContent = '≈ ' + mlToGalPerWeek(ml) + ' gal/week';
  }
  waterInput.addEventListener('input', updateWaterEquiv);
  updateWaterEquiv();

  const advisorInputIds = [
    'growth-indoor-dli',
    'growth-indoor-temp',
    'growth-hardening-days',
    'growth-hardening-start-hours',
  ];

  advisorInputIds.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    const handler = () => {
      updateTransplantAdvisor(getCurrentSliderDay(), true);
    };

    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });

  // Weather controls
  initWeatherControls();

  // Optimizer
  initOptimizerControls();
}

export function setGrowthPlant(plantId, runAfterSelect = false) {
  if (!plantId) return false;

  const select = document.getElementById('growth-plant-select');
  if (!select) return false;

  const exists = [...select.options].some(opt => opt.value === plantId);
  if (!exists) return false;

  select.value = plantId;
  if (runAfterSelect) runSimulation();
  return true;
}

// ── Run simulation ──
async function runSimulation() {
  const plantId = document.getElementById('growth-plant-select').value;
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;

  const latitude = parseFloat(document.getElementById('growth-latitude').value) || 42;
  const plantDoy = parseInt(document.getElementById('growth-planting-doy').value) || 120;
  const tempHigh = parseFloat(document.getElementById('growth-temp-high').value) || 28;
  const tempLow = parseFloat(document.getElementById('growth-temp-low').value) || 16;
  const waterMl = parseFloat(document.getElementById('growth-water').value) || 600;
  const soilKey = document.getElementById('growth-soil-select').value;
  const soil = SOIL_TYPES[soilKey] || SOIL_TYPES.loam;

  // Determine simulation length: maturity max + 30 days for senescence
  const matMax = plant.timing.days_to_maturity[1] || 90;
  const numDays = Math.min(matMax + 30, 365);

  const useWeather = document.getElementById('growth-weather-toggle')?.checked || false;
  const weatherYear = parseInt(document.getElementById('growth-weather-year')?.value) || defaultWeatherYear();
  const weatherBadge = document.getElementById('growth-weather-badge');

  // Fetch real weather if enabled
  weatherData = null;
  forecastData = null;
  currentConditions = null;
  activeAlerts = [];

  if (useWeather && currentLocation.lon !== 0) {
    try {
      const btn = document.getElementById('growth-run-btn');
      btn.textContent = '☁️ Fetching weather…';
      btn.disabled = true;

      // Fetch historical, forecast, current, and alerts in parallel
      const startDate = doyToIsoDate(plantDoy, weatherYear);
      const endDate = doyToIsoDate(Math.min(plantDoy + numDays - 1, 365), weatherYear);

      const [histResult, fcstResult, currResult, alertsResult] = await Promise.allSettled([
        fetchDailyWeather(currentLocation.lat, currentLocation.lon, startDate, endDate),
        fetchForecast(currentLocation.lat, currentLocation.lon),
        fetchCurrentConditions(currentLocation.lat, currentLocation.lon),
        fetchCropAlerts(currentLocation.lat, currentLocation.lon),
      ]);

      weatherData = histResult.status === 'fulfilled' ? histResult.value.days : null;
      forecastData = fcstResult.status === 'fulfilled' ? fcstResult.value : null;
      currentConditions = currResult.status === 'fulfilled' ? currResult.value : null;
      activeAlerts = alertsResult.status === 'fulfilled' ? alertsResult.value : [];

      btn.textContent = '▶ Run Simulation';
      btn.disabled = false;
    } catch (err) {
      console.warn('Weather fetch failed, falling back to manual:', err);
      const btn = document.getElementById('growth-run-btn');
      btn.textContent = '▶ Run Simulation';
      btn.disabled = false;
      weatherData = null;
    }
  }

  // Update weather badge
  if (weatherBadge) {
    if (weatherData && weatherData.length > 0) {
      const src = forecastData?.source === 'nws' ? 'NWS + Open-Meteo' : 'Open-Meteo';
      weatherBadge.textContent = `☁️ ${src} · ${weatherYear}`;
      weatherBadge.hidden = false;
    } else {
      weatherBadge.textContent = '';
      weatherBadge.hidden = true;
    }
  }

  // Render current conditions + alerts
  renderCurrentConditions(currentConditions);
  renderWeatherAlerts(activeAlerts);
  renderForecastSummary(forecastData);

  const baseEnv = {
    day_of_year: plantDoy,
    latitude,
    altitude_m: 200,
    temp_high_c: tempHigh,
    temp_low_c: tempLow,
    water_ml: waterMl,
    npk_available: [10.0, 5.0, 5.0],
    soil_water_factor: soil.waterFactor,
    soil_root_factor: soil.rootFactor,
    soil_n2_factor: soil.n2Factor,
  };

  try {
    if (weatherData && weatherData.length > 0) {
      // Per-day simulation with real weather
      seasonData = runWithWeather(plant, numDays, baseEnv, weatherData);
    } else {
      // Original: fixed-temp season simulation
      const resultJson = simulate_season(
        JSON.stringify(plant),
        numDays,
        JSON.stringify(baseEnv)
      );
      seasonData = JSON.parse(resultJson);
    }
  } catch (err) {
    console.error('Growth simulation error:', err);
    document.getElementById('growth-empty').textContent =
      `Simulation error: ${err.message}`;
    return;
  }

  // Show results
  document.getElementById('growth-empty').hidden = true;
  document.getElementById('growth-results').hidden = false;

  // Set slider range
  const slider = document.getElementById('growth-day-slider');
  slider.max = seasonData.length - 1;
  slider.value = Math.min(Math.floor(seasonData.length / 2), seasonData.length - 1);

  // Draw charts
  drawHeightChart(plant);
  drawStressChart();

  // Show snapshot for current slider position
  onDaySlider();

  transplantAdvisorCache = null;
  updateTransplantAdvisor(getCurrentSliderDay(), true);
}

/** Run simulation day-by-day with per-day weather data from Open-Meteo. */
function runWithWeather(plant, numDays, baseEnv, weather) {
  const plantJson = JSON.stringify(plant);
  const snapshots = [];
  let gdd = 0;
  let soilMoisture = 0; // 0 = let engine auto-init from field capacity
  // Track peak structural dimensions — plants don't shrink
  let peakHeight = 0, peakSpread = 0, peakRoot = 0;
  // Track cumulative yield, flushes, trend
  let cumulativeYield = 0, peakDailyYield = 0, flushCount = 0, wasProducing = false;

  for (let day = 0; day < numDays; day++) {
    const w = weather[day];
    const dayEnv = {
      ...baseEnv,
      day_of_year: ((baseEnv.day_of_year + day - 1) % 365) + 1,
    };

    // Override from real weather when available
    if (w) {
      if (w.temp_high_c != null) dayEnv.temp_high_c = w.temp_high_c;
      if (w.temp_low_c != null) dayEnv.temp_low_c = w.temp_low_c;
      if (w.humidity_pct) dayEnv.humidity_pct = w.humidity_pct;
      if (w.precip_mm) dayEnv.precip_mm = w.precip_mm;
      if (w.wind_speed_ms) dayEnv.wind_speed_ms = w.wind_speed_ms;
    }

    // Carry soil moisture from previous day
    if (soilMoisture > 0) {
      dayEnv.soil_moisture_mm = soilMoisture;
    }

    const snapJson = simulate_growth(plantJson, day, JSON.stringify(dayEnv), gdd);
    const snap = JSON.parse(snapJson);
    gdd = snap.gdd_accumulated;
    soilMoisture = snap.soil_moisture_mm || 0;

    // Enforce monotonic structural dimensions — plants can't un-grow
    peakHeight = Math.max(peakHeight, snap.height_cm);
    peakSpread = Math.max(peakSpread, snap.spread_cm);
    peakRoot = Math.max(peakRoot, snap.root_depth_cm);
    snap.height_cm = peakHeight;
    snap.spread_cm = peakSpread;
    snap.root_depth_cm = peakRoot;

    // Accumulate yield over the season
    cumulativeYield += (snap.daily_yield_rate || 0);
    snap.cumulative_yield_kg = cumulativeYield;

    // Track harvest flushes
    const producing = snap.is_producing || false;
    if (producing && !wasProducing) flushCount++;
    wasProducing = producing;
    snap.harvest_flush_count = flushCount;

    // Yield trend
    peakDailyYield = Math.max(peakDailyYield, snap.daily_yield_rate || 0);
    snap.yield_trend = peakDailyYield > 0.001
      ? (snap.daily_yield_rate || 0) / peakDailyYield : 0;

    snapshots.push(snap);
  }

  return snapshots;
}

// ── Day slider handler ──
function onDaySlider() {
  if (!seasonData) return;
  const day = parseInt(document.getElementById('growth-day-slider').value);
  const snap = seasonData[day];
  if (!snap) return;

  const plantDoy = parseInt(document.getElementById('growth-planting-doy').value) || 120;
  const calDate = doyToDate(plantDoy + day);
  document.getElementById('growth-day-label').textContent = `${day} \u2014 ${calDate}`;

  // Stage badge + description
  const badge = document.getElementById('growth-stage-badge');
  badge.textContent = snap.stage.replace('_', ' ');
  badge.style.backgroundColor = STAGE_COLORS[snap.stage] || '#666';
  const stageDesc = document.getElementById('growth-stage-desc');
  if (stageDesc) stageDesc.textContent = STAGE_DESC[snap.stage] || '';

  // Growth rate as percentage
  const grPct = (snap.growth_rate * 100).toFixed(0);
  const grWord = grPct >= 80 ? 'thriving' : grPct >= 50 ? 'moderate' : 'stressed';

  // Snapshot card with dual units and context
  const card = document.getElementById('growth-snapshot');
  const stressHtml = snap.stress_events.length > 0
    ? snap.stress_events.map((s) => {
        const meta = getStressMeta(s.kind);
        const sevPct = Math.round((s.severity || 0) * 100);
        const band = getStressBand(s.severity || 0);
        const title = `${meta.label} (${sevPct}%): ${meta.description}${s.detail ? ' Detail: ' + s.detail : ''}`;
        return `<span class="growth-stress-tag growth-stress--${s.severity > 0.5 ? 'high' : 'low'} growth-stress-tag--${band}" title="${escapeHtml(title)}">${meta.label} ${sevPct}%</span>`;
      }).join(' ')
    : '<span class="growth-no-stress" title="No stress events detected for this day">No stress detected</span>';

  card.innerHTML = `
    <div class="growth-snap-grid">
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.height_cm.toFixed(1)}<small> cm</small></span>
        <span class="growth-snap-unit">Height <span class="growth-alt">${cmToIn(snap.height_cm)} in</span></span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.spread_cm.toFixed(1)}<small> cm</small></span>
        <span class="growth-snap-unit">Canopy Spread <span class="growth-alt">${cmToIn(snap.spread_cm)} in</span></span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.root_depth_cm.toFixed(1)}<small> cm</small></span>
        <span class="growth-snap-unit">Root Depth <span class="growth-alt">${cmToIn(snap.root_depth_cm)} in</span></span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.leaf_count}</span>
        <span class="growth-snap-unit">Leaves</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${grPct}<small>%</small></span>
        <span class="growth-snap-unit">Growth Rate <span class="growth-alt">${grWord}</span></span>
      </div>
      <div class="growth-snap-metric" title="Daily Light Integral — total photosynthetically active light per day. Plants need 12–30+ depending on species.">
        <span class="growth-snap-val">${snap.dli.toFixed(1)}</span>
        <span class="growth-snap-unit">DLI <span class="growth-alt">mol/m²/day light</span></span>
      </div>
      <div class="growth-snap-metric" title="Growing Degree Days — accumulated heat units above base temp. Determines growth stage transitions.">
        <span class="growth-snap-val">${snap.gdd_accumulated.toFixed(0)}</span>
        <span class="growth-snap-unit">GDD <span class="growth-alt">heat units</span></span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.yield_projected_kg.toFixed(2)}<small> kg</small></span>
        <span class="growth-snap-unit">Yield / m² <span class="growth-alt">${kgM2ToLbFt2(snap.yield_projected_kg)} lb/ft²</span></span>
      </div>
      <div class="growth-snap-metric" title="Vapor Pressure Deficit \u2014 atmospheric drying power. High VPD forces stomata to close. Optimal: 0.4\u20131.5 kPa.">
        <span class="growth-snap-val ${(snap.vpd_kpa || 0) > 2.0 ? 'growth-val-warn' : ''}">${(snap.vpd_kpa || 0).toFixed(2)}<small> kPa</small></span>
        <span class="growth-snap-unit">VPD <span class="growth-alt">${(snap.vpd_kpa || 0) < 0.8 ? 'humid' : (snap.vpd_kpa || 0) > 2.0 ? 'dry stress' : 'optimal'}</span></span>
      </div>
      <div class="growth-snap-metric" title="Stomatal conductance \u2014 how open the leaf pores are. Controls both CO2 uptake and water loss.">
        <span class="growth-snap-val ${(snap.stomatal_conductance || 0) < 0.3 ? 'growth-val-warn' : ''}">${((snap.stomatal_conductance || 0) * 100).toFixed(0)}<small>%</small></span>
        <span class="growth-snap-unit">Stomata Open <span class="growth-alt">${(snap.stomatal_conductance || 0) > 0.7 ? 'healthy' : (snap.stomatal_conductance || 0) > 0.3 ? 'restricted' : 'closing'}</span></span>
      </div>
      <div class="growth-snap-metric" title="Daily transpiration \u2014 water lost through leaf pores.">
        <span class="growth-snap-val">${((snap.transpiration_ml || 0) / 1000).toFixed(1)}<small> L</small></span>
        <span class="growth-snap-unit">Transpiration <span class="growth-alt">${(snap.transpiration_ml || 0).toFixed(0)} mL/day</span></span>
      </div>
      <div class="growth-snap-metric" title="Net photosynthesis \u2014 carbon assimilation after nighttime respiration losses.">
        <span class="growth-snap-val">${((snap.net_photosynthesis || 0) * 100).toFixed(0)}<small>%</small></span>
        <span class="growth-snap-unit">Net Photo <span class="growth-alt">${((snap.respiration_loss || 0) * 100).toFixed(0)}% resp loss</span></span>
      </div>
      <div class="growth-snap-metric" title="Soil moisture in root zone. Below wilting point plants cannot extract water.">
        <span class="growth-snap-val">${(snap.soil_moisture_mm || 0).toFixed(0)}<small> mm</small></span>
        <span class="growth-snap-unit">Soil Moisture <span class="growth-alt">LAI ${(snap.lai || 0).toFixed(1)}</span></span>
      </div>
    </div>
    <div class="growth-snap-stress">${stressHtml}</div>
  `;

  // Draw cursor on chart
  drawHeightCursor(day);

  // Update raw JSON
  document.getElementById('growth-raw-json').textContent =
    JSON.stringify(snap, null, 2);

  updateTransplantAdvisor(day);
}

// ── Height/Spread/Root chart ──
function drawHeightChart(plant) {
  const canvas = document.getElementById('growth-chart-height');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (!seasonData || seasonData.length < 2) return;

  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Find max values
  const maxH = Math.max(...seasonData.map(s => s.height_cm), 1);
  const maxS = Math.max(...seasonData.map(s => s.spread_cm), 1);
  const maxR = Math.max(...seasonData.map(s => s.root_depth_cm), 1);
  const maxVal = Math.max(maxH, maxS, maxR);

  // Grid lines
  ctx.strokeStyle = 'rgba(45, 58, 45, 0.15)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch - (i / 4) * ch;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
    ctx.fillStyle = '#6b705c';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`${(maxVal * i / 4).toFixed(0)}`, pad.left - 6, y + 4);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b705c';
  const step = Math.max(1, Math.floor(seasonData.length / 6));
  const plantDoy = parseInt(document.getElementById('growth-planting-doy').value) || 120;
  for (let d = 0; d < seasonData.length; d += step) {
    const x = pad.left + (d / (seasonData.length - 1)) * cw;
    ctx.fillText(doyToDate(plantDoy + d), x, h - 6);
  }

  // Draw curves
  const drawCurve = (data, color, label) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((val, i) => {
      const x = pad.left + (i / (data.length - 1)) * cw;
      const y = pad.top + ch - (val / maxVal) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  drawCurve(seasonData.map(s => s.height_cm), '#43a047', 'Height');
  drawCurve(seasonData.map(s => s.spread_cm), '#1e88e5', 'Spread');
  drawCurve(seasonData.map(s => s.root_depth_cm), '#8d6e63', 'Root');

  // Legend
  const legendY = 12;
  const legends = [
    { color: '#43a047', label: 'Height' },
    { color: '#1e88e5', label: 'Spread' },
    { color: '#8d6e63', label: 'Root Depth' },
  ];
  let lx = pad.left;
  ctx.font = '11px system-ui';
  legends.forEach(({ color, label }) => {
    ctx.fillStyle = color;
    ctx.fillRect(lx, legendY - 8, 12, 3);
    ctx.fillStyle = '#2d3a2d';
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 16, legendY);
    lx += ctx.measureText(label).width + 30;
  });

  // Stage color bands (background)
  // Store chart params for cursor
  canvas._chartParams = { pad, cw, ch, maxVal };
}

function drawHeightCursor(day) {
  const canvas = document.getElementById('growth-chart-height');
  const params = canvas._chartParams;
  if (!params || !seasonData) return;

  // Redraw chart then overlay cursor
  drawHeightChart(); // would re-call, so let's just overlay
  const ctx = canvas.getContext('2d');
  const { pad, cw, ch } = params;
  const x = pad.left + (day / (seasonData.length - 1)) * cw;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, pad.top);
  ctx.lineTo(x, pad.top + ch);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── Stress timeline chart ──
function drawStressChart() {
  const canvas = document.getElementById('growth-chart-stress');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (!seasonData || seasonData.length < 2) return;

  const pad = { top: 16, right: 20, bottom: 24, left: 50 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Title
  ctx.fillStyle = '#6b705c';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Stress Events', pad.left, 12);

  // Growth rate curve (inverted = stress)
  ctx.strokeStyle = '#ef5350';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  seasonData.forEach((snap, i) => {
    const x = pad.left + (i / (seasonData.length - 1)) * cw;
    const stress = Math.max(0, 1 - snap.growth_rate);
    const y = pad.top + ch - stress * ch;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill stress areas
  ctx.fillStyle = 'rgba(239, 83, 80, 0.15)';
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ch);
  seasonData.forEach((snap, i) => {
    const x = pad.left + (i / (seasonData.length - 1)) * cw;
    const stress = Math.max(0, 1 - snap.growth_rate);
    const y = pad.top + ch - stress * ch;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + cw, pad.top + ch);
  ctx.closePath();
  ctx.fill();

  // Stress event markers
  const markers = [];
  seasonData.forEach((snap, i) => {
    if (snap.stress_events.length > 0) {
      const x = pad.left + (i / (seasonData.length - 1)) * cw;
      const maxSev = Math.max(...snap.stress_events.map(s => s.severity));
      const y = pad.top + ch - maxSev * ch;
      ctx.fillStyle = maxSev > 0.5
        ? 'rgba(239, 83, 80, 0.8)'
        : 'rgba(255, 167, 38, 0.6)';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      markers.push({ day: i, x, y, maxSev, events: snap.stress_events });
    }
  });

  // Y-axis
  ctx.fillStyle = '#6b705c';
  ctx.textAlign = 'right';
  ctx.fillText('0%', pad.left - 6, pad.top + ch + 4);
  ctx.fillText('100%', pad.left - 6, pad.top + 4);

  // Store chart params for drag scrubbing.
  canvas._chartParams = { pad, cw, ch };
  canvas._stressMarkers = markers;
}

function initGrowthMetricsTooltip() {
  const canvas = document.getElementById('growth-chart-height');
  const tooltip = document.getElementById('growth-metrics-tooltip');
  if (!canvas || !tooltip || canvas._growthTooltipBound) return;

  canvas._growthTooltipBound = true;

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  canvas.addEventListener('mouseleave', hideTooltip);
  canvas.addEventListener('pointercancel', hideTooltip);

  const showTooltipForEvent = (event) => {
    if (!seasonData || !canvas._chartParams) {
      hideTooltip();
      return;
    }

    const day = getChartDayFromClientX(canvas, event.clientX);
    if (day === null) {
      hideTooltip();
      return;
    }

    const snap = seasonData[day];
    if (!snap) {
      hideTooltip();
      return;
    }

    const plantDoy = parseInt(document.getElementById('growth-planting-doy').value) || 120;
    const calDate = doyToDate(plantDoy + day);
    const stageLabel = (snap.stage || 'seed').replace(/_/g, ' ');
    const growthRatePct = Math.round((snap.growth_rate || 0) * 100);

    tooltip.innerHTML = `<div class="growth-stress-tooltip-title">Day ${day} - ${escapeHtml(calDate)}</div>`
      + `<div class="growth-stress-tooltip-sub">Stage: ${escapeHtml(stageLabel)} | Growth rate: ${growthRatePct}%</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--height"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">Height</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.height_cm.toFixed(1)} cm (${cmToIn(snap.height_cm)} in)</div>`
      + `</div>`
      + `</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--spread"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">Spread</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.spread_cm.toFixed(1)} cm (${cmToIn(snap.spread_cm)} in)</div>`
      + `</div>`
      + `</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--root"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">Root Depth</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.root_depth_cm.toFixed(1)} cm (${cmToIn(snap.root_depth_cm)} in)</div>`
      + `</div>`
      + `</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--leaves"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">Leaves</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.leaf_count} leaves</div>`
      + `</div>`
      + `</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--dli"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">DLI</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.dli.toFixed(1)} mol/m2/day</div>`
      + `</div>`
      + `</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--gdd"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">GDD</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.gdd_accumulated.toFixed(0)} heat units</div>`
      + `</div>`
      + `</div>`
      + `<div class="growth-metric-tooltip-item">`
      + `<span class="growth-metric-dot growth-metric-dot--yield"></span>`
      + `<div class="growth-stress-tooltip-text">`
      + `<div class="growth-stress-tooltip-head">Projected Yield</div>`
      + `<div class="growth-stress-tooltip-desc">${snap.yield_projected_kg.toFixed(2)} kg/m2 (${kgM2ToLbFt2(snap.yield_projected_kg)} lb/ft2)</div>`
      + `</div>`
      + `</div>`;

    positionChartTooltip(tooltip, event, 312, 300);
    tooltip.hidden = false;
  };

  canvas.addEventListener('mousemove', showTooltipForEvent);
  canvas.addEventListener('pointerdown', showTooltipForEvent);
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      showTooltipForEvent(event);
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      window.setTimeout(() => { tooltip.hidden = true; }, 1200);
    }
  });
}
function initStressTooltip() {
  const canvas = document.getElementById('growth-chart-stress');
  const tooltip = document.getElementById('growth-stress-tooltip');
  if (!canvas || !tooltip || canvas._stressTooltipBound) return;

  canvas._stressTooltipBound = true;

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  canvas.addEventListener('mouseleave', hideTooltip);
  canvas.addEventListener('pointercancel', hideTooltip);

  const showTooltipForEvent = (event) => {
    if (!seasonData || !canvas._chartParams) {
      hideTooltip();
      return;
    }

    const day = getChartDayFromClientX(canvas, event.clientX);
    if (day === null) {
      hideTooltip();
      return;
    }

    const snap = seasonData[day];
    if (!snap) {
      hideTooltip();
      return;
    }

    const plantDoy = parseInt(document.getElementById('growth-planting-doy').value) || 120;
    const calDate = doyToDate(plantDoy + day);
    const stressPct = Math.round(Math.max(0, 1 - snap.growth_rate) * 100);

    let bodyHtml = '';
    if (snap.stress_events.length > 0) {
      bodyHtml = snap.stress_events.map((s) => {
        const meta = getStressMeta(s.kind);
        const sevPct = Math.round((s.severity || 0) * 100);
        const band = getStressBand(s.severity || 0);
        return `<div class="growth-stress-tooltip-item">`
          + `<span class="growth-stress-dot growth-stress-dot--${band}"></span>`
          + `<div class="growth-stress-tooltip-text">`
          + `<div class="growth-stress-tooltip-head">${escapeHtml(meta.label)} (${sevPct}%)</div>`
          + `<div class="growth-stress-tooltip-desc">${escapeHtml(meta.description)}</div>`
          + (s.detail ? `<div class="growth-stress-tooltip-detail">${escapeHtml(s.detail)}</div>` : '')
          + `</div>`
          + `</div>`;
      }).join('');
    } else {
      bodyHtml = '<div class="growth-stress-tooltip-empty">No stress events detected on this day.</div>';
    }

    tooltip.innerHTML = `<div class="growth-stress-tooltip-title">Day ${day} - ${escapeHtml(calDate)}</div>`
      + `<div class="growth-stress-tooltip-sub">Overall stress: ${stressPct}%</div>`
      + bodyHtml;

    positionChartTooltip(tooltip, event, 280, 210);
    tooltip.hidden = false;
  };

  canvas.addEventListener('mousemove', showTooltipForEvent);
  canvas.addEventListener('pointerdown', showTooltipForEvent);
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      showTooltipForEvent(event);
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      window.setTimeout(() => { tooltip.hidden = true; }, 1200);
    }
  });
}


function readAdvisorInputs() {
  const indoorDli = clamp(parseFloat(document.getElementById('growth-indoor-dli')?.value) || 8, 2, 30);
  const indoorTemp = clamp(parseFloat(document.getElementById('growth-indoor-temp')?.value) || 22, -5, 40);
  const hardeningDays = Math.round(clamp(parseInt(document.getElementById('growth-hardening-days')?.value, 10) || 7, 3, 14));
  const startHours = clamp(parseFloat(document.getElementById('growth-hardening-start-hours')?.value) || 1.5, 0.5, 8);

  return {
    indoorDli,
    indoorTemp,
    hardeningDays,
    startHours,
  };
}

function getStageReadiness(stage) {
  const stageScores = {
    seed: 0.2,
    germinating: 0.45,
    seedling: 0.92,
    vegetative: 1.0,
    flowering: 0.45,
    fruiting: 0.3,
    senescence: 0.2,
  };

  return stageScores[stage] || 0.3;
}

function buildTransplantAdvisorData() {
  if (!seasonData || seasonData.length < 2) return null;

  const inputs = readAdvisorInputs();
  const tempHigh = parseFloat(document.getElementById('growth-temp-high')?.value) || 28;
  const tempLow = parseFloat(document.getElementById('growth-temp-low')?.value) || 16;
  const nighttimeScore = clamp((tempLow - 7) / 10, 0, 1);

  const rows = seasonData.map((snap, day) => {
    const rootRot = getStressSeverity(snap, 'root_rot_risk');
    const frost = getStressSeverity(snap, 'frost_damage');
    const heat = getStressSeverity(snap, 'heat_stress');
    const drought = getStressSeverity(snap, 'drought_stress');

    const rootScore = clamp((snap.root_depth_cm || 0) / 8.0, 0, 1);
    const leafScore = clamp((snap.leaf_count || 0) / 6.0, 0, 1);
    const growthScore = clamp(snap.growth_rate || 0, 0, 1);
    const stageScore = getStageReadiness(snap.stage);

    const stressPenalty = clamp(
      rootRot * 0.55
      + frost * 0.45
      + heat * 0.25
      + drought * 0.20,
      0,
      1,
    );

    const baseReadiness = (
      rootScore * 0.34
      + leafScore * 0.20
      + growthScore * 0.19
      + nighttimeScore * 0.13
      + stageScore * 0.14
    );

    const readiness = Math.round(clamp(baseReadiness * (1 - 0.62 * stressPenalty), 0, 1) * 100);
    const stageCandidate = snap.stage === 'seedling' || snap.stage === 'vegetative';

    return {
      day,
      readiness,
      rootScore,
      leafScore,
      growthScore,
      stageScore,
      stressPenalty,
      rootRot,
      frost,
      heat,
      drought,
      stageCandidate,
      snap,
    };
  });

  let best = null;
  rows.forEach((row) => {
    const stageBias = row.stageCandidate ? 1 : 0.72;
    const score = row.readiness * stageBias;
    if (!best || score > best.score) {
      best = { row, score };
    }
  });

  if (!best) return null;

  const recommended = best.row;
  const recommendedDay = recommended.day;
  const hardeningStartDay = Math.max(0, recommendedDay - inputs.hardeningDays + 1);

  const hardeningPlan = [];
  const tempMid = (tempHigh + tempLow) / 2;

  for (let i = 0; i < inputs.hardeningDays; i += 1) {
    const dayIndex = Math.min(hardeningStartDay + i, seasonData.length - 1);
    const dayRow = rows[dayIndex];
    const snap = dayRow.snap;
    const acclimation = (i + 1) / inputs.hardeningDays;

    const targetHours = 10.5;
    const exposureHours = Math.min(
      12,
      inputs.startHours + (targetHours - inputs.startHours) * (i / Math.max(1, inputs.hardeningDays - 1)),
    );

    const outdoorDose = (snap.dli || 0) * (exposureHours / 12);
    const lightGap = Math.max(0, outdoorDose - inputs.indoorDli);
    const tempGap = Math.abs(tempMid - inputs.indoorTemp);

    const shock = clamp(
      (lightGap / 12) * (1 - 0.45 * acclimation)
      + Math.max(0, tempGap - (3 + 5 * acclimation)) / 14
      + dayRow.rootRot * 0.20,
      0,
      1,
    );

    const confidence = Math.round(clamp((dayRow.readiness / 100) * (1 - shock), 0, 1) * 100);

    hardeningPlan.push({
      step: i + 1,
      dayIndex,
      exposureHours,
      shock,
      confidence,
      rootRot: dayRow.rootRot,
      dli: snap.dli || 0,
    });
  }

  const avgShock = hardeningPlan.length
    ? hardeningPlan.reduce((sum, step) => sum + step.shock, 0) / hardeningPlan.length
    : 0;

  const transplantConfidence = Math.round(clamp((recommended.readiness / 100) * (1 - avgShock), 0, 1) * 100);

  return {
    inputs,
    rows,
    recommendedDay,
    hardeningStartDay,
    hardeningPlan,
    avgShock,
    transplantConfidence,
    recommended,
  };
}

function drawTransplantReadinessChart(advisor, activeDay) {
  const canvas = document.getElementById('growth-chart-transplant');
  if (!canvas || !advisor || !advisor.rows.length) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 16, right: 14, bottom: 24, left: 36 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const dayCount = Math.max(1, advisor.rows.length - 1);

  const yFromPct = (pct) => pad.top + ch - (clamp(pct / 100, 0, 1) * ch);
  const xFromDay = (day) => pad.left + (day / dayCount) * cw;

  ctx.strokeStyle = 'rgba(45, 58, 45, 0.15)';
  ctx.lineWidth = 0.5;
  [0, 25, 50, 75, 100].forEach((pct) => {
    const y = yFromPct(pct);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
  });

  ctx.strokeStyle = '#66bb6a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  advisor.rows.forEach((row, i) => {
    const x = xFromDay(row.day);
    const y = yFromPct(row.readiness);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = '#ef5350';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  advisor.rows.forEach((row, i) => {
    const x = xFromDay(row.day);
    const y = yFromPct((row.rootRot || 0) * 100);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const rx = xFromDay(advisor.recommendedDay);
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(rx, pad.top);
  ctx.lineTo(rx, pad.top + ch);
  ctx.stroke();

  if (typeof activeDay === 'number' && activeDay >= 0) {
    const ax = xFromDay(Math.min(activeDay, advisor.rows.length - 1));
    ctx.strokeStyle = '#000';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, pad.top);
    ctx.lineTo(ax, pad.top + ch);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.fillStyle = '#6b705c';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText('0', pad.left - 6, yFromPct(0) + 4);
  ctx.fillText('50', pad.left - 6, yFromPct(50) + 4);
  ctx.fillText('100', pad.left - 6, yFromPct(100) + 4);

  const plantDoy = parseInt(document.getElementById('growth-planting-doy')?.value, 10) || 120;
  const step = Math.max(1, Math.floor(advisor.rows.length / 5));
  ctx.textAlign = 'center';
  for (let d = 0; d < advisor.rows.length; d += step) {
    const x = xFromDay(d);
    ctx.fillText(doyToDate(plantDoy + d), x, h - 5);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#66bb6a';
  ctx.fillRect(pad.left, 8, 12, 3);
  ctx.fillStyle = '#2d3a2d';
  ctx.fillText('Readiness', pad.left + 16, 12);

  ctx.fillStyle = '#ef5350';
  ctx.fillRect(pad.left + 88, 8, 12, 3);
  ctx.fillStyle = '#2d3a2d';
  ctx.fillText('Root rot risk', pad.left + 104, 12);
}

function drawHardeningPlanChart(advisor) {
  const canvas = document.getElementById('growth-chart-hardening');
  if (!canvas || !advisor || !advisor.hardeningPlan.length) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 16, right: 14, bottom: 24, left: 36 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const count = Math.max(1, advisor.hardeningPlan.length - 1);

  const xFromIdx = (idx) => pad.left + (idx / count) * cw;
  const yFromPct = (pct) => pad.top + ch - (clamp(pct / 100, 0, 1) * ch);

  ctx.strokeStyle = 'rgba(45, 58, 45, 0.15)';
  ctx.lineWidth = 0.5;
  [0, 25, 50, 75, 100].forEach((pct) => {
    const y = yFromPct(pct);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
  });

  ctx.strokeStyle = '#26a69a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  advisor.hardeningPlan.forEach((step, idx) => {
    const x = xFromIdx(idx);
    const y = yFromPct((step.exposureHours / 12) * 100);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = '#ff7043';
  ctx.lineWidth = 2;
  ctx.beginPath();
  advisor.hardeningPlan.forEach((step, idx) => {
    const x = xFromIdx(idx);
    const y = yFromPct(step.shock * 100);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 167, 38, 0.9)';
  ctx.setLineDash([4, 4]);
  const thresholdY = yFromPct(35);
  ctx.beginPath();
  ctx.moveTo(pad.left, thresholdY);
  ctx.lineTo(pad.left + cw, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#6b705c';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText('0', pad.left - 6, yFromPct(0) + 4);
  ctx.fillText('50', pad.left - 6, yFromPct(50) + 4);
  ctx.fillText('100', pad.left - 6, yFromPct(100) + 4);

  ctx.textAlign = 'center';
  advisor.hardeningPlan.forEach((step, idx) => {
    ctx.fillText(`D${step.step}`, xFromIdx(idx), h - 5);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = '#26a69a';
  ctx.fillRect(pad.left, 8, 12, 3);
  ctx.fillStyle = '#2d3a2d';
  ctx.fillText('Exposure hours', pad.left + 16, 12);

  ctx.fillStyle = '#ff7043';
  ctx.fillRect(pad.left + 118, 8, 12, 3);
  ctx.fillStyle = '#2d3a2d';
  ctx.fillText('Shock risk', pad.left + 134, 12);
}

function renderTransplantAdvisor(advisor, activeDay) {
  const wrap = document.getElementById('growth-transplant-advisor');
  const summary = document.getElementById('growth-advisor-summary');
  const math = document.getElementById('growth-advisor-math');
  const steps = document.getElementById('growth-hardening-steps');
  if (!wrap || !summary || !math || !steps) return;

  wrap.hidden = false;

  const plantDoy = parseInt(document.getElementById('growth-planting-doy')?.value, 10) || 120;
  const recDate = doyToDate(plantDoy + advisor.recommendedDay);
  const recSnap = advisor.recommended.snap;
  const recRootRotPct = Math.round(advisor.recommended.rootRot * 100);

  const currentDay = typeof activeDay === 'number' ? activeDay : getCurrentSliderDay();
  const clampedCurrent = Math.max(0, Math.min(currentDay, advisor.rows.length - 1));
  const currentRow = advisor.rows[clampedCurrent];

  let timingMsg = 'You are at the recommended transplant window.';
  let timingClass = 'growth-advisor-status--good';
  if (clampedCurrent < advisor.recommendedDay - 2) {
    timingMsg = `Current day ${clampedCurrent} is early. Keep building roots and run hardening steps first.`;
    timingClass = 'growth-advisor-status--warn';
  } else if (clampedCurrent > advisor.recommendedDay + 5) {
    timingMsg = `Current day ${clampedCurrent} is late. Risk of stress creep rises if root rot pressure keeps climbing.`;
    timingClass = 'growth-advisor-status--warn';
  }

  summary.innerHTML = `
    <div class="growth-advisor-grid">
      <div class="growth-advisor-card">
        <div class="growth-advisor-card-label">Recommended Transplant</div>
        <div class="growth-advisor-card-value">Day ${advisor.recommendedDay} (${escapeHtml(recDate)})</div>
        <div class="growth-advisor-card-note">Readiness ${advisor.recommended.readiness}% | confidence ${advisor.transplantConfidence}%</div>
      </div>
      <div class="growth-advisor-card">
        <div class="growth-advisor-card-label">Why This Day</div>
        <div class="growth-advisor-card-value">Root ${recSnap.root_depth_cm.toFixed(1)} cm, Leaves ${recSnap.leaf_count}</div>
        <div class="growth-advisor-card-note">Root rot threat ${recRootRotPct}% | stage ${escapeHtml((recSnap.stage || '').replace(/_/g, ' '))}</div>
      </div>
      <div class="growth-advisor-card">
        <div class="growth-advisor-card-label">If You Transplant Today</div>
        <div class="growth-advisor-card-value">Day ${clampedCurrent} readiness ${currentRow.readiness}%</div>
        <div class="growth-advisor-card-note">Estimated root-rot pressure ${Math.round(currentRow.rootRot * 100)}%</div>
      </div>
    </div>
    <div class="growth-advisor-status ${timingClass}">${escapeHtml(timingMsg)}</div>
  `;

  math.innerHTML = `
    <div class="growth-advisor-math-line"><strong>Readiness score</strong> = 100 x (0.34*Root + 0.20*Leaves + 0.19*Growth + 0.13*NightTemp + 0.14*Stage) x (1 - 0.62*StressPenalty)</div>
    <div class="growth-advisor-math-line"><strong>StressPenalty</strong> = 0.55*RootRot + 0.45*Frost + 0.25*Heat + 0.20*Drought</div>
    <div class="growth-advisor-math-line"><strong>Hardening shock</strong> = clamp((LightGap/12) x (1 - 0.45*Acclimation) + max(0, TempGap - (3 + 5*Acclimation))/14 + 0.20*RootRot, 0, 1)</div>
  `;

  steps.innerHTML = advisor.hardeningPlan.map((step) => {
    const date = doyToDate(plantDoy + step.dayIndex);
    const shockPct = Math.round(step.shock * 100);
    const rootRotPct = Math.round(step.rootRot * 100);

    let note = 'Good progression day.';
    if (shockPct >= 55) note = 'High shock day: hold longer in shade.';
    else if (rootRotPct >= 45) note = 'Watch overwatering/root oxygen today.';

    return `<li><strong>Day ${step.step} (${escapeHtml(date)})</strong>: ${step.exposureHours.toFixed(1)}h outside, shock ${shockPct}%, confidence ${step.confidence}% — ${escapeHtml(note)}</li>`;
  }).join('');
}

function updateTransplantAdvisor(activeDay = null, forceRebuild = false) {
  const wrap = document.getElementById('growth-transplant-advisor');
  if (!seasonData || seasonData.length < 2) {
    transplantAdvisorCache = null;
    if (wrap) wrap.hidden = true;
    return;
  }

  if (forceRebuild || !transplantAdvisorCache) {
    transplantAdvisorCache = buildTransplantAdvisorData();
  }

  if (!transplantAdvisorCache) {
    if (wrap) wrap.hidden = true;
    return;
  }

  const day = typeof activeDay === 'number' ? activeDay : getCurrentSliderDay();
  renderTransplantAdvisor(transplantAdvisorCache, day);
  drawTransplantReadinessChart(transplantAdvisorCache, day);
  drawHardeningPlanChart(transplantAdvisorCache);
}


// ── Current conditions + alerts rendering ──

function renderCurrentConditions(obs) {
  let container = document.getElementById('growth-current-conditions');
  if (!container) {
    // Create container after weather badge
    const badge = document.getElementById('growth-weather-badge');
    if (!badge) return;
    container = document.createElement('div');
    container.id = 'growth-current-conditions';
    container.className = 'growth-current-box';
    badge.parentElement.insertBefore(container, badge.nextSibling);
  }

  if (!obs) {
    container.hidden = true;
    return;
  }

  const tempF = obs.temp_c != null ? (obs.temp_c * 9 / 5 + 32).toFixed(0) : '—';
  const tempC = obs.temp_c != null ? obs.temp_c.toFixed(1) : '—';
  const humidity = obs.humidity_pct != null ? obs.humidity_pct.toFixed(0) : '—';
  const wind = obs.wind_speed_ms != null ? obs.wind_speed_ms.toFixed(1) : '—';
  const vpd = obs.vpd_kpa != null ? obs.vpd_kpa.toFixed(2) : '—';
  const dewpt = obs.dewpoint_c != null ? obs.dewpoint_c.toFixed(1) : '—';
  const src = obs.source === 'nws' ? `NWS · ${obs.station}` : 'Open-Meteo';
  const time = obs.timestamp ? new Date(obs.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  container.innerHTML = `
    <div class="growth-current-header">
      <strong>📡 Current Conditions</strong>
      <span class="growth-hint">${src} · ${time}</span>
    </div>
    <div class="growth-current-grid">
      <span class="growth-current-item">🌡️ ${tempC}°C / ${tempF}°F</span>
      <span class="growth-current-item">💧 ${humidity}% RH</span>
      <span class="growth-current-item">🌬️ ${wind} m/s</span>
      <span class="growth-current-item">🔬 VPD ${vpd} kPa</span>
      <span class="growth-current-item">💦 Dew ${dewpt}°C</span>
      <span class="growth-current-item">${obs.description || ''}</span>
    </div>
  `;
  container.hidden = false;
}

function renderWeatherAlerts(alerts) {
  let container = document.getElementById('growth-weather-alerts');
  if (!container) {
    const conditions = document.getElementById('growth-current-conditions');
    const anchor = conditions || document.getElementById('growth-weather-badge');
    if (!anchor) return;
    container = document.createElement('div');
    container.id = 'growth-weather-alerts';
    container.className = 'growth-alerts-box';
    anchor.parentElement.insertBefore(container, anchor.nextSibling);
  }

  if (!alerts || alerts.length === 0) {
    container.hidden = true;
    return;
  }

  const sevIcon = { Extreme: '🔴', Severe: '🟠', Moderate: '🟡', Minor: '🟢', Unknown: '⚪' };

  container.innerHTML = `
    <div class="growth-alerts-header">
      <strong>⚠️ Active Weather Alerts</strong>
    </div>
    ${alerts.map(a => `
      <div class="growth-alert-item growth-alert-${a.severity.toLowerCase()}">
        <span>${sevIcon[a.severity] || '⚪'} <strong>${a.event}</strong></span>
        <span class="growth-hint">${a.headline || ''}</span>
        ${a.instruction ? `<span class="growth-hint growth-alert-action">${a.instruction}</span>` : ''}
      </div>
    `).join('')}
  `;
  container.hidden = false;
}

function renderForecastSummary(forecast) {
  let container = document.getElementById('growth-forecast-summary');
  if (!container) {
    const alerts = document.getElementById('growth-weather-alerts');
    const conditions = document.getElementById('growth-current-conditions');
    const anchor = alerts || conditions || document.getElementById('growth-weather-badge');
    if (!anchor) return;
    container = document.createElement('div');
    container.id = 'growth-forecast-summary';
    container.className = 'growth-forecast-box';
    anchor.parentElement.insertBefore(container, anchor.nextSibling);
  }

  if (!forecast || !forecast.days || forecast.days.length === 0) {
    container.hidden = true;
    return;
  }

  const src = forecast.source === 'nws' ? 'NWS Forecast' : 'Open-Meteo Forecast';
  const days = forecast.days.slice(0, 7);

  container.innerHTML = `
    <div class="growth-forecast-header">
      <strong>📅 7-Day Forecast</strong>
      <span class="growth-hint">${src}</span>
    </div>
    <div class="growth-forecast-grid">
      ${days.map(d => {
        const date = new Date(d.date + 'T12:00:00');
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const hi = d.temp_high_c != null ? d.temp_high_c.toFixed(0) : '—';
        const lo = d.temp_low_c != null ? d.temp_low_c.toFixed(0) : '—';
        const precip = d.precip_prob != null ? d.precip_prob : 0;
        const precipIcon = precip > 50 ? '🌧️' : precip > 20 ? '🌦️' : '☀️';
        return `<div class="growth-forecast-day">
          <span class="growth-forecast-dayname">${dayName}</span>
          <span class="growth-forecast-icon">${precipIcon}</span>
          <span class="growth-forecast-temps">${hi}° / ${lo}°</span>
          ${precip > 0 ? `<span class="growth-hint">${precip}%</span>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;
  container.hidden = false;
}

// ── Weather controls ──

function initWeatherControls() {
  const toggle = document.getElementById('growth-weather-toggle');
  const yearField = document.getElementById('growth-weather-year-field');
  const yearSelect = document.getElementById('growth-weather-year');
  if (!toggle || !yearSelect) return;

  // Populate year picker: 2020 → last full year
  const thisYear = new Date().getFullYear();
  for (let y = thisYear - 1; y >= 2020; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
  }
  yearSelect.value = defaultWeatherYear();

  // Toggle behavior: show year picker, dim manual temp fields
  toggle.addEventListener('change', () => {
    const on = toggle.checked;
    if (yearField) yearField.hidden = !on;

    const tempH = document.getElementById('growth-temp-high');
    const tempL = document.getElementById('growth-temp-low');
    if (tempH) tempH.closest('.growth-field').style.opacity = on ? '0.4' : '1';
    if (tempL) tempL.closest('.growth-field').style.opacity = on ? '0.4' : '1';
  });
}

/** Draw real weather temperature overlay on the growth height chart. */
function drawTempOverlay(ctx, pad, cw, ch, numDays) {
  if (!weatherData || weatherData.length === 0) return;

  // Find temp range
  let tMin = Infinity, tMax = -Infinity;
  for (const w of weatherData) {
    if (w.temp_high_c != null && w.temp_high_c > tMax) tMax = w.temp_high_c;
    if (w.temp_low_c != null && w.temp_low_c < tMin) tMin = w.temp_low_c;
  }
  if (tMin === Infinity) return;

  // Add margin
  tMin = Math.floor(tMin - 2);
  tMax = Math.ceil(tMax + 2);
  const tRange = tMax - tMin || 1;

  const plotW = cw - pad.left - pad.right;
  const plotH = ch - pad.top - pad.bottom;

  function x(day) { return pad.left + (day / (numDays - 1)) * plotW; }
  function y(temp) { return pad.top + plotH - ((temp - tMin) / tRange) * plotH; }

  // Draw high temps (dashed red)
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#e07050';
  ctx.beginPath();
  for (let i = 0; i < Math.min(weatherData.length, numDays); i++) {
    const w = weatherData[i];
    if (w.temp_high_c == null) continue;
    if (i === 0) ctx.moveTo(x(i), y(w.temp_high_c));
    else ctx.lineTo(x(i), y(w.temp_high_c));
  }
  ctx.stroke();

  // Draw low temps (dashed blue)
  ctx.strokeStyle = '#5080c0';
  ctx.beginPath();
  for (let i = 0; i < Math.min(weatherData.length, numDays); i++) {
    const w = weatherData[i];
    if (w.temp_low_c == null) continue;
    if (i === 0) ctx.moveTo(x(i), y(w.temp_low_c));
    else ctx.lineTo(x(i), y(w.temp_low_c));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Right axis labels
  ctx.fillStyle = '#8a7060';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = tMin + (tRange * i / steps);
    ctx.fillText(Math.round(t) + '°', cw - pad.right + 4, y(t) + 3);
  }
  ctx.restore();
}

// ── Optimizer controls ──

function initOptimizerControls() {
  const btn = document.getElementById('growth-optimize-btn');
  const closeBtn = document.getElementById('optimizer-close-btn');
  const applyBtn = document.getElementById('opt-apply-btn');
  if (!btn) return;

  btn.addEventListener('click', runOptimizer);

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('growth-optimizer-panel').hidden = true;
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', applyOptimalSettings);
  }
}

let lastOptimizerResult = null;

async function runOptimizer() {
  const plantId = document.getElementById('growth-plant-select').value;
  const plant = plants.find(p => p.id === plantId);
  if (!plant) return;

  const latitude = parseFloat(document.getElementById('growth-latitude').value) || 42;
  const tempHigh = parseFloat(document.getElementById('growth-temp-high').value) || 28;
  const tempLow = parseFloat(document.getElementById('growth-temp-low').value) || 16;
  const soilKey = document.getElementById('growth-soil-select').value;
  const soil = SOIL_TYPES[soilKey] || SOIL_TYPES.loam;
  const currentDoy = parseInt(document.getElementById('growth-planting-doy').value) || 120;
  const currentWater = parseFloat(document.getElementById('growth-water').value) || 600;
  const currentN = 10; // default N

  const panel = document.getElementById('growth-optimizer-panel');
  const progress = document.getElementById('optimizer-progress');
  const progressFill = document.getElementById('optimizer-progress-fill');
  const progressLabel = document.getElementById('optimizer-progress-label');
  const resultsDiv = document.getElementById('optimizer-results');

  // Show panel, progress
  panel.hidden = false;
  progress.hidden = false;
  resultsDiv.hidden = true;

  const btn = document.getElementById('growth-optimize-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Optimizing…';

  // Use requestAnimationFrame to keep UI responsive
  await new Promise(resolve => requestAnimationFrame(resolve));

  // Run the sweep
  const result = optimizeGrowth(plant, latitude, soil, tempHigh, tempLow, (pct) => {
    progressFill.style.width = (pct * 100) + '%';
    progressLabel.textContent = `Sweeping… ${Math.round(pct * 100)}%`;
  });

  // Get current settings score
  const current = compareWithCurrent(plant, latitude, soil, currentDoy, currentWater, currentN, tempHigh, tempLow);

  // Get sensitivity at optimal point
  const sensitivity = sensitivityAnalysis(
    plant, latitude, soil,
    result.best.doy, result.best.waterMl, result.best.nAvail,
    tempHigh, tempLow
  );

  lastOptimizerResult = { ...result, current, sensitivity, soilKey };

  // Render results
  progress.hidden = true;
  resultsDiv.hidden = false;
  btn.disabled = false;
  btn.textContent = '🔬 Optimize';

  renderOptimizerResults(result, current, sensitivity, plant, soilKey);
}

function renderOptimizerResults(result, current, sensitivity, plant, soilKey) {
  const best = result.best;

  // Current vs Optimal scores
  const curScoreEl = document.getElementById('opt-current-score');
  const bestScoreEl = document.getElementById('opt-best-score');

  curScoreEl.textContent = (current.score * 100).toFixed(1) + '%';
  bestScoreEl.textContent = (best.score * 100).toFixed(1) + '%';

  // Color the scores
  curScoreEl.style.color = scoreColor(current.score);
  bestScoreEl.style.color = scoreColor(best.score);

  // Breakdown details
  document.getElementById('opt-current-details').innerHTML = breakdownHtml(current);
  document.getElementById('opt-best-details').innerHTML = breakdownHtml(best);

  // Recommendations
  const recs = document.getElementById('opt-recommendations');
  const improvement = ((best.score - current.score) / current.score * 100);
  const impStr = improvement > 0 ? `+${improvement.toFixed(0)}%` : `${improvement.toFixed(0)}%`;

  let html = `<div class="opt-rec-summary">`;
  html += `<strong>${plant.name}</strong> in <strong>${soilKey}</strong> soil — `;
  if (improvement > 10) {
    html += `<span class="opt-gain">${impStr} potential gain</span>`;
  } else if (improvement > 0) {
    html += `<span class="opt-minor">${impStr} marginal gain — your settings are close</span>`;
  } else {
    html += `<span class="opt-optimal">Your current settings are near optimal!</span>`;
  }
  html += `</div>`;

  html += `<ul class="opt-rec-list">`;
  html += `<li><strong>Plant:</strong> ${doyLabel(best.doy)} (DOY ${best.doy})</li>`;
  html += `<li><strong>Water:</strong> ${best.waterMl} mL/day</li>`;
  html += `<li><strong>Nitrogen:</strong> ${best.nAvail} g/m²</li>`;
  if (best.raw) {
    html += `<li><strong>Peak yield:</strong> ${best.raw.peakYield.toFixed(2)} kg/m²</li>`;
    html += `<li><strong>Avg growth rate:</strong> ${(best.raw.avgGrowthRate * 100).toFixed(0)}%</li>`;
    html += `<li><strong>Stress-free days:</strong> ${(best.raw.stressFreePct * 100).toFixed(0)}%</li>`;
  }
  html += `</ul>`;

  recs.innerHTML = html;

  // Draw sensitivity charts
  drawSensitivityChart('opt-chart-date', sensitivity.dateSweep, 'delta', 'Planting Date Δ days', best.doy);
  drawSensitivityChart('opt-chart-water', sensitivity.waterSweep, 'water', 'Water mL/day', best.waterMl);
  drawSensitivityChart('opt-chart-nitrogen', sensitivity.nSweep, 'n', 'Nitrogen g/m²', best.nAvail);

  // Draw landscape
  drawLandscapeChart(result.landscape, best.doy);
}

function scoreColor(score) {
  if (score >= 0.8) return 'var(--cup-color-success, #4a7c59)';
  if (score >= 0.5) return 'var(--cup-color-accent, #dda15e)';
  return 'var(--cup-color-error, #bc4749)';
}

function breakdownHtml(scored) {
  if (!scored.breakdown) return '';
  const b = scored.breakdown;
  const rows = [
    ['Yield', b.peakYield, 35],
    ['Growth Rate', b.avgGrowthRate, 25],
    ['Stress-Free', b.stressFreePct, 20],
    ['Height', b.heightRatio, 10],
    ['GDD Eff.', b.gddEfficiency, 10],
  ];
  return rows.map(([label, val, weight]) => {
    const pct = ((val || 0) * 100).toFixed(0);
    const bar = `<div class="opt-bar"><div class="opt-bar-fill" style="width:${pct}%;background:${scoreColor(val)}"></div></div>`;
    return `<div class="opt-detail-row"><span class="opt-detail-label">${label} (${weight}%)</span>${bar}<span class="opt-detail-val">${pct}%</span></div>`;
  }).join('');
}

function drawSensitivityChart(canvasId, data, xKey, xlabel, optVal) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data || data.length === 0) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, right: 10, bottom: 30, left: 40 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'var(--cup-color-surface-alt, #e8f4fd)';
  ctx.fillRect(0, 0, w, h);

  const scores = data.map(d => d.score);
  const sMin = Math.min(...scores) * 0.95;
  const sMax = Math.max(...scores) * 1.02;
  const sRange = sMax - sMin || 0.01;

  function xPos(i) { return pad.left + (i / (data.length - 1)) * pw; }
  function yPos(s) { return pad.top + ph - ((s - sMin) / sRange) * ph; }

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ph * i / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  // Line
  ctx.strokeStyle = 'var(--cup-color-primary, #588157)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = xPos(i), y = yPos(data[i].score);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Dots
  for (let i = 0; i < data.length; i++) {
    ctx.fillStyle = 'var(--cup-color-primary, #588157)';
    ctx.beginPath();
    ctx.arc(xPos(i), yPos(data[i].score), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlight optimal
  const optIdx = data.findIndex(d => {
    if (xKey === 'delta') return d.delta === 0;
    if (xKey === 'water') return d.water === optVal;
    if (xKey === 'n') return d.n === optVal;
    return false;
  });
  if (optIdx >= 0) {
    ctx.fillStyle = 'var(--cup-color-accent, #dda15e)';
    ctx.beginPath();
    ctx.arc(xPos(optIdx), yPos(data[optIdx].score), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // X labels
  ctx.fillStyle = 'var(--cup-color-text-muted, #6b705c)';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(data.length / 5));
  for (let i = 0; i < data.length; i += step) {
    let label;
    if (xKey === 'delta') label = (data[i].delta > 0 ? '+' : '') + data[i].delta + 'd';
    else if (xKey === 'water') label = data[i].water;
    else label = data[i].n;
    ctx.fillText(label, xPos(i), h - 5);
  }

  // Y labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = sMin + (sRange * (4 - i) / 4);
    ctx.fillText((v * 100).toFixed(0) + '%', pad.left - 4, pad.top + (ph * i / 4) + 3);
  }

  // Title
  ctx.fillStyle = 'var(--cup-color-on-surface, #2d3a2d)';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(xlabel, w / 2, h - 16);
}

function drawLandscapeChart(landscape, optDoy) {
  const canvas = document.getElementById('opt-chart-landscape');
  if (!canvas || !landscape || landscape.length === 0) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const pad = { top: 15, right: 15, bottom: 30, left: 45 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'var(--cup-color-surface-alt, #e8f4fd)';
  ctx.fillRect(0, 0, w, h);

  const scores = landscape.map(d => d.score);
  const sMin = Math.min(...scores) * 0.9;
  const sMax = Math.max(...scores) * 1.02;
  const sRange = sMax - sMin || 0.01;

  function xPos(i) { return pad.left + (i / (landscape.length - 1)) * pw; }
  function yPos(s) { return pad.top + ph - ((s - sMin) / sRange) * ph; }

  // Filled area
  ctx.beginPath();
  ctx.moveTo(xPos(0), pad.top + ph);
  for (let i = 0; i < landscape.length; i++) {
    ctx.lineTo(xPos(i), yPos(landscape[i].score));
  }
  ctx.lineTo(xPos(landscape.length - 1), pad.top + ph);
  ctx.closePath();
  ctx.fillStyle = 'rgba(88, 129, 87, 0.15)';
  ctx.fill();

  // Line
  ctx.strokeStyle = 'var(--cup-color-primary, #588157)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < landscape.length; i++) {
    const x = xPos(i), y = yPos(landscape[i].score);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Highlight optimal DOY
  const optIdx = landscape.findIndex(d => d.doy === optDoy);
  if (optIdx >= 0) {
    ctx.fillStyle = 'var(--cup-color-accent, #dda15e)';
    ctx.beginPath();
    ctx.arc(xPos(optIdx), yPos(landscape[optIdx].score), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = 'var(--cup-color-on-surface, #2d3a2d)';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(doyLabel(optDoy), xPos(optIdx), yPos(landscape[optIdx].score) - 10);
  }

  // Month labels on x axis
  ctx.fillStyle = 'var(--cup-color-text-muted, #6b705c)';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let m = 0; m < 12; m++) {
    const midDoy = Math.round(m * 30.44 + 15);
    const idx = landscape.findIndex(d => d.doy >= midDoy);
    if (idx >= 0) {
      ctx.fillText(months[m], xPos(idx), h - 5);
    }
  }

  // Y axis
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = sMin + (sRange * (4 - i) / 4);
    ctx.fillText((v * 100).toFixed(0) + '%', pad.left - 4, pad.top + (ph * i / 4) + 3);
  }
}

function applyOptimalSettings() {
  if (!lastOptimizerResult || !lastOptimizerResult.best) return;
  const best = lastOptimizerResult.best;

  // Apply DOY
  const doyInput = document.getElementById('growth-planting-doy');
  const dateInput = document.getElementById('growth-planting-date');
  if (doyInput) doyInput.value = best.doy;
  if (dateInput) dateInput.value = doyToIso(best.doy);

  // Apply water
  const waterInput = document.getElementById('growth-water');
  if (waterInput) {
    waterInput.value = best.waterMl;
    waterInput.dispatchEvent(new Event('input'));
  }

  // Close panel and run simulation
  document.getElementById('growth-optimizer-panel').hidden = true;
  runSimulation();
}
