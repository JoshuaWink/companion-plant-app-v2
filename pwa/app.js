/**
 * Companion Garden — App Module
 *
 * Loads WASM graph engine, renders plant chips, handles selection,
 * queries the graph for companions/conflicts/succession dependencies.
 */
import init, { Garden } from './pkg/companion_graph.js';

let garden = null;
let plants = [];
let selected = new Set();
let showStubs = false;

// --- Plant Emoji Map ---
const PLANT_EMOJI = {
  'basil': '🌿',
  'bell-peppers': '🫑',
  'broccoli': '🥦',
  'brussels-sprouts': '🥬',
  'cabbage': '🥬',
  'carrots': '🥕',
  'cauliflower': '🥦',
  'celery': '🌿',
  'chives': '🌱',
  'cilantro': '🌿',
  'corn': '🌽',
  'cucumbers': '🥒',
  'dill': '🌾',
  'habanero-peppers': '🌶️',
  'jalapeno-peppers': '🌶️',
  'lettuce': '🥬',
  'okra': '🌺',
  'oregano': '🌿',
  'parsley': '🌿',
  'peas': '🫛',
  'potatoes': '🥔',
  'poblano-peppers': '🌶️',
  'rosemary': '🌿',
  'sage': '🍃',
  'serrano-peppers': '🌶️',
  'spinach': '🥬',
  'sweet-potatoes': '🍠',
  'summer-squash': '🎃',
  'thyme': '🌱',
  'tomatoes': '🍅',
};

function emojiFor(id) {
  return PLANT_EMOJI[id] || '🌱';
}

// --- Helpers ---

function getVisiblePlants(query) {
  let visible = showStubs ? plants : plants.filter(p => !p.stub);
  if (query) {
    const q = query.toLowerCase().trim();
    visible = visible.filter(p =>
      p.name.toLowerCase().includes(q) || p.id.includes(q)
    );
  }
  return visible;
}

function updateCounts() {
  const el = document.getElementById('plant-count');
  if (el) {
    const visible = getVisiblePlants();
    el.textContent = visible.length + ' plants';
  }
}

function setupStubToggle() {
  const cb = document.getElementById('show-stubs');
  if (!cb) return;
  cb.addEventListener('change', () => {
    showStubs = cb.checked;
    updateCounts();
    const searchInput = document.getElementById('plant-search');
    const q = searchInput ? searchInput.value : '';
    renderPlantGrid(getVisiblePlants(q));
  });
}

// --- Init ---

async function boot() {
  await init();

  const [plantsResp, relsResp] = await Promise.all([
    fetch('data/plants.json'),
    fetch('data/relationships.json'),
  ]);

  const plantsJson = await plantsResp.text();
  const relsJson = await relsResp.text();
  plants = JSON.parse(plantsJson);

  garden = new Garden(plantsJson, relsJson);

  updateCounts();
  renderPlantGrid(getVisiblePlants());
  setupSearch();
  setupStubToggle();
  await loadZones();
}

// --- Render ---

