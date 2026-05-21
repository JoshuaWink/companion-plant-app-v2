/**
 * Garden Bed Planner — Interactive spatial designer
 *
 * Canvas-based bed layout tool. Place plants on a grid,
 * see companion/conflict overlays, view root profile.
 */

// ── State ──

let beds = [];          // Array of bed objects
let activeBedIdx = 0;   // Currently viewed bed
let placingPlant = null; // Plant ID being placed (null = eraser mode)
let viewMode = 'top';   // 'top' | 'side'
let hoverCell = null;    // {row, col} under cursor
let plannerPlants = [];  // Plant data (set from app.js)
let plannerGarden = null; // WASM Garden (set from app.js)
let emojiLookup = null;  // emojiFor function (set from app.js)
let canvas, ctx;
let sideCanvas, sideCtx;
let unitPref = 'metric'; // 'metric' | 'imperial'

const CELL_SIZE = 48;
const CELL_GAP = 1;
const GRID_PAD = 24;
const EMOJI_SIZE = 24;
const DEFAULT_CELL_CM = 15; // each cell = 15cm × 15cm (≈6in)

// ── Unit Conversion ──

function displayLength(cm) {
  if (unitPref === 'imperial') {
    const inches = cm / 2.54;
    if (inches >= 36) return (inches / 12).toFixed(1) + ' ft';
    return Math.round(inches) + ' in';
  }
  if (cm >= 100) return (cm / 100).toFixed(1) + ' m';
  return Math.round(cm) + ' cm';
}

function displayArea(cm2) {
  if (unitPref === 'imperial') {
    const sqft = cm2 / 929.03;
    return sqft.toFixed(1) + ' ft²';
  }
  const m2 = cm2 / 10000;
  return m2.toFixed(2) + ' m²';
}

function displayVolume(liters) {
  if (unitPref === 'imperial') {
    const gal = liters * 0.264172;
    return gal.toFixed(1) + ' gal';
  }
  return liters.toFixed(1) + ' L';
}

function displayWeight(grams) {
  if (unitPref === 'imperial') {
    const oz = grams * 0.035274;
    if (oz >= 16) return (oz / 16).toFixed(1) + ' lb';
    return oz.toFixed(1) + ' oz';
  }
  if (grams >= 1000) return (grams / 1000).toFixed(1) + ' kg';
  return Math.round(grams) + ' g';
}

// ── Bed Model ──

function createBed(name, rows, cols, shape) {
  return {
    name: name || 'Bed ' + (beds.length + 1),
    rows,
    cols,
    shape: shape || 'rectangle',  // rectangle | circle
    cells: Array.from({ length: rows }, () => Array(cols).fill(null)),
    dimensions_cm: {
      width: cols * DEFAULT_CELL_CM,
      depth: rows * DEFAULT_CELL_CM,
      soil_depth: 30,
    },
  };
}

function getActiveBed() {
  return beds[activeBedIdx] || null;
}

function cellAt(bed, row, col) {
  if (!bed || row < 0 || col < 0 || row >= bed.rows || col >= bed.cols) return undefined;
  return bed.cells[row][col];
}

function setCell(bed, row, col, plantId) {
  if (!bed || row < 0 || col < 0 || row >= bed.rows || col >= bed.cols) return;
  bed.cells[row][col] = plantId;
}

function clearBed(bed) {
  if (!bed) return;
  for (let r = 0; r < bed.rows; r++)
    for (let c = 0; c < bed.cols; c++)
      bed.cells[r][c] = null;
}

function bedPlantIds(bed) {
  const ids = new Set();
  if (!bed) return ids;
  for (let r = 0; r < bed.rows; r++)
    for (let c = 0; c < bed.cols; c++)
      if (bed.cells[r][c]) ids.add(bed.cells[r][c]);
  return ids;
}

function isInsideShape(bed, row, col) {
  if (bed.shape === 'circle') {
    const cr = (bed.rows - 1) / 2;
    const cc = (bed.cols - 1) / 2;
    const dr = (row - cr) / cr;
    const dc = (col - cc) / cc;
    return (dr * dr + dc * dc) <= 1.05;
  }
  return true; // rectangle
}

// ── Companion Analysis ──

