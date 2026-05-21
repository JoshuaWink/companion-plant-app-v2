/**
 * Companion Garden — App Module
 *
 * Loads WASM graph engine, renders plant chips, handles selection,
 * queries the graph for companions/conflicts/succession dependencies.
 */
import init, { Garden } from './pkg/companion_graph.js';
import { initPlanner } from './planner.js';

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

  // Init bed planner with plant data and WASM engine
  initPlanner(plants, garden, emojiFor);
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
  updateStats();
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
// --- Garden Stats ---

function updateStats() {
  const panel = document.getElementById('stats-panel');
  if (!panel) return;

  if (selected.size < 2) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const sel = [...selected].map(id => plants.find(p => p.id === id)).filter(Boolean);
  const props = sel.map(p => p.properties).filter(Boolean);

  if (props.length === 0) {
    panel.hidden = true;
    return;
  }

  // --- Nitrogen Balance ---
  const nitrogenScores = { 'fixer': 2, 'light-feeder': 0, 'neutral': 0, 'heavy-feeder': -1 };
  const nitrogenRaw = props.reduce((sum, p) => sum + (nitrogenScores[p.nitrogen_role] || 0), 0);
  const fixerCount = props.filter(p => p.nitrogen_role === 'fixer').length;
  const feederCount = props.filter(p => p.nitrogen_role === 'heavy-feeder').length;
  const nitrogenMax = props.length * 2;
  const nitrogenPct = Math.min(100, Math.max(0, ((nitrogenRaw + nitrogenMax) / (nitrogenMax * 2)) * 100));
  let nitrogenLevel, nitrogenLabel;
  if (nitrogenRaw >= 1) { nitrogenLevel = 'great'; nitrogenLabel = 'Positive (+' + nitrogenRaw + ') — ' + fixerCount + ' fixer(s) feeding ' + feederCount + ' feeder(s)'; }
  else if (nitrogenRaw === 0) { nitrogenLevel = 'good'; nitrogenLabel = 'Balanced — inputs match demand'; }
  else if (nitrogenRaw >= -2) { nitrogenLevel = 'okay'; nitrogenLabel = 'Slightly negative (' + nitrogenRaw + ') — consider adding a legume'; }
  else { nitrogenLevel = 'low'; nitrogenLabel = 'Deficit (' + nitrogenRaw + ') — add peas or beans for nitrogen'; }
  setGauge('nitrogen', nitrogenPct, nitrogenLevel, nitrogenLabel);

  // --- Root Diversity ---
  const depthSet = new Set(props.map(p => p.root_depth).filter(Boolean));
  const rootPct = (depthSet.size / 3) * 100;
  const rootLevel = depthSet.size >= 3 ? 'great' : depthSet.size >= 2 ? 'good' : 'okay';
  const missing = ['shallow', 'medium', 'deep'].filter(d => !depthSet.has(d));
  const rootLabel = depthSet.size >= 3
    ? 'Full coverage — shallow + medium + deep'
    : depthSet.size + '/3 layers — missing ' + missing.join(', ');
  setGauge('roots', rootPct, rootLevel, rootLabel);

  // --- Vertical Coverage ---
  const habitSet = new Set(props.map(p => p.growth_habit).filter(Boolean));
  const allHabits = ['ground-cover', 'low', 'medium', 'tall', 'climbing'];
  const vertPct = (habitSet.size / allHabits.length) * 100;
  const vertLevel = habitSet.size >= 4 ? 'great' : habitSet.size >= 3 ? 'good' : habitSet.size >= 2 ? 'okay' : 'low';
  const vertMissing = allHabits.filter(h => !habitSet.has(h));
  const vertLabel = habitSet.size >= 4
    ? 'Excellent — ' + habitSet.size + ' growth layers'
    : habitSet.size + '/' + allHabits.length + ' layers — missing ' + vertMissing.join(', ');
  setGauge('vertical', vertPct, vertLevel, vertLabel);

  // --- Water Demand ---
  const waterScores = { 'low': 1, 'medium': 2, 'high': 3 };
  const waterAvg = props.reduce((s, p) => s + (waterScores[p.water_need] || 2), 0) / props.length;
  const waterPct = (waterAvg / 3) * 100;
  const waterLevel = waterAvg <= 1.5 ? 'water-low' : waterAvg <= 2.2 ? 'water-med' : 'water-high';
  const waterLabel = waterAvg <= 1.5
    ? 'Low demand — drought-friendly selection'
    : waterAvg <= 2.2
    ? 'Moderate demand — regular watering needed'
    : 'High demand — consider drought-tolerant additions';
  setGauge('water', waterPct, waterLevel, waterLabel);

  // --- Pollinator Score ---
  const pollinatorTotal = props.reduce((s, p) => s + (p.pollinator_score || 0), 0);
  const pollinatorMax = props.length * 3;
  const pollinatorPct = (pollinatorTotal / pollinatorMax) * 100;
  const pollinatorLevel = pollinatorPct >= 60 ? 'great' : pollinatorPct >= 35 ? 'good' : pollinatorPct >= 15 ? 'okay' : 'low';
  const pollinatorLabel = pollinatorPct >= 60
    ? 'Strong (' + pollinatorTotal + '/' + pollinatorMax + ') — great beneficial insect habitat'
    : pollinatorPct >= 35
    ? 'Moderate (' + pollinatorTotal + '/' + pollinatorMax + ') — add herbs for more pollinators'
    : 'Weak (' + pollinatorTotal + '/' + pollinatorMax + ') — add basil, dill, or chives';
  setGauge('pollinator', pollinatorPct, pollinatorLevel, pollinatorLabel);

  // --- Family Diversity ---
  const familySet = new Set(sel.map(p => p.family).filter(Boolean));
  const familyPct = Math.min(100, (familySet.size / sel.length) * 100);
  const familyLevel = familySet.size >= sel.length * 0.7 ? 'great' : familySet.size >= sel.length * 0.5 ? 'good' : 'okay';
  const familyLabel = familySet.size + ' families across ' + sel.length + ' plants — ' + (
    familySet.size >= sel.length * 0.7 ? 'excellent diversity' : 'some overlap, watch for disease pressure'
  );
  setGauge('family', familyPct, familyLevel, familyLabel);

  // --- Pest Coverage ---
  const pestList = document.getElementById('stat-pest-list');
  const allPests = new Set();
  props.forEach(p => (p.pest_deters || []).forEach(pest => allPests.add(pest)));
  if (allPests.size > 0) {
    pestList.innerHTML = [...allPests].sort().map(pest =>
      '<span class="pest-chip pest-chip--covered">' + pest.replace(/-/g, ' ') + '</span>'
    ).join('');
  } else {
    pestList.innerHTML = '<span class="stat-value">No pest deterrence — add herbs like basil, dill, or rosemary</span>';
  }

  // --- Suggestions ---
  const suggestions = [];
  if (fixerCount === 0 && feederCount > 0) {
    suggestions.push('Add a nitrogen fixer (peas) to feed your ' + feederCount + ' heavy feeder(s)');
  }
  if (!habitSet.has('ground-cover') && sel.length >= 3) {
    suggestions.push('No ground cover — spinach, squash, or thyme would shade the soil');
  }
  if (!habitSet.has('tall') && !habitSet.has('climbing') && sel.length >= 3) {
    suggestions.push('No vertical structure — corn, tomatoes, or peas would use upper space');
  }
  if (pollinatorTotal === 0) {
    suggestions.push('No pollinator attractors — flowering herbs draw beneficial insects');
  }
  if (allPests.size === 0 && sel.length >= 2) {
    suggestions.push('No pest deterrence — aromatic herbs provide natural protection');
  }
  if (waterAvg > 2.5) {
    suggestions.push('High water demand — rosemary, thyme, or sage need less water');
  }

  const sugEl = document.getElementById('stat-suggestions');
  sugEl.innerHTML = suggestions.map(s =>
    '<div class="suggestion">' + s + '</div>'
  ).join('');

  // Refresh visual diagrams
  updateVisuals();

  // Refresh detail table if open
  updateStatsDetail();
}


