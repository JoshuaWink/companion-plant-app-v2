/**
 * Growth Simulator — UI module
 *
 * Wires the growth panel controls to the WASM simulate_season() function,
 * renders height/spread/root curves on canvas, shows snapshot cards,
 * and lets the user scrub through days with a slider.
 */
import { simulate_season } from './pkg/companion_graph.js';

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

// ── Zone → latitude mapping (approximate center of each zone band) ──
const ZONE_LAT = {
  '1a': 65, '1b': 63, '2a': 60, '2b': 58,
  '3a': 55, '3b': 53, '4a': 50, '4b': 48,
  '5a': 45, '5b': 43, '6a': 40, '6b': 38,
  '7a': 36, '7b': 34, '8a': 32, '8b': 31,
  '9a': 29, '9b': 28, '10a': 27, '10b': 26,
  '11a': 25, '11b': 24, '12a': 22, '12b': 20, '13a': 18, '13b': 16,
};

// ── US cities with lat + typical temps + zone ──
const CITIES = [
  { name: 'Anchorage, AK',      lat: 61.2, zone: '4b', tempH: 18, tempL: 8 },
  { name: 'Minneapolis, MN',    lat: 44.9, zone: '4b', tempH: 27, tempL: 16 },
  { name: 'Denver, CO',         lat: 39.7, zone: '5b', tempH: 30, tempL: 14 },
  { name: 'Chicago, IL',        lat: 41.9, zone: '5b', tempH: 28, tempL: 17 },
  { name: 'Boston, MA',         lat: 42.4, zone: '6a', tempH: 27, tempL: 17 },
  { name: 'Seattle, WA',        lat: 47.6, zone: '8b', tempH: 24, tempL: 13 },
  { name: 'Portland, OR',       lat: 45.5, zone: '8b', tempH: 26, tempL: 13 },
  { name: 'Kansas City, MO',    lat: 39.1, zone: '6a', tempH: 31, tempL: 19 },
  { name: 'Nashville, TN',      lat: 36.2, zone: '7a', tempH: 31, tempL: 19 },
  { name: 'Charlotte, NC',      lat: 35.2, zone: '7b', tempH: 32, tempL: 20 },
  { name: 'Atlanta, GA',        lat: 33.7, zone: '7b', tempH: 32, tempL: 21 },
  { name: 'Dallas, TX',         lat: 32.8, zone: '8a', tempH: 35, tempL: 23 },
  { name: 'Austin, TX',         lat: 30.3, zone: '8b', tempH: 35, tempL: 22 },
  { name: 'Phoenix, AZ',        lat: 33.4, zone: '9b', tempH: 41, tempL: 25 },
  { name: 'Los Angeles, CA',    lat: 34.1, zone: '10a', tempH: 28, tempL: 16 },
  { name: 'San Francisco, CA',  lat: 37.8, zone: '10a', tempH: 21, tempL: 12 },
  { name: 'San Diego, CA',      lat: 32.7, zone: '10b', tempH: 25, tempL: 16 },
  { name: 'Miami, FL',          lat: 25.8, zone: '10b', tempH: 33, tempL: 24 },
  { name: 'Honolulu, HI',       lat: 21.3, zone: '12a', tempH: 31, tempL: 23 },
  { name: 'New York, NY',       lat: 40.7, zone: '7a', tempH: 28, tempL: 18 },
  { name: 'Philadelphia, PA',   lat: 40.0, zone: '7a', tempH: 29, tempL: 18 },
  { name: 'Washington, DC',     lat: 38.9, zone: '7a', tempH: 30, tempL: 19 },
  { name: 'Detroit, MI',        lat: 42.3, zone: '6a', tempH: 27, tempL: 16 },
  { name: 'St. Louis, MO',      lat: 38.6, zone: '6b', tempH: 31, tempL: 19 },
  { name: 'Salt Lake City, UT', lat: 40.8, zone: '6b', tempH: 32, tempL: 15 },
  { name: 'Boise, ID',          lat: 43.6, zone: '6b', tempH: 32, tempL: 13 },
  { name: 'Albuquerque, NM',    lat: 35.1, zone: '7a', tempH: 33, tempL: 15 },
  { name: 'Raleigh, NC',        lat: 35.8, zone: '7b', tempH: 31, tempL: 19 },
  { name: 'Pittsburgh, PA',     lat: 40.4, zone: '6b', tempH: 27, tempL: 16 },
  { name: 'Columbus, OH',       lat: 40.0, zone: '6a', tempH: 28, tempL: 16 },
  { name: 'Indianapolis, IN',   lat: 39.8, zone: '5b', tempH: 28, tempL: 17 },
  { name: 'Milwaukee, WI',      lat: 43.0, zone: '5b', tempH: 26, tempL: 15 },
  { name: 'Omaha, NE',          lat: 41.3, zone: '5b', tempH: 29, tempL: 16 },
  { name: 'Tucson, AZ',         lat: 32.2, zone: '9a', tempH: 38, tempL: 21 },
  { name: 'Tampa, FL',          lat: 28.0, zone: '9b', tempH: 33, tempL: 22 },
  { name: 'Sacramento, CA',     lat: 38.6, zone: '9b', tempH: 34, tempL: 14 },
  { name: 'Des Moines, IA',     lat: 41.6, zone: '5a', tempH: 28, tempL: 16 },
  { name: 'Dubuque, IA',        lat: 42.5, zone: '5a', tempH: 27, tempL: 14 },
];