function getCellRelationships(bed, row, col) {
  const plantId = bed.cells[row][col];
  if (!plantId || !plannerGarden) return { companions: [], conflicts: [] };

  const companions = [];
  const conflicts = [];

  // Check all 8 neighbors + same-bed plants
  const checked = new Set();
  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      if (r === row && c === col) continue;
      const neighbor = bed.cells[r][c];
      if (!neighbor || checked.has(neighbor)) continue;
      checked.add(neighbor);

      try {
        const rel = JSON.parse(plannerGarden.relationship(plantId, neighbor));
        if (rel && rel.type === 'companion') companions.push({ id: neighbor, row: r, col: c });
        else if (rel && rel.type === 'antagonist') conflicts.push({ id: neighbor, row: r, col: c });
      } catch (e) { /* plants not in graph */ }
    }
  }
  return { companions, conflicts };
}

function getAllBedRelationships(bed) {
  const cellMap = {};
  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      if (!bed.cells[r][c]) continue;
      cellMap[r + ',' + c] = getCellRelationships(bed, r, c);
    }
  }
  return cellMap;
}

// ── Canvas Rendering — Top-Down View ──

function gridToCanvas(row, col) {
  return {
    x: GRID_PAD + col * (CELL_SIZE + CELL_GAP),
    y: GRID_PAD + row * (CELL_SIZE + CELL_GAP),
  };
}

function canvasToGrid(x, y) {
  const col = Math.floor((x - GRID_PAD) / (CELL_SIZE + CELL_GAP));
  const row = Math.floor((y - GRID_PAD) / (CELL_SIZE + CELL_GAP));
  return { row, col };
}

function getCanvasSize(bed) {
  return {
    w: GRID_PAD * 2 + bed.cols * (CELL_SIZE + CELL_GAP) - CELL_GAP,
    h: GRID_PAD * 2 + bed.rows * (CELL_SIZE + CELL_GAP) - CELL_GAP,
  };
}