function renderPlantGrid(visiblePlants) {
  const grid = document.getElementById('plant-grid');
  grid.innerHTML = '';

  const sorted = [...visiblePlants].sort((a, b) => {
    if (a.stub !== b.stub) return a.stub ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  for (const plant of sorted) {
    const chip = document.createElement('button');
    chip.className = 'plant-chip' + (plant.stub ? ' stub' : '');
    chip.innerHTML = `<span class="plant-emoji">${emojiFor(plant.id)}</span> ${plant.name}`;
    chip.dataset.id = plant.id;
    chip.setAttribute('role', 'option');
    chip.setAttribute('aria-selected', selected.has(plant.id) ? 'true' : 'false');
    chip.addEventListener('click', () => togglePlant(plant.id));
    grid.appendChild(chip);
  }

  updateHighlights();
}

function setupSearch() {
  const input = document.getElementById('plant-search');
  input.addEventListener('input', () => {
    renderPlantGrid(getVisiblePlants(input.value));
  });
}

// --- Selection ---

function togglePlant(id) {
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  updateUI();
}

function updateUI() {
  updateSelectedPanel();
  updateHighlights();
  updateResults();
  updateSuccession();
  updateTimeline();
}

function updateSelectedPanel() {
  const container = document.getElementById('selected-plants');
  const badge = document.getElementById('selected-count');

  if (badge) {
    badge.textContent = selected.size;
    badge.hidden = selected.size === 0;
  }

  if (selected.size === 0) {
    container.innerHTML = '<p class="empty-state">Pick some plants above to get started</p>';
    return;
  }

  container.innerHTML = '';
  for (const id of selected) {
    const plant = plants.find(p => p.id === id);
    if (!plant) continue;
    const chip = document.createElement('button');
    chip.className = 'plant-chip';
    chip.setAttribute('aria-selected', 'true');
    chip.innerHTML = `<span class="plant-emoji">${emojiFor(id)}</span> ${plant.name} ×`;
    chip.addEventListener('click', () => togglePlant(id));
    container.appendChild(chip);
  }
}

function updateHighlights() {
  const chips = document.querySelectorAll('.plant-chip[data-id]');

  const companionSet = new Set();
  const antagonistSet = new Set();

  for (const id of selected) {
    const companions = JSON.parse(garden.companions(id));
    const antagonists = JSON.parse(garden.antagonists(id));
    companions.forEach(c => companionSet.add(c));
    antagonists.forEach(a => antagonistSet.add(a));
  }

  chips.forEach(chip => {
    const id = chip.dataset.id;
    chip.setAttribute('aria-selected', selected.has(id) ? 'true' : 'false');
    chip.classList.toggle('companion-highlight',
      !selected.has(id) && companionSet.has(id));
    chip.classList.toggle('antagonist-highlight',
      !selected.has(id) && antagonistSet.has(id));
  });
}

function updateResults() {
  const conflictsPanel = document.getElementById('conflicts-panel');
  const conflictList = document.getElementById('conflict-list');
  const companionsPanel = document.getElementById('companions-panel');
  const companionList = document.getElementById('companion-list');
  const noSelectionMsg = document.getElementById('no-selection-msg');
  const allClearMsg = document.getElementById('all-clear-msg');
  const conflictCount = document.getElementById('conflict-count');
  const companionCount = document.getElementById('companion-count');

  if (selected.size === 0) {
    conflictsPanel.hidden = true;
    companionsPanel.hidden = true;
    if (noSelectionMsg) noSelectionMsg.hidden = false;
    if (allClearMsg) allClearMsg.hidden = true;
    return;
  }

  if (noSelectionMsg) noSelectionMsg.hidden = true;

  const plantIds = JSON.stringify([...selected]);
  const conflicts = JSON.parse(garden.conflicts(plantIds));

  if (conflicts.length > 0) {
    conflictsPanel.hidden = false;
    conflictList.innerHTML = conflicts.map(c =>
      `<li>${emojiFor(c.source)} <strong>${nameFor(c.source)}</strong> ✕ ${emojiFor(c.target)} <strong>${nameFor(c.target)}</strong>` +
      (c.reason ? `<span class="reason">${c.reason}</span>` : '') +
      `</li>`
    ).join('');
  } else {
    conflictsPanel.hidden = true;
  }

  if (conflictCount) conflictCount.textContent = conflicts.length || '';

  const companionSets = [...selected].map(id =>
    new Set(JSON.parse(garden.companions(id)))
  );

  let shared = companionSets.length > 0
    ? companionSets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))))
    : new Set();

  shared = new Set([...shared].filter(x => !selected.has(x)));

  if (shared.size > 0) {
    companionsPanel.hidden = false;
    companionList.innerHTML = [...shared].map(id => {
      const reasons = [...selected].map(sel => {
        const rel = JSON.parse(garden.relationship(sel, id));
        return rel && rel.reason ? `${nameFor(sel)}: ${rel.reason}` : null;
      }).filter(Boolean);

      return `<li>${emojiFor(id)} <strong>${nameFor(id)}</strong>` +
        (reasons.length > 0 ? `<span class="reason">${reasons.join(' | ')}</span>` : '') +
        `</li>`;
    }).join('');
  } else {
    companionsPanel.hidden = true;
  }

  if (companionCount) companionCount.textContent = shared.size || '';

  if (allClearMsg) {
    allClearMsg.hidden = conflicts.length > 0 || selected.size === 0;
  }
}

// --- Succession ---