function setGauge(id, pct, level, label) {
  const fill = document.getElementById('stat-' + id);
  const val = document.getElementById('stat-' + id + '-val');
  if (fill) {
    fill.style.width = pct + '%';
    fill.dataset.level = level;
  }
  if (val) val.textContent = label;
}
// --- Stats Detail Toggle ---


// --- Garden Visual Diagrams ---

function updateVisuals() {
  const visuals = document.getElementById('stats-visuals');
  if (!visuals) return;

  const sel = [...selected].map(id => plants.find(p => p.id === id)).filter(Boolean);
  const props = sel.map(p => p.properties).filter(Boolean);

  if (props.length === 0) return;

  updateRootDiagram(sel, props);
  updateLayerDiagram(sel, props);
  updateBalanceDiagram(sel, props);
}

function updateRootDiagram(sel, props) {
  const depths = { shallow: [], medium: [], deep: [] };

  sel.forEach((p, i) => {
    const pr = p.properties;
    if (!pr || !pr.root_depth) return;
    const d = pr.root_depth;
    if (depths[d]) depths[d].push(p);
  });

  ['shallow', 'medium', 'deep'].forEach(depth => {
    const container = document.getElementById('soil-' + depth + '-plants');
    const layer = container.closest('.soil-layer');
    if (!container) return;

    if (depths[depth].length === 0) {
      layer.classList.add('soil-empty');
      container.innerHTML = '<span class="soil-gap-hint">no plants here</span>';
    } else {
      layer.classList.remove('soil-empty');
      container.innerHTML = depths[depth].map(p =>
        '<span class="soil-plant">' + emojiFor(p.id) + ' ' + p.name + '</span>'
      ).join('');
    }
  });
}