function renderTopDown(bed) {
  if (!canvas || !ctx || !bed) return;

  const size = getCanvasSize(bed);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size.w * dpr;
  canvas.height = size.h * dpr;
  canvas.style.width = size.w + 'px';
  canvas.style.height = size.h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isNight = document.documentElement.dataset.theme === 'night';
  const bg = isNight ? '#1b2a1b' : '#faf6ee';
  const cellBg = isNight ? '#243024' : '#f0ead2';
  const cellBorder = isNight ? '#3a5a3a' : '#ddd5bd';
  const outsideBg = isNight ? '#151f15' : '#e8e2d0';
  const textColor = isNight ? '#d4e4c8' : '#344e41';
  const companionColor = isNight ? 'rgba(124,191,124,0.3)' : 'rgba(74,124,89,0.2)';
  const conflictColor = isNight ? 'rgba(224,112,112,0.3)' : 'rgba(188,71,73,0.15)';
  const hoverColor = isNight ? 'rgba(143,188,143,0.2)' : 'rgba(88,129,87,0.1)';

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size.w, size.h);

  // Get relationships for highlighting
  const rels = getAllBedRelationships(bed);
  const companionCells = new Set();
  const conflictCells = new Set();

  // If hovering on a cell with a plant, highlight its relationships
  if (hoverCell && bed.cells[hoverCell.row]?.[hoverCell.col]) {
    const key = hoverCell.row + ',' + hoverCell.col;
    const rel = rels[key];
    if (rel) {
      rel.companions.forEach(c => companionCells.add(c.row + ',' + c.col));
      rel.conflicts.forEach(c => conflictCells.add(c.row + ',' + c.col));
      companionCells.add(key); // highlight self green too
    }
  }

  // Check for conflicts across entire bed (for persistent red glow)
  const allConflictCells = new Set();
  for (const key in rels) {
    if (rels[key].conflicts.length > 0) {
      allConflictCells.add(key);
      rels[key].conflicts.forEach(c => allConflictCells.add(c.row + ',' + c.col));
    }
  }

  // Draw cells
  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      const pos = gridToCanvas(r, c);
      const inside = isInsideShape(bed, r, c);
      const key = r + ',' + c;

      // Cell background
      if (!inside) {
        ctx.fillStyle = outsideBg;
      } else if (companionCells.has(key)) {
        ctx.fillStyle = companionColor;
      } else if (conflictCells.has(key) || allConflictCells.has(key)) {
        ctx.fillStyle = conflictColor;
      } else if (hoverCell && hoverCell.row === r && hoverCell.col === c) {
        ctx.fillStyle = hoverColor;
      } else {
        ctx.fillStyle = cellBg;
      }
      ctx.fillRect(pos.x, pos.y, CELL_SIZE, CELL_SIZE);

      // Cell border
      ctx.strokeStyle = cellBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);

      // Plant emoji
      if (inside && bed.cells[r][c]) {
        const emoji = emojiLookup ? emojiLookup(bed.cells[r][c]) : '🌱';
        ctx.font = EMOJI_SIZE + 'px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, pos.x + CELL_SIZE / 2, pos.y + CELL_SIZE / 2 + 1);
      }

      // Outside shape X marker
      if (!inside) {
        ctx.strokeStyle = isNight ? '#2a3a2a' : '#d5d0c0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pos.x + 8, pos.y + 8);
        ctx.lineTo(pos.x + CELL_SIZE - 8, pos.y + CELL_SIZE - 8);
        ctx.moveTo(pos.x + CELL_SIZE - 8, pos.y + 8);
        ctx.lineTo(pos.x + 8, pos.y + CELL_SIZE - 8);
        ctx.stroke();
      }
    }
  }

  // Hover plant preview (ghost)
  if (hoverCell && placingPlant && !bed.cells[hoverCell.row]?.[hoverCell.col]) {
    const pos = gridToCanvas(hoverCell.row, hoverCell.col);
    if (isInsideShape(bed, hoverCell.row, hoverCell.col)) {
      ctx.globalAlpha = 0.4;
      const emoji = emojiLookup ? emojiLookup(placingPlant) : '🌱';
      ctx.font = EMOJI_SIZE + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, pos.x + CELL_SIZE / 2, pos.y + CELL_SIZE / 2 + 1);
      ctx.globalAlpha = 1;
    }
  }

  // Spacing radius overlay (shows plant footprint)
  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      const plantId = bed.cells[r]?.[c];
      if (!plantId || !isInsideShape(bed, r, c)) continue;
      const p = plannerPlants.find(pp => pp.id === plantId);
      const m = p?.properties?.metric;
      if (!m || !m.spread_cm) continue;

      const pos = gridToCanvas(r, c);
      const cellCm = DEFAULT_CELL_CM;
      const radiusCells = (m.spread_cm / 2) / cellCm;
      const radiusPx = radiusCells * (CELL_SIZE + CELL_GAP);

      if (radiusPx > CELL_SIZE * 0.6) {
        ctx.beginPath();
        ctx.arc(pos.x + CELL_SIZE / 2, pos.y + CELL_SIZE / 2, radiusPx, 0, Math.PI * 2);
        ctx.strokeStyle = isNight ? 'rgba(143,188,143,0.25)' : 'rgba(88,129,87,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Bed label with real dimensions
  const dim = bed.dimensions_cm || { width: bed.cols * DEFAULT_CELL_CM, depth: bed.rows * DEFAULT_CELL_CM };
  const dimLabel = displayLength(dim.width) + ' × ' + displayLength(dim.depth);
  ctx.fillStyle = textColor;
  ctx.font = '11px Nunito, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(bed.name + '  ' + dimLabel, GRID_PAD, 6);
}

// ── Canvas Rendering — Side Cross-Section ──