function updateSuccession() {
  const panel = document.getElementById('succession-panel');
  const list = document.getElementById('succession-list');
  const countBadge = document.getElementById('succession-count');

  if (!panel || !list) return;

  if (selected.size < 2) {
    panel.hidden = true;
    return;
  }

  const plantIds = JSON.stringify([...selected]);
  const deps = JSON.parse(garden.temporal_deps(plantIds));

  if (deps.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  if (countBadge) countBadge.textContent = deps.length;

  list.innerHTML = deps.map(d => {
    const gapText = d.gap_days > 0
      ? `<span class="succession-gap">(${d.gap_days} day gap)</span>`
      : '';
    return `<li>${emojiFor(d.predecessor)} <strong>${nameFor(d.predecessor)}</strong>` +
      `<span class="succession-arrow">→</span>` +
      `${emojiFor(d.successor)} <strong>${nameFor(d.successor)}</strong>` +
      gapText +
      (d.reason ? `<span class="reason">${d.reason}</span>` : '') +
      `</li>`;
  }).join('');
}

function nameFor(id) {
  const p = plants.find(x => x.id === id);
  return p ? p.name : id;
}

// --- Timeline ---

let zones = {};

async function loadZones() {
  const resp = await fetch('data/zones.json');
  zones = await resp.json();
  populateZoneSelector();
}

function populateZoneSelector() {
  const select = document.getElementById('zone-select');
  if (!select) return;

  const sorted = Object.keys(zones).sort((a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  for (const z of sorted) {
    const opt = document.createElement('option');
    opt.value = z;
    opt.textContent = `Zone ${z}`;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => updateTimeline());
}

function mmddToDoy(mmdd) {
  const [mm, dd] = mmdd.split('-').map(Number);
  const d = new Date(2023, mm - 1, dd);
  const jan1 = new Date(2023, 0, 1);
  return Math.floor((d - jan1) / 86400000) + 1;
}

function doyToPercent(doy) {
  return (doy / 365) * 100;
}

function updateTimeline() {
  const select = document.getElementById('zone-select');
  const emptyMsg = document.getElementById('timeline-empty');
  const chart = document.getElementById('timeline-chart');
  const frostInfo = document.getElementById('frost-info');
  const rowsContainer = document.getElementById('timeline-rows');

  const zoneId = select ? select.value : '';

  if (!zoneId || selected.size === 0) {
    if (emptyMsg) emptyMsg.hidden = false;
    if (chart) chart.hidden = true;
    if (frostInfo) frostInfo.textContent = '';
    return;
  }

  const zone = zones[zoneId];
  if (!zone) return;

  const lastFrostDoy = mmddToDoy(zone.last_frost_avg);

  if (frostInfo) {
    frostInfo.textContent =
      `Last frost: ${zone.last_frost_avg} · First frost: ${zone.first_frost_avg} · ${zone.growing_season_days} day season`;
  }

  const timingMap = {};
  for (const id of selected) {
    const plant = plants.find(p => p.id === id);
    if (plant && plant.timing) {
      timingMap[id] = plant.timing;
    }
  }

  if (Object.keys(timingMap).length === 0) {
    if (emptyMsg) {
      emptyMsg.hidden = false;
      emptyMsg.textContent = 'Selected plants have no timing data';
    }
    if (chart) chart.hidden = true;
    return;
  }

  const windowsJson = garden.planting_windows(JSON.stringify(timingMap), lastFrostDoy);
  const windows = JSON.parse(windowsJson);
  windows.sort((a, b) => a.outdoor_earliest_doy - b.outdoor_earliest_doy);

  if (emptyMsg) emptyMsg.hidden = true;
  if (chart) chart.hidden = false;

  rowsContainer.innerHTML = '';

  for (const w of windows) {
    const row = document.createElement('div');
    row.className = 'timeline-row';

    const label = document.createElement('div');
    label.className = 'timeline-row-label';
    label.textContent = `${emojiFor(w.plant_id)} ${nameFor(w.plant_id)}`;
    label.title = nameFor(w.plant_id);

    const bars = document.createElement('div');
    bars.className = 'timeline-row-bars';

    // Last frost line
    const frostLine = document.createElement('div');
    frostLine.className = 'timeline-frost-line';
    frostLine.style.left = doyToPercent(lastFrostDoy) + '%';
    frostLine.title = 'Last frost';
    bars.appendChild(frostLine);

    // Today marker
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const todayDoy = Math.floor((now - jan1) / 86400000) + 1;
    const todayLine = document.createElement("div");
    todayLine.className = "timeline-today-line";
    todayLine.style.left = doyToPercent(todayDoy) + "%";
    todayLine.title = "Today (day " + todayDoy + ")";
    bars.appendChild(todayLine);

    // Indoor start bar
    if (w.indoor_start_doy) {
      const bar = document.createElement('div');
      bar.className = 'timeline-bar timeline-bar--indoor';
      bar.style.left = doyToPercent(w.indoor_start_doy) + '%';
      bar.style.width = doyToPercent(w.outdoor_earliest_doy - w.indoor_start_doy) + '%';
      bar.title = `Indoor: day ${w.indoor_start_doy} - ${w.outdoor_earliest_doy}`;
      bars.appendChild(bar);
    }

    // Outdoor bar
    const outdoorBar = document.createElement('div');
    outdoorBar.className = 'timeline-bar timeline-bar--outdoor';
    outdoorBar.style.left = doyToPercent(w.outdoor_earliest_doy) + '%';
    outdoorBar.style.width = doyToPercent(w.harvest_start_doy - w.outdoor_earliest_doy) + '%';
    outdoorBar.title = `Outdoor: day ${w.outdoor_earliest_doy} - ${w.harvest_start_doy}`;
    bars.appendChild(outdoorBar);

    // Harvest bar
    const harvestBar = document.createElement('div');
    harvestBar.className = 'timeline-bar timeline-bar--harvest';
    harvestBar.style.left = doyToPercent(w.harvest_start_doy) + '%';
    harvestBar.style.width = doyToPercent(w.harvest_end_doy - w.harvest_start_doy) + '%';
    harvestBar.title = `Harvest: day ${w.harvest_start_doy} - ${w.harvest_end_doy}`;
    bars.appendChild(harvestBar);

    row.appendChild(label);
    row.appendChild(bars);
    rowsContainer.appendChild(row);
  }
}

// --- Boot ---
boot().catch(err => {
  console.error('Failed to initialize Companion Garden:', err);
  document.getElementById('main').innerHTML =
    `<p style="color: var(--cup-color-error)">Failed to load: ${err.message}</p>`;
});

// --- Night Mode ---

function initNightMode() {
  const toggle = document.getElementById('night-toggle');
  const icon = document.getElementById('night-toggle-icon');
  const label = document.getElementById('night-toggle-label');
  if (!toggle) return;

  // Restore saved preference
  const saved = localStorage.getItem('garden-theme');
  if (saved === 'night') {
    document.documentElement.setAttribute('data-theme', 'night');
    icon.textContent = '\u2600\uFE0F';
    label.textContent = 'Day';
    spawnNightDecorations();
  }

  toggle.addEventListener('click', () => {
    const isNight = document.documentElement.getAttribute('data-theme') === 'night';
    if (isNight) {
      document.documentElement.removeAttribute('data-theme');
      icon.textContent = '\uD83C\uDF19';
      label.textContent = 'Night';
      localStorage.setItem('garden-theme', 'day');
    } else {
      document.documentElement.setAttribute('data-theme', 'night');
      icon.textContent = '\u2600\uFE0F';
      label.textContent = 'Day';
      localStorage.setItem('garden-theme', 'night');
      spawnNightDecorations();
    }
  });
}

function spawnNightDecorations() {
  const canvas = document.getElementById('firefly-canvas');
  if (!canvas || canvas.childElementCount > 0) return;

  // Fireflies — 18 drifting luminous dots
  for (let i = 0; i < 18; i++) {
    const fly = document.createElement('div');
    fly.className = 'firefly';
    fly.style.left = Math.random() * 95 + '%';
    fly.style.top = (20 + Math.random() * 70) + '%';
    fly.style.setProperty('--fly-duration', (10 + Math.random() * 14) + 's');
    fly.style.setProperty('--fly-delay', (Math.random() * -15) + 's');
    fly.style.setProperty('--glow-duration', (2 + Math.random() * 4) + 's');
    fly.style.setProperty('--glow-delay', (Math.random() * -5) + 's');
    fly.style.setProperty('--dx1', (-80 + Math.random() * 160) + 'px');
    fly.style.setProperty('--dy1', (-60 + Math.random() * 120) + 'px');
    fly.style.setProperty('--dx2', (-80 + Math.random() * 160) + 'px');
    fly.style.setProperty('--dy2', (-60 + Math.random() * 120) + 'px');
    fly.style.setProperty('--dx3', (-80 + Math.random() * 160) + 'px');
    fly.style.setProperty('--dy3', (-60 + Math.random() * 120) + 'px');
    canvas.appendChild(fly);
  }

  // Stars — 25 tiny twinklers in the upper portion
  for (let i = 0; i < 25; i++) {
    const star = document.createElement('div');
    star.className = 'night-star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 35 + '%';
    star.style.setProperty('--twinkle-dur', (3 + Math.random() * 5) + 's');
    star.style.setProperty('--twinkle-delay', (Math.random() * -6) + 's');
    if (Math.random() > 0.7) {
      star.style.width = '3px';
      star.style.height = '3px';
    }
    canvas.appendChild(star);
  }

  // Crickets — 6 pulsing green dots near the bottom
  for (let i = 0; i < 6; i++) {
    const cricket = document.createElement('div');
    cricket.className = 'cricket';
    cricket.style.left = (10 + Math.random() * 80) + '%';
    cricket.style.bottom = (10 + Math.random() * 40) + 'px';
    cricket.style.animationDelay = (Math.random() * 3) + 's';
    canvas.appendChild(cricket);
  }
}

// Init night mode immediately (no WASM dependency)
initNightMode();
