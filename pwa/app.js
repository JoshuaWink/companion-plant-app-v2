/**
 * Companion Garden — App Module
 *
 * Loads WASM graph engine, renders plant chips, handles selection,
 * and queries the graph for companions/conflicts.
 */
import init, { Garden } from './pkg/companion_graph.js';

let garden = null;
let plants = [];
let selected = new Set();
let showStubs = false;

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

  // Sort: full plants first (alphabetical), stubs after
  const sorted = [...visiblePlants].sort((a, b) => {
    if (a.stub !== b.stub) return a.stub ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  for (const plant of sorted) {
    const chip = document.createElement('button');
    chip.className = 'plant-chip' + (plant.stub ? ' stub' : '');
    chip.textContent = plant.name;
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
    chip.textContent = plant.name + ' ×';
    chip.addEventListener('click', () => togglePlant(id));
    container.appendChild(chip);
  }
}

function updateHighlights() {
  const chips = document.querySelectorAll('.plant-chip[data-id]');

  // Gather all companions and antagonists of selected plants
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

  // Conflicts among selected plants
  const plantIds = JSON.stringify([...selected]);
  const conflicts = JSON.parse(garden.conflicts(plantIds));

  if (conflicts.length > 0) {
    conflictsPanel.hidden = false;
    conflictList.innerHTML = conflicts.map(c =>
      `<li><strong>${nameFor(c.source)}</strong> ✕ <strong>${nameFor(c.target)}</strong>` +
      (c.reason ? `<span class="reason">${c.reason}</span>` : '') +
      `</li>`
    ).join('');
  } else {
    conflictsPanel.hidden = true;
  }

  if (conflictCount) conflictCount.textContent = conflicts.length || '';

  // Shared companions (plants that are companions to ALL selected)
  const companionSets = [...selected].map(id =>
    new Set(JSON.parse(garden.companions(id)))
  );

  let shared = companionSets.length > 0
    ? companionSets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))))
    : new Set();

  // Remove already-selected from shared companions
  shared = new Set([...shared].filter(x => !selected.has(x)));

  if (shared.size > 0) {
    companionsPanel.hidden = false;
    companionList.innerHTML = [...shared].map(id => {
      // Get why it's a companion for each selected plant
      const reasons = [...selected].map(sel => {
        const rel = JSON.parse(garden.relationship(sel, id));
        return rel && rel.reason ? `${nameFor(sel)}: ${rel.reason}` : null;
      }).filter(Boolean);

      return `<li><strong>${nameFor(id)}</strong>` +
        (reasons.length > 0 ? `<span class="reason">${reasons.join(' | ')}</span>` : '') +
        `</li>`;
    }).join('');
  } else {
    companionsPanel.hidden = true;
  }

  if (companionCount) companionCount.textContent = shared.size || '';

  // Show "all clear" when plants selected but no conflicts
  if (allClearMsg) {
    allClearMsg.hidden = conflicts.length > 0 || selected.size === 0;
  }
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
    label.textContent = nameFor(w.plant_id);
    label.title = nameFor(w.plant_id);

    const bars = document.createElement('div');
    bars.className = 'timeline-row-bars';

    // Last frost line
    const frostLine = document.createElement('div');
    frostLine.className = 'timeline-frost-line';
    frostLine.style.left = doyToPercent(lastFrostDoy) + '%';
    frostLine.title = 'Last frost';
    bars.appendChild(frostLine);

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