function renderSideView(bed) {
  if (!sideCanvas || !sideCtx || !bed) return;

  const SIDE_H = 200;
  const dpr = window.devicePixelRatio || 1;
  const size = getCanvasSize(bed);
  sideCanvas.width = size.w * dpr;
  sideCanvas.height = SIDE_H * dpr;
  sideCanvas.style.width = size.w + 'px';
  sideCanvas.style.height = SIDE_H + 'px';
  sideCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isNight = document.documentElement.dataset.theme === 'night';

  // Sky
  const skyGrad = sideCtx.createLinearGradient(0, 0, 0, 60);
  skyGrad.addColorStop(0, isNight ? '#0a150a' : '#d4eaf7');
  skyGrad.addColorStop(1, isNight ? '#1b2a1b' : '#f0ead2');
  sideCtx.fillStyle = skyGrad;
  sideCtx.fillRect(0, 0, size.w, 60);

  // Ground line
  const groundY = 60;
  sideCtx.fillStyle = isNight ? '#2a3a20' : '#8B7355';
  sideCtx.fillRect(0, groundY, size.w, 3);

  // Soil layers
  const soilColors = isNight
    ? ['#3a2e18', '#2e2210', '#201808']
    : ['#8B7355', '#6B5B3E', '#4A3B26'];
  const layerH = (SIDE_H - groundY - 3) / 3;
  soilColors.forEach((c, i) => {
    sideCtx.fillStyle = c;
    sideCtx.fillRect(0, groundY + 3 + i * layerH, size.w, layerH);
  });

  // Soil layer labels
  sideCtx.fillStyle = 'rgba(255,255,255,0.3)';
  sideCtx.font = '9px Nunito, sans-serif';
  sideCtx.textAlign = 'left';
  ['Shallow', 'Medium', 'Deep'].forEach((label, i) => {
    sideCtx.fillText(label, 4, groundY + 3 + i * layerH + 12);
  });

  // Depth map
  const depthY = { 'shallow': groundY + 3 + layerH * 0.4, 'medium': groundY + 3 + layerH * 1.4, 'deep': groundY + 3 + layerH * 2.4 };
  const heightY = { 'ground-cover': groundY - 5, 'low': groundY - 15, 'medium': groundY - 28, 'tall': groundY - 42, 'climbing': groundY - 55 };

  // Draw each column's plant profile
  for (let c = 0; c < bed.cols; c++) {
    // Collect all plants in this column
    const colPlants = [];
    for (let r = 0; r < bed.rows; r++) {
      const pid = bed.cells[r][c];
      if (pid && isInsideShape(bed, r, c)) {
        const p = plannerPlants.find(pp => pp.id === pid);
        if (p && !colPlants.find(cp => cp.id === pid)) colPlants.push(p);
      }
    }

    const cx = GRID_PAD + c * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;

    colPlants.forEach(p => {
      const pr = p.properties || {};
      const rootD = pr.root_depth || 'shallow';
      const habit = pr.growth_habit || 'low';
      const ry = depthY[rootD] || depthY.shallow;
      const hy = heightY[habit] || heightY.low;

      // Root line
      sideCtx.strokeStyle = isNight ? 'rgba(143,188,143,0.5)' : 'rgba(139,115,85,0.6)';
      sideCtx.lineWidth = 2;
      sideCtx.setLineDash([3, 3]);
      sideCtx.beginPath();
      sideCtx.moveTo(cx, groundY + 3);
      sideCtx.lineTo(cx, ry);
      sideCtx.stroke();
      sideCtx.setLineDash([]);

      // Root dot
      sideCtx.fillStyle = isNight ? '#8fbc8f' : '#6B5B3E';
      sideCtx.beginPath();
      sideCtx.arc(cx, ry, 4, 0, Math.PI * 2);
      sideCtx.fill();

      // Stem line above ground
      sideCtx.strokeStyle = isNight ? '#5a8a5a' : '#588157';
      sideCtx.lineWidth = 2;
      sideCtx.setLineDash([]);
      sideCtx.beginPath();
      sideCtx.moveTo(cx, groundY);
      sideCtx.lineTo(cx, hy);
      sideCtx.stroke();

      // Plant emoji at top
      const emoji = emojiLookup ? emojiLookup(p.id) : '🌱';
      sideCtx.font = '16px serif';
      sideCtx.textAlign = 'center';
      sideCtx.textBaseline = 'bottom';
      sideCtx.fillText(emoji, cx, hy);
    });
  }

  // Side view label with soil depth
  const sideDim = bed.dimensions_cm || {};
  const soilLabel = sideDim.soil_depth ? ' · Soil: ' + displayLength(sideDim.soil_depth) : '';
  sideCtx.fillStyle = isNight ? '#d4e4c8' : '#344e41';
  sideCtx.font = '11px Nunito, sans-serif';
  sideCtx.textAlign = 'left';
  sideCtx.textBaseline = 'top';
  sideCtx.fillText('Side View — Roots & Height' + soilLabel, GRID_PAD, 6);
}

// ── Event Handlers ──

function handleCanvasClick(e) {
  const bed = getActiveBed();
  if (!bed) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const { row, col } = canvasToGrid(x, y);

  if (row < 0 || col < 0 || row >= bed.rows || col >= bed.cols) return;
  if (!isInsideShape(bed, row, col)) return;

  if (placingPlant) {
    if (bed.cells[row][col] === placingPlant) {
      setCell(bed, row, col, null); // Toggle off same plant
    } else {
      setCell(bed, row, col, placingPlant);
    }
  } else {
    setCell(bed, row, col, null); // Eraser mode
  }

  saveBeds();
  renderBed();
}

