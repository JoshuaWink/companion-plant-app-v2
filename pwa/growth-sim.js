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

let plants = [];
let seasonData = null;

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

  // Run button
  document.getElementById('growth-run-btn')
    .addEventListener('click', runSimulation);

  // Day slider
  document.getElementById('growth-day-slider')
    .addEventListener('input', onDaySlider);
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

  document.getElementById('growth-day-label').textContent = day;

  // Stage badge
  const badge = document.getElementById('growth-stage-badge');
  badge.textContent = snap.stage.replace('_', ' ');
  badge.style.backgroundColor = STAGE_COLORS[snap.stage] || '#666';

  // Snapshot card
  const card = document.getElementById('growth-snapshot');
  const stressHtml = snap.stress_events.length > 0
    ? snap.stress_events.map(s =>
        `<span class="growth-stress-tag growth-stress--${s.severity > 0.5 ? 'high' : 'low'}">${s.kind.replace(/_/g, ' ')}</span>`
      ).join(' ')
    : '<span class="growth-no-stress">No stress</span>';

  card.innerHTML = `
    <div class="growth-snap-grid">
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.height_cm.toFixed(1)}</span>
        <span class="growth-snap-unit">cm height</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.spread_cm.toFixed(1)}</span>
        <span class="growth-snap-unit">cm spread</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.root_depth_cm.toFixed(1)}</span>
        <span class="growth-snap-unit">cm root depth</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.leaf_count}</span>
        <span class="growth-snap-unit">leaves</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.growth_rate.toFixed(2)}</span>
        <span class="growth-snap-unit">growth rate</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.dli.toFixed(1)}</span>
        <span class="growth-snap-unit">DLI mol/m²/d</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.gdd_accumulated.toFixed(0)}</span>
        <span class="growth-snap-unit">GDD accumulated</span>
      </div>
      <div class="growth-snap-metric">
        <span class="growth-snap-val">${snap.yield_projected_kg.toFixed(2)}</span>
        <span class="growth-snap-unit">kg/m² yield</span>
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
  for (let d = 0; d < seasonData.length; d += step) {
    const x = pad.left + (d / (seasonData.length - 1)) * cw;
    ctx.fillText(`d${d}`, x, h - 6);
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

  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
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