function updateLayerDiagram(sel, props) {
  const tiers = {
    'climbing': [],
    'tall': [],
    'medium': [],
    'low': [],
    'ground-cover': []
  };

  sel.forEach(p => {
    const pr = p.properties;
    if (!pr || !pr.growth_habit) return;
    const h = pr.growth_habit;
    if (tiers[h]) tiers[h].push(p);
  });

  Object.keys(tiers).forEach(tier => {
    const container = document.getElementById('tier-' + tier);
    const row = container ? container.closest('.height-tier') : null;
    if (!container || !row) return;

    if (tiers[tier].length === 0) {
      row.classList.add('tier-empty');
      container.innerHTML = '<span class="tier-gap-hint">empty layer</span>';
    } else {
      row.classList.remove('tier-empty');
      container.innerHTML = tiers[tier].map(p =>
        '<span class="tier-plant">' + emojiFor(p.id) + ' ' + p.name + '</span>'
      ).join('');
    }
  });
}

function updateBalanceDiagram(sel, props) {
  const nitrogenScores = { 'fixer': 2, 'light-feeder': 0, 'neutral': 0, 'heavy-feeder': -1 };
  const fixers = [];
  const feeders = [];
  const neutrals = [];

  sel.forEach(p => {
    const pr = p.properties;
    if (!pr) return;
    const role = pr.nitrogen_role;
    if (role === 'fixer') fixers.push(p);
    else if (role === 'heavy-feeder') feeders.push(p);
    else neutrals.push(p);
  });

  // Render fixer side
  const fixerEl = document.getElementById('balance-fixer-plants');
  fixerEl.innerHTML = fixers.map(p =>
    '<span class="balance-plant balance-plant--fixer">' + emojiFor(p.id) + ' ' + p.name + '</span>'
  ).join('') || '<span class="tier-gap-hint">none</span>';

  // Render feeder side
  const feederEl = document.getElementById('balance-feeder-plants');
  feederEl.innerHTML = feeders.map(p =>
    '<span class="balance-plant balance-plant--feeder">' + emojiFor(p.id) + ' ' + p.name + '</span>'
  ).join('') || '<span class="tier-gap-hint">none</span>';

  // Neutrals below feeders (smaller)
  if (neutrals.length > 0) {
    feederEl.innerHTML += '<div style="width:100%;margin-top:2px">' + neutrals.map(p =>
      '<span class="balance-plant balance-plant--neutral">' + emojiFor(p.id) + '</span>'
    ).join(' ') + '</div>';
  }

  // Tilt the beam
  const nRaw = props.reduce((s, p) => s + (nitrogenScores[p.nitrogen_role] || 0), 0);
  const beam = document.getElementById('balance-beam');
  const maxTilt = 12; // degrees
  const tilt = Math.max(-maxTilt, Math.min(maxTilt, -nRaw * 3));
  beam.style.transform = 'rotate(' + tilt + 'deg)';

  // Score badge
  const scoreEl = document.getElementById('balance-score');
  const sign = nRaw > 0 ? 'positive' : nRaw < 0 ? 'negative' : 'neutral';
  const prefix = nRaw > 0 ? '+' : '';
  scoreEl.textContent = prefix + nRaw;
  scoreEl.dataset.sign = sign;
}