function handleCanvasMove(e) {
  const bed = getActiveBed();
  if (!bed) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cell = canvasToGrid(x, y);

  if (cell.row !== hoverCell?.row || cell.col !== hoverCell?.col) {
    hoverCell = cell;
    renderBed();
  }
}

function handleCanvasLeave() {
  hoverCell = null;
  renderBed();
}

// ── Touch Support ──

function handleCanvasTouch(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;

  const bed = getActiveBed();
  if (!bed) return;
  const { row, col } = canvasToGrid(x, y);
  if (row < 0 || col < 0 || row >= bed.rows || col >= bed.cols) return;
  if (!isInsideShape(bed, row, col)) return;

  if (placingPlant) {
    setCell(bed, row, col, placingPlant);
  } else {
    setCell(bed, row, col, null);
  }

  saveBeds();
  renderBed();
}

// ── Persistence ──

function saveBeds() {
  try {
    localStorage.setItem('garden-beds', JSON.stringify(beds));
  } catch (e) { /* quota exceeded */ }
}

function loadBeds() {
  try {
    const saved = localStorage.getItem('garden-beds');
    if (saved) {
      beds = JSON.parse(saved);
      return true;
    }
  } catch (e) { /* corrupt */ }
  return false;
}

// ── Plant Palette ──

function renderPlantPalette() {
  const palette = document.getElementById('planner-palette');
  if (!palette) return;

  const enriched = plannerPlants.filter(p => p.properties && !p.stub);

  palette.innerHTML = enriched.map(p => {
    const emoji = emojiLookup ? emojiLookup(p.id) : '🌱';
    const isActive = placingPlant === p.id;
    return '<button class="palette-plant' + (isActive ? ' palette-active' : '') + '" ' +
      'data-plant="' + p.id + '" title="' + p.name + '">' +
      emoji + '</button>';
  }).join('') +
    '<button class="palette-plant palette-eraser' + (!placingPlant ? ' palette-active' : '') + '" ' +
    'data-plant="" title="Eraser">🧹</button>';
}

function handlePaletteClick(e) {
  const btn = e.target.closest('.palette-plant');
  if (!btn) return;
  const plantId = btn.dataset.plant || null;
  placingPlant = plantId;
  renderPlantPalette();
  updatePlacingLabel();
}

function updatePlacingLabel() {
  const label = document.getElementById('planner-placing-label');
  if (!label) return;
  if (placingPlant) {
    const p = plannerPlants.find(pp => pp.id === placingPlant);
    const emoji = emojiLookup ? emojiLookup(placingPlant) : '🌱';
    label.textContent = 'Placing: ' + emoji + ' ' + (p ? p.name : placingPlant);
    label.classList.add('placing-active');
  } else {
    label.textContent = 'Click cells to clear';
    label.classList.remove('placing-active');
  }
}

// ── Bed Management UI ──

function renderBedTabs() {
  const tabs = document.getElementById('planner-bed-tabs');
  if (!tabs) return;

  tabs.innerHTML = beds.map((b, i) =>
    '<button class="bed-tab' + (i === activeBedIdx ? ' bed-tab-active' : '') + '" ' +
    'data-bed-idx="' + i + '">' + b.name + '</button>'
  ).join('') +
    '<button class="bed-tab bed-tab-add" id="add-bed-btn" title="Add bed">＋</button>';
}

function handleBedTabClick(e) {
  const tab = e.target.closest('.bed-tab');
  if (!tab) return;

  if (tab.id === 'add-bed-btn') {
    addNewBed();
    return;
  }

  const idx = parseInt(tab.dataset.bedIdx);
  if (!isNaN(idx) && idx < beds.length) {
    activeBedIdx = idx;
    renderBedTabs();
    renderBed();
  }
}

function addNewBed() {
  const rows = parseInt(document.getElementById('bed-rows')?.value) || 4;
  const cols = parseInt(document.getElementById('bed-cols')?.value) || 8;
  const name = document.getElementById('bed-name')?.value || 'Bed ' + (beds.length + 1);
  const shape = document.getElementById('bed-shape')?.value || 'rectangle';

  beds.push(createBed(name, rows, cols, shape));
  activeBedIdx = beds.length - 1;
  saveBeds();
  renderBedTabs();
  renderBed();

  // Reset inputs
  const nameInput = document.getElementById('bed-name');
  if (nameInput) nameInput.value = '';
}