let plants = [];
let seasonData = null;

function setLatitude(lat, label) {
  document.getElementById('growth-latitude').value = lat.toFixed(1);
  const el = document.getElementById('growth-loc-label');
  if (el) el.textContent = label || '';
  // Save preference
  try { localStorage.setItem('growth-location', JSON.stringify({ lat, label })); } catch(e) {}
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
    setLatitude(lat, `Zone ${z} (~${lat}°N)`);
  }

  // City change
  citySelect.addEventListener('change', onCityChange);
  function onCityChange() {
    const idx = parseInt(citySelect.value);
    const city = citySelect._cities[idx];
    if (!city) return;
    setLatitude(city.lat, `${city.name}`);
    // Also set temp defaults from city data
    document.getElementById('growth-temp-high').value = city.tempH;
    document.getElementById('growth-temp-low').value = city.tempL;
  }

  // Manual lat change
  latInput.addEventListener('change', () => {
    const lat = parseFloat(latInput.value) || 42;
    setLatitude(lat, `${lat.toFixed(1)}°`);
  });

  // Restore saved preference
  try {
    const saved = JSON.parse(localStorage.getItem('growth-location'));
    if (saved) {
      setLatitude(saved.lat, saved.label || '');
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
      setLatitude(lat, `📍 ${lat.toFixed(2)}°N`);
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
}

// ── Run simulation ──
function runSimulation() {
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

  const env = {
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
    const resultJson = simulate_season(
      JSON.stringify(plant),
      numDays,
      JSON.stringify(env)
    );
    seasonData = JSON.parse(resultJson);
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
    ? snap.stress_events.map(s =>
        `<span class="growth-stress-tag growth-stress--${s.severity > 0.5 ? 'high' : 'low'}">${s.kind.replace(/_/g, ' ')}</span>`
      ).join(' ')
    : '<span class="growth-no-stress">No stress detected</span>';

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
    </div>
    <div class="growth-snap-stress">${stressHtml}</div>
  `;

  // Draw cursor on chart
  drawHeightCursor(day);

  // Update raw JSON
  document.getElementById('growth-raw-json').textContent =
    JSON.stringify(snap, null, 2);
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
  ctx.strokeStyle = '#334';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch - (i / 4) * ch;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cw, y);
    ctx.stroke();
    ctx.fillStyle = '#8899aa';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`${(maxVal * i / 4).toFixed(0)}`, pad.left - 6, y + 4);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8899aa';
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
    ctx.fillStyle = '#aabbcc';
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
  ctx.fillStyle = '#8899aa';
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
  seasonData.forEach((snap, i) => {
    if (snap.stress_events.length > 0) {
      const x = pad.left + (i / (seasonData.length - 1)) * cw;
      const maxSev = Math.max(...snap.stress_events.map(s => s.severity));
      ctx.fillStyle = maxSev > 0.5
        ? 'rgba(239, 83, 80, 0.8)'
        : 'rgba(255, 167, 38, 0.6)';
      ctx.beginPath();
      ctx.arc(x, pad.top + ch - maxSev * ch, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Y-axis
  ctx.fillStyle = '#8899aa';
  ctx.textAlign = 'right';
  ctx.fillText('0%', pad.left - 6, pad.top + ch + 4);
  ctx.fillText('100%', pad.left - 6, pad.top + 4);
}