function initStatsDetail() {
  const toggle = document.getElementById('stats-detail-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const detail = document.getElementById('stats-detail');
    const isOpen = !detail.hidden;
    detail.hidden = isOpen;
    toggle.setAttribute('aria-pressed', isOpen ? 'false' : 'true');
    document.getElementById('stats-detail-label').textContent = isOpen ? 'Details' : 'Summary';
    if (!isOpen) updateStatsDetail();
  });
}

function updateStatsDetail() {
  const detail = document.getElementById('stats-detail');
  if (!detail || detail.hidden) return;

  const sel = [...selected].map(id => plants.find(p => p.id === id)).filter(Boolean);
  const props = sel.map(p => p.properties).filter(Boolean);

  // --- Per-plant attribute table ---
  const tbody = document.getElementById('stats-table-body');
  const nitrogenIcons = { 'fixer': '+N', 'heavy-feeder': '-N', 'light-feeder': '~', 'neutral': '~' };
  const nitrogenClass = { 'fixer': 'cell-fixer', 'heavy-feeder': 'cell-heavy', 'light-feeder': 'cell-light', 'neutral': 'cell-neutral' };
  const waterClass = { 'low': 'cell-pill--low', 'medium': 'cell-pill--med', 'high': 'cell-pill--high' };
  const sunClass = { 'full': 'cell-pill--full', 'partial': 'cell-pill--partial', 'shade': 'cell-pill--low' };

  tbody.innerHTML = sel.map((p, i) => {
    const pr = p.properties || {};
    const pests = (pr.pest_deters || []).map(d => d.replace(/-/g, ' ')).join(', ') || '—';
    return '<tr>' +
      '<td>' + emojiFor(p.id) + ' ' + p.name + '</td>' +
      '<td class="' + (nitrogenClass[pr.nitrogen_role] || '') + '">' + (nitrogenIcons[pr.nitrogen_role] || '?') + '</td>' +
      '<td>' + (pr.root_depth || '?') + '</td>' +
      '<td>' + (pr.growth_habit || '?') + '</td>' +
      '<td><span class="cell-pill ' + (waterClass[pr.water_need] || '') + '">' + (pr.water_need || '?') + '</span></td>' +
      '<td><span class="cell-pill ' + (sunClass[pr.sun_need] || '') + '">' + (pr.sun_need || '?') + '</span></td>' +
      '<td>' + (pr.pollinator_score != null ? pr.pollinator_score + '/3' : '?') + '</td>' +
      '<td>' + (pr.yield_density || '?') + '</td>' +
      '<td>' + pests + '</td>' +
      '</tr>';
  }).join('');

  // --- Raw aggregated numbers ---
  const rawEl = document.getElementById('stats-raw');
  const nitrogenScores = { 'fixer': 2, 'light-feeder': 0, 'neutral': 0, 'heavy-feeder': -1 };
  const waterScores = { 'low': 1, 'medium': 2, 'high': 3 };

  const nRaw = props.reduce((s, p) => s + (nitrogenScores[p.nitrogen_role] || 0), 0);
  const fixers = props.filter(p => p.nitrogen_role === 'fixer').length;
  const heavyFeeders = props.filter(p => p.nitrogen_role === 'heavy-feeder').length;
  const lightFeeders = props.filter(p => p.nitrogen_role === 'light-feeder').length;

  const depthCounts = {};
  const habitCounts = {};
  const waterCounts = {};
  const familyCounts = {};
  const allPests = {};

  props.forEach(p => {
    depthCounts[p.root_depth] = (depthCounts[p.root_depth] || 0) + 1;
    habitCounts[p.growth_habit] = (habitCounts[p.growth_habit] || 0) + 1;
    waterCounts[p.water_need] = (waterCounts[p.water_need] || 0) + 1;
    (p.pest_deters || []).forEach(pest => { allPests[pest] = (allPests[pest] || 0) + 1; });
  });
  sel.forEach(p => {
    if (p.family) familyCounts[p.family] = (familyCounts[p.family] || 0) + 1;
  });

  const polTotal = props.reduce((s, p) => s + (p.pollinator_score || 0), 0);
  const polMax = props.length * 3;
  const waterAvg = props.reduce((s, p) => s + (waterScores[p.water_need] || 2), 0) / props.length;

  function fmtMap(obj) {
    return Object.entries(obj).sort((a,b) => b[1] - a[1]).map(([k,v]) => k + ': ' + v).join(', ');
  }

  rawEl.innerHTML =
    '<div class="raw-section"><span class="raw-label">Nitrogen Budget:</span> ' +
    '<span class="raw-value">score=' + nRaw + ' (fixers=' + fixers + ' heavy=' + heavyFeeders + ' light=' + lightFeeders + ')</span></div>' +

    '<div class="raw-section"><span class="raw-label">Root Layers:</span> ' +
    '<span class="raw-value">' + Object.keys(depthCounts).length + '/3 &mdash; ' + fmtMap(depthCounts) + '</span></div>' +

    '<div class="raw-section"><span class="raw-label">Growth Layers:</span> ' +
    '<span class="raw-value">' + Object.keys(habitCounts).length + '/5 &mdash; ' + fmtMap(habitCounts) + '</span></div>' +

    '<div class="raw-section"><span class="raw-label">Water Demand:</span> ' +
    '<span class="raw-value">avg=' + waterAvg.toFixed(2) + '/3.00 &mdash; ' + fmtMap(waterCounts) + '</span></div>' +

    '<div class="raw-section"><span class="raw-label">Pollinator:</span> ' +
    '<span class="raw-value">' + polTotal + '/' + polMax + ' (' + (polTotal/polMax*100).toFixed(0) + '%)</span></div>' +

    '<div class="raw-section"><span class="raw-label">Families:</span> ' +
    '<span class="raw-value">' + Object.keys(familyCounts).length + '/' + sel.length + ' &mdash; ' + fmtMap(familyCounts) + '</span></div>' +

    '<div class="raw-section"><span class="raw-label">Pest Coverage:</span> ' +
    '<span class="raw-value">' + Object.keys(allPests).length + ' pests &mdash; ' + (Object.keys(allPests).length > 0 ? fmtMap(allPests) : 'none') + '</span></div>';
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
      spawnDayDecorations();
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

function spawnDayDecorations() {
  const canvas = document.getElementById('day-canvas');
  if (!canvas || canvas.childElementCount > 0) return;

  // Sun rays — rotating conic gradient beam
  const ray = document.createElement('div');
  ray.className = 'day-ray';
  canvas.appendChild(ray);

  // Clouds — 4 drifting cloud emojis at different speeds/heights
  const cloudEmojis = ['☁️', '⛅', '☁️', '⛅'];
  for (let i = 0; i < 4; i++) {
    const cloud = document.createElement('div');
    cloud.className = 'day-cloud';
    cloud.textContent = cloudEmojis[i];
    cloud.style.top = (8 + i * 7 + Math.random() * 5) + '%';
    cloud.style.fontSize = (1.5 + Math.random() * 1.5) + 'rem';
    cloud.style.setProperty('--cloud-dur', (60 + Math.random() * 60) + 's');
    cloud.style.setProperty('--cloud-delay', (-Math.random() * 80) + 's');
    canvas.appendChild(cloud);
  }

  // Butterflies — 5 flitting colorful shapes
  const bfColors = ['#e88fd0', '#8fd0e8', '#e8d08f', '#8fe8a0', '#d08fe8'];
  for (let i = 0; i < 5; i++) {
    const bf = document.createElement('div');
    bf.className = 'day-butterfly';
    bf.style.left = (15 + Math.random() * 70) + '%';
    bf.style.top = (30 + Math.random() * 50) + '%';
    bf.style.setProperty('--bf-color', bfColors[i % bfColors.length]);
    bf.style.setProperty('--bf-dur', (14 + Math.random() * 12) + 's');
    bf.style.setProperty('--bf-delay', (Math.random() * -15) + 's');
    bf.style.setProperty('--bf-dx1', (-60 + Math.random() * 120) + 'px');
    bf.style.setProperty('--bf-dy1', (-40 + Math.random() * 80) + 'px');
    bf.style.setProperty('--bf-dx2', (-60 + Math.random() * 120) + 'px');
    bf.style.setProperty('--bf-dy2', (-40 + Math.random() * 80) + 'px');
    bf.style.setProperty('--bf-dx3', (-60 + Math.random() * 120) + 'px');
    bf.style.setProperty('--bf-dy3', (-40 + Math.random() * 80) + 'px');
    bf.style.setProperty('--bf-dx4', (-60 + Math.random() * 120) + 'px');
    bf.style.setProperty('--bf-dy4', (-40 + Math.random() * 80) + 'px');
    canvas.appendChild(bf);
  }

  // Bees — 4 buzzing yellow dots
  for (let i = 0; i < 4; i++) {
    const bee = document.createElement('div');
    bee.className = 'day-bee';
    bee.style.left = (20 + Math.random() * 60) + '%';
    bee.style.top = (40 + Math.random() * 40) + '%';
    bee.style.setProperty('--bee-dur', (10 + Math.random() * 10) + 's');
    bee.style.setProperty('--bee-delay', (Math.random() * -10) + 's');
    bee.style.setProperty('--bee-dx1', (-25 + Math.random() * 50) + 'px');
    bee.style.setProperty('--bee-dy1', (-20 + Math.random() * 40) + 'px');
    bee.style.setProperty('--bee-dx2', (-25 + Math.random() * 50) + 'px');
    bee.style.setProperty('--bee-dy2', (-20 + Math.random() * 40) + 'px');
    bee.style.setProperty('--bee-dx3', (-25 + Math.random() * 50) + 'px');
    bee.style.setProperty('--bee-dy3', (-20 + Math.random() * 40) + 'px');
    bee.style.setProperty('--bee-dx4', (-25 + Math.random() * 50) + 'px');
    bee.style.setProperty('--bee-dy4', (-20 + Math.random() * 40) + 'px');
    canvas.appendChild(bee);
  }

  // Dandelion seeds — 8 floating puffs drifting upward
  for (let i = 0; i < 8; i++) {
    const seed = document.createElement('div');
    seed.className = 'day-seed';
    seed.style.left = (5 + Math.random() * 90) + '%';
    seed.style.top = (60 + Math.random() * 35) + '%';
    seed.style.setProperty('--seed-dur', (15 + Math.random() * 20) + 's');
    seed.style.setProperty('--seed-delay', (-Math.random() * 20) + 's');
    seed.style.setProperty('--seed-dx', (-100 + Math.random() * 200) + 'px');
    seed.style.setProperty('--seed-dy', (-200 - Math.random() * 200) + 'px');
    canvas.appendChild(seed);
  }
}

// Init night mode immediately (no WASM dependency)
initNightMode();
spawnDayDecorations();
initStatsDetail();