function removeBed() {
  if (beds.length <= 1) return;
  beds.splice(activeBedIdx, 1);
  activeBedIdx = Math.min(activeBedIdx, beds.length - 1);
  saveBeds();
  renderBedTabs();
  renderBed();
}

function clearActiveBed() {
  const bed = getActiveBed();
  if (bed) {
    clearBed(bed);
    saveBeds();
    renderBed();
  }
}

// ── Bed Stats Sidebar ──

function renderBedStats(bed) {
  const statsEl = document.getElementById('planner-bed-stats');
  if (!statsEl || !bed) return;

  const plantIds = bedPlantIds(bed);
  const plantCount = plantIds.size;
  let filledCells = 0;
  let totalCells = 0;

  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      if (isInsideShape(bed, r, c)) {
        totalCells++;
        if (bed.cells[r][c]) filledCells++;
      }
    }
  }

  // Count companions and conflicts
  let companionPairs = 0;
  let conflictPairs = 0;
  const checked = new Set();
  const ids = [...plantIds];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = ids[i] + ':' + ids[j];
      if (checked.has(key)) continue;
      checked.add(key);
      try {
        const rel = JSON.parse(plannerGarden?.relationship(ids[i], ids[j]));
        if (rel && rel.type === 'companion') companionPairs++;
        else if (rel && rel.type === 'antagonist') conflictPairs++;
      } catch (e) { /* plants not in graph */ }
    }
  }

  // ── Metric Calculations ──
  const dim = bed.dimensions_cm || { width: bed.cols * DEFAULT_CELL_CM, depth: bed.rows * DEFAULT_CELL_CM, soil_depth: 30 };
  const areaCm2 = dim.width * dim.depth;
  const areaM2 = areaCm2 / 10000;
  const soilVolL = (areaCm2 * (dim.soil_depth || 30)) / 1000;

  // Count plant instances (not unique varieties — actual cell count per plant)
  const plantCounts = {};
  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      const pid = bed.cells[r]?.[c];
      if (pid && isInsideShape(bed, r, c)) {
        plantCounts[pid] = (plantCounts[pid] || 0) + 1;
      }
    }
  }

  // Water budget: sum water_ml_per_day for each planted cell
  let waterMlDay = 0;
  let nitrogenGM2 = 0;
  let yieldKgM2 = 0;
  let metricPlants = 0;

  for (const [pid, count] of Object.entries(plantCounts)) {
    const p = plannerPlants.find(pp => pp.id === pid);
    const m = p?.properties?.metric;
    if (!m) continue;
    metricPlants++;
    waterMlDay += (m.water_ml_per_day || 0) * count;
    nitrogenGM2 += (m.nitrogen_g_per_m2 || 0); // per variety contribution
    yieldKgM2 += (m.yield_kg_per_m2 || 0);
  }

  const waterLWeek = (waterMlDay * 7) / 1000;
  const nBalance = nitrogenGM2; // g/m² — positive = surplus, negative = needs fertilizer
  const nStatus = nBalance >= 0 ? 'surplus' : (nBalance >= -15 ? 'moderate' : 'deficit');
  const nClass = nBalance >= 0 ? 'bed-stat--good' : (nBalance >= -15 ? '' : 'bed-stat--bad');

  // ── Build HTML ──
  let html = '';

  // Row 1: basic counts
  html += '<div class="bed-stat"><span class="bed-stat-label">Plants</span><span class="bed-stat-value">' + plantCount + ' varieties</span></div>';
  html += '<div class="bed-stat"><span class="bed-stat-label">Filled</span><span class="bed-stat-value">' + filledCells + '/' + totalCells + ' cells</span></div>';
  html += '<div class="bed-stat"><span class="bed-stat-label">Companions</span><span class="bed-stat-value bed-stat--good">' + companionPairs + ' pairs ✓</span></div>';
  if (conflictPairs > 0) {
    html += '<div class="bed-stat"><span class="bed-stat-label">Conflicts</span><span class="bed-stat-value bed-stat--bad">' + conflictPairs + ' pairs ⚠</span></div>';
  }

  // Row 2: metric stats (only show if plants have metric data)
  if (metricPlants > 0) {
    html += '<div class="bed-stat"><span class="bed-stat-label">Bed Area</span><span class="bed-stat-value">' + displayArea(areaCm2) + '</span></div>';
    html += '<div class="bed-stat"><span class="bed-stat-label">Soil Volume</span><span class="bed-stat-value">' + displayVolume(soilVolL) + '</span></div>';
    html += '<div class="bed-stat"><span class="bed-stat-label">💧 Water</span><span class="bed-stat-value">' + displayVolume(waterLWeek) + '/week</span></div>';

    const nLabel = nBalance >= 0 ? '+' + Math.abs(nBalance).toFixed(0) + ' g/m²' : nBalance.toFixed(0) + ' g/m²';
    html += '<div class="bed-stat"><span class="bed-stat-label">🌿 Nitrogen</span><span class="bed-stat-value ' + nClass + '">' + nLabel + ' ' + nStatus + '</span></div>';

    if (yieldKgM2 > 0) {
      const totalYieldKg = yieldKgM2 * areaM2;
      html += '<div class="bed-stat"><span class="bed-stat-label">🌾 Est. Yield</span><span class="bed-stat-value">' + displayWeight(totalYieldKg * 1000) + '</span></div>';
    }
  }

  // Row 3: unit toggle + actions
  html += '<div class="bed-stat-actions">';
  html += '<button class="bed-action" id="unit-toggle-btn">' + (unitPref === 'metric' ? '📏 Metric' : '📐 Imperial') + '</button>';
  html += '<button class="bed-action" id="clear-bed-btn">Clear Bed</button>';
  if (beds.length > 1) {
    html += '<button class="bed-action bed-action--danger" id="remove-bed-btn">Remove Bed</button>';
  }
  html += '</div>';

  statsEl.innerHTML = html;

  // Wire action buttons
  document.getElementById('clear-bed-btn')?.addEventListener('click', clearActiveBed);
  document.getElementById('remove-bed-btn')?.addEventListener('click', removeBed);
  document.getElementById('unit-toggle-btn')?.addEventListener('click', toggleUnits);
}

