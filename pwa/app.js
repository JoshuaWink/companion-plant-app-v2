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

// --- Boot ---
boot().catch(err => {
  console.error('Failed to initialize Companion Garden:', err);
  document.getElementById('main').innerHTML =
    `<p style="color: var(--cup-color-error)">Failed to load: ${err.message}</p>`;
});