function toggleUnits() {
  unitPref = unitPref === 'metric' ? 'imperial' : 'metric';
  try { localStorage.setItem('garden-units', unitPref); } catch (e) {}
  renderBed();
}

// ── View Toggle ──

function toggleView() {
  viewMode = viewMode === 'top' ? 'side' : 'top';
  const btn = document.getElementById('planner-view-toggle');
  if (btn) btn.textContent = viewMode === 'top' ? '👁️ Side View' : '🗺️ Top View';

  const sideEl = document.getElementById('planner-side-canvas');
  if (sideEl) sideEl.hidden = viewMode === 'top';
  renderBed();
}

// ── Master Render ──

function renderBed() {
  const bed = getActiveBed();
  if (!bed) return;

  renderTopDown(bed);
  if (viewMode === 'side') renderSideView(bed);
  renderBedStats(bed);
}

// ── Init ──

export function initPlanner(plantsData, gardenEngine, emojiFn) {
  plannerPlants = plantsData;
  plannerGarden = gardenEngine;
  emojiLookup = emojiFn;

  canvas = document.getElementById('planner-canvas');
  sideCanvas = document.getElementById('planner-side-canvas');
  if (!canvas) return;

  ctx = canvas.getContext('2d');
  sideCtx = sideCanvas?.getContext('2d');

  // Load preferences
  try { unitPref = localStorage.getItem('garden-units') || 'metric'; } catch (e) {}

  // Load saved beds or create default
  if (!loadBeds() || beds.length === 0) {
    beds = [createBed('My Garden Bed', 4, 8, 'rectangle')];
  }

  // Ensure all beds have dimensions_cm (migration for pre-metric beds)
  for (const b of beds) {
    if (!b.dimensions_cm) {
      b.dimensions_cm = {
        width: b.cols * DEFAULT_CELL_CM,
        depth: b.rows * DEFAULT_CELL_CM,
        soil_depth: 30,
      };
    }
  }

  // Event listeners
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('mousemove', handleCanvasMove);
  canvas.addEventListener('mouseleave', handleCanvasLeave);
  canvas.addEventListener('touchstart', handleCanvasTouch, { passive: false });

  document.getElementById('planner-palette')?.addEventListener('click', handlePaletteClick);
  document.getElementById('planner-bed-tabs')?.addEventListener('click', handleBedTabClick);
  document.getElementById('planner-view-toggle')?.addEventListener('click', toggleView);
  document.getElementById('planner-add-bed')?.addEventListener('click', addNewBed);

  // Initial render
  renderBedTabs();
  renderPlantPalette();
  updatePlacingLabel();
  renderBed();
}
