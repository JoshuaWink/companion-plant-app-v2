/**
 * Garden Bed Planner — Interactive spatial designer
 *
 * Canvas-based bed layout tool. Place plants on a grid,
 * see companion/conflict overlays, view root profile.
 */

import { simulate_growth } from './pkg/companion_graph.js';

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

// ── Soil Composition Model ──
// Each soil type has modifiers based on USDA soil texture triangle
const SOIL_TYPES = {
  'sandy':      { label: 'Sandy',      sand: 85, silt: 10, clay:  5, waterFactor: 1.5,  rootFactor: 1.3,  n2Factor: 1.4, fieldCapacity: 0.10 },
  'sandy-loam': { label: 'Sandy Loam', sand: 65, silt: 25, clay: 10, waterFactor: 1.25, rootFactor: 1.15, n2Factor: 1.2, fieldCapacity: 0.18 },
  'loam':       { label: 'Loam',       sand: 40, silt: 40, clay: 20, waterFactor: 1.0,  rootFactor: 1.0,  n2Factor: 1.0, fieldCapacity: 0.27 },
  'silt-loam':  { label: 'Silt Loam',  sand: 20, silt: 65, clay: 15, waterFactor: 0.9,  rootFactor: 0.9,  n2Factor: 0.85, fieldCapacity: 0.32 },
  'clay-loam':  { label: 'Clay Loam',  sand: 30, silt: 35, clay: 35, waterFactor: 0.75, rootFactor: 0.7,  n2Factor: 0.6, fieldCapacity: 0.36 },
  'clay':       { label: 'Clay',       sand: 20, silt: 20, clay: 60, waterFactor: 0.6,  rootFactor: 0.5,  n2Factor: 0.4, fieldCapacity: 0.42 },
};
// waterFactor: multiplier on water need (sandy drains fast → more watering)
// rootFactor:  multiplier on effective root spread (clay restricts penetration)
// n2Factor:    multiplier on nitrogen diffusion radius (sandy = faster diffusion)
// fieldCapacity: cm³ water per cm³ soil at field capacity

function getSoilType(bed) {
  return SOIL_TYPES[bed.soilType || 'loam'] || SOIL_TYPES.loam;
}

// ── Undo/Redo ──
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

// ── Drag State ──
let dragging = null; // { row, col, plantId } when dragging from canvas

// ── Season Scrubber ──
let seasonMonth = 0; // 0 = off, 1-12 = active month filter

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

// ── Undo / Redo ──

function pushUndo() {
  const bed = getActiveBed();
  if (!bed) return;
  undoStack.push(JSON.parse(JSON.stringify(bed.cells)));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

function undo() {
  const bed = getActiveBed();
  if (!bed || undoStack.length === 0) return;
  redoStack.push(JSON.parse(JSON.stringify(bed.cells)));
  bed.cells = undoStack.pop();
  saveBeds();
  renderBed();
}

function redo() {
  const bed = getActiveBed();
  if (!bed || redoStack.length === 0) return;
  undoStack.push(JSON.parse(JSON.stringify(bed.cells)));
  bed.cells = redoStack.pop();
  saveBeds();
  renderBed();
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

      // Soil texture dots (subtle earth feeling)
      if (inside && !bed.cells[r][c]) {
        ctx.fillStyle = isNight ? 'rgba(90,120,70,0.08)' : 'rgba(139,115,85,0.06)';
        const seed = r * 31 + c * 17;
        for (let d = 0; d < 4; d++) {
          const dx = ((seed + d * 7) % 37) * (CELL_SIZE / 37);
          const dy = ((seed + d * 13) % 41) * (CELL_SIZE / 41);
          ctx.beginPath();
          ctx.arc(pos.x + dx, pos.y + dy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Cell border
      ctx.strokeStyle = cellBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);

      // Plant emoji (dimmed if out of season)
      if (inside && bed.cells[r][c]) {
        const pid = bed.cells[r][c];
        if (seasonMonth > 0) {
          const p = plannerPlants.find(pp => pp.id === pid);
          ctx.globalAlpha = (p && !isPlantInSeason(p, seasonMonth)) ? 0.25 : 1;
        }
        const emoji = emojiLookup ? emojiLookup(pid) : '🌱';
        ctx.font = EMOJI_SIZE + 'px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, pos.x + CELL_SIZE / 2, pos.y + CELL_SIZE / 2 + 1);
        ctx.globalAlpha = 1;
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

  // ── Spacing footprint layer ──
  // Build density map: for each cell, track which plant spacing zones claim it
  const spacingMap = {};
  for (let pr = 0; pr < bed.rows; pr++) {
    for (let pc = 0; pc < bed.cols; pc++) {
      const plantId = bed.cells[pr]?.[pc];
      if (!plantId || !isInsideShape(bed, pr, pc)) continue;
      const p = plannerPlants.find(pp => pp.id === plantId);
      const m = p?.properties?.metric;
      if (!m) continue;
      const spacingCm = m.spacing_cm || m.spread_cm || 0;
      if (spacingCm <= DEFAULT_CELL_CM) continue;
      const radiusCells = Math.ceil((spacingCm / 2) / DEFAULT_CELL_CM);
      for (let dr = -radiusCells; dr <= radiusCells; dr++) {
        for (let dc = -radiusCells; dc <= radiusCells; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = pr + dr, nc = pc + dc;
          if (nr < 0 || nr >= bed.rows || nc < 0 || nc >= bed.cols) continue;
          if (!isInsideShape(bed, nr, nc)) continue;
          const distCm = Math.sqrt(dr * dr + dc * dc) * DEFAULT_CELL_CM;
          if (distCm > spacingCm / 2) continue;
          const k = nr + ',' + nc;
          if (!spacingMap[k]) spacingMap[k] = { count: 0, owners: [] };
          spacingMap[k].count++;
          spacingMap[k].owners.push({ r: pr, c: pc, id: plantId });
        }
      }
    }
  }

  // Draw footprint zones
  for (const k in spacingMap) {
    const [zr, zc] = k.split(',').map(Number);
    const hasPlant = !!bed.cells[zr]?.[zc];
    const entry = spacingMap[k];
    const pos = gridToCanvas(zr, zc);

    if (!hasPlant) {
      // Empty cell in spacing zone — show claimed territory
      if (entry.count === 1) {
        ctx.fillStyle = isNight ? 'rgba(100,160,100,0.12)' : 'rgba(88,129,87,0.10)';
      } else {
        ctx.fillStyle = isNight ? 'rgba(220,180,60,0.18)' : 'rgba(200,150,40,0.14)';
      }
      ctx.fillRect(pos.x + 1, pos.y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    } else {
      // Occupied cell in another plant's zone = crowded
      const foreignOwners = entry.owners.filter(o => !(o.r === zr && o.c === zc));
      if (foreignOwners.length > 0) {
        ctx.fillStyle = isNight ? 'rgba(230,170,50,0.22)' : 'rgba(210,150,30,0.18)';
        ctx.fillRect(pos.x + 1, pos.y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        // Crowding dot in corner
        ctx.fillStyle = isNight ? 'rgba(255,180,60,0.6)' : 'rgba(220,150,30,0.5)';
        ctx.beginPath();
        ctx.arc(pos.x + CELL_SIZE - 6, pos.y + 6, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Hover placement footprint preview
  if (hoverCell && placingPlant && !bed.cells[hoverCell.row]?.[hoverCell.col] && isInsideShape(bed, hoverCell.row, hoverCell.col)) {
    const hp = plannerPlants.find(pp => pp.id === placingPlant);
    const hm = hp?.properties?.metric;
    const hSpacing = hm?.spacing_cm || hm?.spread_cm || 0;
    if (hSpacing > DEFAULT_CELL_CM) {
      const hRadius = Math.ceil((hSpacing / 2) / DEFAULT_CELL_CM);
      for (let dr = -hRadius; dr <= hRadius; dr++) {
        for (let dc = -hRadius; dc <= hRadius; dc++) {
          const nr = hoverCell.row + dr, nc = hoverCell.col + dc;
          if (nr < 0 || nr >= bed.rows || nc < 0 || nc >= bed.cols) continue;
          if (!isInsideShape(bed, nr, nc)) continue;
          const distCm = Math.sqrt(dr * dr + dc * dc) * DEFAULT_CELL_CM;
          if (distCm > hSpacing / 2) continue;
          const fp = gridToCanvas(nr, nc);
          const occupied = !!bed.cells[nr]?.[nc];
          if (occupied) {
            ctx.fillStyle = isNight ? 'rgba(255,100,80,0.15)' : 'rgba(200,60,40,0.1)';
          } else if (spacingMap[nr + ',' + nc]) {
            ctx.fillStyle = isNight ? 'rgba(255,200,80,0.15)' : 'rgba(200,160,40,0.1)';
          } else {
            ctx.fillStyle = isNight ? 'rgba(100,200,100,0.1)' : 'rgba(60,140,60,0.07)';
          }
          ctx.fillRect(fp.x + 1, fp.y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        }
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

  const SIDE_H = 260;
  const dpr = window.devicePixelRatio || 1;
  const size = getCanvasSize(bed);
  sideCanvas.width = size.w * dpr;
  sideCanvas.height = SIDE_H * dpr;
  sideCanvas.style.width = size.w + 'px';
  sideCanvas.style.height = SIDE_H + 'px';
  sideCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isNight = document.documentElement.dataset.theme === 'night';
  const RULER_W = 32;
  const SKY_H   = 140;
  const GROUND_H = 3;
  const SOIL_H  = SIDE_H - SKY_H - GROUND_H;
  const groundY = SKY_H;

  // ── Collect all plants across the bed with their column positions ──
  const colEntries = [];
  for (let c = 0; c < bed.cols; c++) {
    const seen = new Set();
    for (let r = 0; r < bed.rows; r++) {
      const pid = bed.cells[r][c];
      if (pid && isInsideShape(bed, r, c) && !seen.has(pid)) {
        const p = plannerPlants.find(pp => pp.id === pid);
        if (p) { colEntries.push({ plant: p, col: c }); seen.add(pid); }
      }
    }
  }

  // ── Determine max height and root depth for proportional scaling ──
  let maxHcm = 0, maxRcm = 0;
  colEntries.forEach(({ plant }) => {
    const dim = getPlantDimensions(plant, seasonMonth);
    const mh = dim.matureH || 0;
    const mr = dim.matureR || 0;
    if (mh > maxHcm) maxHcm = mh;
    if (mr > maxRcm) maxRcm = mr;
  });
  if (maxHcm === 0) maxHcm = 200;
  if (maxRcm === 0) maxRcm = 90;

  const aboveSpace = SKY_H - 30;
  const belowSpace = SOIL_H - 10;
  const pxPerCmAbove = aboveSpace / maxHcm;
  const pxPerCmBelow = belowSpace / maxRcm;

  // ── Sky gradient ──
  const skyGrad = sideCtx.createLinearGradient(0, 0, 0, groundY);
  skyGrad.addColorStop(0, isNight ? '#0a150a' : '#d4eaf7');
  skyGrad.addColorStop(1, isNight ? '#1b2a1b' : '#f0ead2');
  sideCtx.fillStyle = skyGrad;
  sideCtx.fillRect(0, 0, size.w, groundY);

  // ── Ground line ──
  sideCtx.fillStyle = isNight ? '#2a3a20' : '#8B7355';
  sideCtx.fillRect(0, groundY, size.w, GROUND_H);

  // ── Soil gradient ──
  const soilGrad = sideCtx.createLinearGradient(0, groundY + GROUND_H, 0, SIDE_H);
  if (isNight) {
    soilGrad.addColorStop(0, '#3a2e18');
    soilGrad.addColorStop(0.5, '#2e2210');
    soilGrad.addColorStop(1, '#201808');
  } else {
    soilGrad.addColorStop(0, '#8B7355');
    soilGrad.addColorStop(0.5, '#6B5B3E');
    soilGrad.addColorStop(1, '#4A3B26');
  }
  sideCtx.fillStyle = soilGrad;
  sideCtx.fillRect(0, groundY + GROUND_H, size.w, SOIL_H);

  // ── Ground-level Detail: grass tufts ──
  const tufts = Math.floor(size.w / 14);
  for (let i = 0; i < tufts; i++) {
    const tx = 8 + (i / tufts) * (size.w - 16) + (Math.sin(i * 7.3) * 4);
    const bladeCount = 2 + Math.floor(Math.abs(Math.sin(i * 3.7)) * 3);
    for (let b = 0; b < bladeCount; b++) {
      const angle = -0.6 + (b / bladeCount) * 1.2;
      const h = 3 + Math.abs(Math.sin(i * 2.1 + b * 1.3)) * 5;
      sideCtx.strokeStyle = isNight
        ? 'rgba(60,120,60,' + (0.2 + Math.abs(Math.sin(i * 1.7)) * 0.15) + ')'
        : 'rgba(76,145,65,' + (0.35 + Math.abs(Math.sin(i * 1.7)) * 0.2) + ')';
      sideCtx.lineWidth = 0.8;
      sideCtx.beginPath();
      sideCtx.moveTo(tx, groundY);
      sideCtx.quadraticCurveTo(tx + angle * 4, groundY - h * 0.6, tx + angle * 6, groundY - h);
      sideCtx.stroke();
    }
  }

    // ── Sky Decorations ──
  // Seeded PRNG for deterministic positions (so they don't flicker on re-render)
  const _seed = (bed.name || 'a').charCodeAt(0) * 137 + bed.cols * 31 + bed.rows * 17;
  function _rng(i) { let s = (_seed + i * 2654435761) >>> 0; s ^= s >> 16; s = Math.imul(s, 0x45d9f3b); s ^= s >> 16; return (s >>> 0) / 4294967296; }

  if (isNight) {
    // ── Night: stars, moon, fireflies ──

    // Moon
    const moonX = size.w - 50, moonY = 28, moonR = 14;
    const moonGlow = sideCtx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 3);
    moonGlow.addColorStop(0, 'rgba(255,255,220,0.12)');
    moonGlow.addColorStop(1, 'rgba(255,255,220,0)');
    sideCtx.fillStyle = moonGlow;
    sideCtx.fillRect(moonX - moonR * 3, moonY - moonR * 3, moonR * 6, moonR * 6);
    sideCtx.fillStyle = '#f0ecd0';
    sideCtx.beginPath();
    sideCtx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    sideCtx.fill();
    // Moon shadow (crescent effect)
    sideCtx.fillStyle = '#1a2a1a';
    sideCtx.beginPath();
    sideCtx.arc(moonX + 5, moonY - 3, moonR * 0.85, 0, Math.PI * 2);
    sideCtx.fill();

    // Stars
    const starCount = Math.floor(size.w / 12);
    for (let i = 0; i < starCount; i++) {
      const sx = _rng(i * 3) * size.w;
      const sy = _rng(i * 3 + 1) * (groundY - 20) + 5;
      const sr = 0.5 + _rng(i * 3 + 2) * 1.2;
      const alpha = 0.3 + _rng(i * 7) * 0.5;
      sideCtx.fillStyle = 'rgba(255,255,240,' + alpha + ')';
      sideCtx.beginPath();
      sideCtx.arc(sx, sy, sr, 0, Math.PI * 2);
      sideCtx.fill();
    }

    // Fireflies (above ground, near plants)
    const ffCount = Math.min(6, Math.floor(colEntries.length * 0.6));
    for (let i = 0; i < ffCount; i++) {
      const fx = _rng(200 + i * 4) * (size.w - 80) + 40;
      const fy = groundY - 20 - _rng(201 + i * 4) * 60;
      const glow = sideCtx.createRadialGradient(fx, fy, 0, fx, fy, 6);
      glow.addColorStop(0, 'rgba(200,255,100,0.4)');
      glow.addColorStop(0.5, 'rgba(200,255,100,0.1)');
      glow.addColorStop(1, 'rgba(200,255,100,0)');
      sideCtx.fillStyle = glow;
      sideCtx.fillRect(fx - 6, fy - 6, 12, 12);
      sideCtx.fillStyle = 'rgba(220,255,120,0.8)';
      sideCtx.beginPath();
      sideCtx.arc(fx, fy, 1.5, 0, Math.PI * 2);
      sideCtx.fill();
    }

  } else {
    // ── Day: sun, clouds, butterflies, bees ──

    // Sun with rays and glow
    const sunX = size.w - 45, sunY = 25, sunR = 16;
    const sunGlow = sideCtx.createRadialGradient(sunX, sunY, sunR * 0.3, sunX, sunY, sunR * 3.5);
    sunGlow.addColorStop(0, 'rgba(255,236,130,0.25)');
    sunGlow.addColorStop(0.5, 'rgba(255,200,50,0.08)');
    sunGlow.addColorStop(1, 'rgba(255,200,50,0)');
    sideCtx.fillStyle = sunGlow;
    sideCtx.fillRect(sunX - sunR * 4, sunY - sunR * 4, sunR * 8, sunR * 8);
    // Sun rays
    sideCtx.strokeStyle = 'rgba(255,210,80,0.18)';
    sideCtx.lineWidth = 1.5;
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      sideCtx.beginPath();
      sideCtx.moveTo(sunX + Math.cos(angle) * (sunR + 3), sunY + Math.sin(angle) * (sunR + 3));
      sideCtx.lineTo(sunX + Math.cos(angle) * (sunR + 14), sunY + Math.sin(angle) * (sunR + 14));
      sideCtx.stroke();
    }
    // Sun disc
    const sunDisc = sideCtx.createRadialGradient(sunX - 3, sunY - 3, 0, sunX, sunY, sunR);
    sunDisc.addColorStop(0, '#fff8b8');
    sunDisc.addColorStop(0.6, '#ffe066');
    sunDisc.addColorStop(1, '#f5c542');
    sideCtx.fillStyle = sunDisc;
    sideCtx.beginPath();
    sideCtx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    sideCtx.fill();

    // Clouds (puffy, layered ellipses)
    function drawCloud(cx, cy, scale) {
      sideCtx.fillStyle = 'rgba(255,255,255,0.55)';
      const puffs = [
        [0, 0, 18 * scale, 10 * scale],
        [-12 * scale, 2, 12 * scale, 8 * scale],
        [10 * scale, 3, 14 * scale, 8 * scale],
        [-4 * scale, -5, 14 * scale, 8 * scale],
        [6 * scale, -3, 10 * scale, 7 * scale],
      ];
      puffs.forEach(([dx, dy, rx, ry]) => {
        sideCtx.beginPath();
        sideCtx.ellipse(cx + dx, cy + dy, rx, ry, 0, 0, Math.PI * 2);
        sideCtx.fill();
      });
    }
    // 2-3 clouds at deterministic positions
    const cloudCount = 2 + Math.floor(_rng(300) * 2);
    for (let i = 0; i < cloudCount; i++) {
      const cx = _rng(310 + i * 5) * (size.w - 100) + 50;
      const cy = 20 + _rng(311 + i * 5) * 35;
      const sc = 0.6 + _rng(312 + i * 5) * 0.5;
      drawCloud(cx, cy, sc);
    }

    // Butterflies (small, near canopy level)
    const bfCount = Math.min(4, Math.floor(colEntries.length * 0.4));
    for (let i = 0; i < bfCount; i++) {
      const bx = _rng(400 + i * 6) * (size.w - 60) + 30;
      const by = groundY - 30 - _rng(401 + i * 6) * 50;
      const wingSpan = 4 + _rng(402 + i * 6) * 3;
      const hue = Math.floor(_rng(403 + i * 6) * 360);
      const wingAlpha = 0.5 + _rng(404 + i * 6) * 0.3;
      // Left wing
      sideCtx.fillStyle = 'hsla(' + hue + ',70%,60%,' + wingAlpha + ')';
      sideCtx.beginPath();
      sideCtx.ellipse(bx - wingSpan * 0.6, by, wingSpan, wingSpan * 0.6, -0.3, 0, Math.PI * 2);
      sideCtx.fill();
      // Right wing
      sideCtx.fillStyle = 'hsla(' + hue + ',70%,65%,' + wingAlpha + ')';
      sideCtx.beginPath();
      sideCtx.ellipse(bx + wingSpan * 0.6, by, wingSpan, wingSpan * 0.6, 0.3, 0, Math.PI * 2);
      sideCtx.fill();
      // Body
      sideCtx.fillStyle = 'rgba(60,40,20,0.7)';
      sideCtx.beginPath();
      sideCtx.ellipse(bx, by, 1, wingSpan * 0.4, 0, 0, Math.PI * 2);
      sideCtx.fill();
    }

    // Bees (small, buzzing near flowers)
    const beeCount = Math.min(3, Math.floor(colEntries.length * 0.3));
    for (let i = 0; i < beeCount; i++) {
      const bx = _rng(500 + i * 5) * (size.w - 80) + 40;
      const by = groundY - 20 - _rng(501 + i * 5) * 40;
      // Body (yellow-black stripes via two ellipses)
      sideCtx.fillStyle = 'rgba(240,200,40,0.8)';
      sideCtx.beginPath();
      sideCtx.ellipse(bx, by, 4, 2.5, 0.2, 0, Math.PI * 2);
      sideCtx.fill();
      // Stripe
      sideCtx.fillStyle = 'rgba(40,30,10,0.6)';
      sideCtx.fillRect(bx - 1, by - 2.5, 2, 5);
      // Wings
      sideCtx.fillStyle = 'rgba(220,240,255,0.4)';
      sideCtx.beginPath();
      sideCtx.ellipse(bx - 1, by - 3, 3, 1.5, -0.4, 0, Math.PI * 2);
      sideCtx.fill();
      sideCtx.beginPath();
      sideCtx.ellipse(bx + 1, by - 3, 3, 1.5, 0.4, 0, Math.PI * 2);
      sideCtx.fill();
    }
  }

    // ── Soil Texture: pebbles, worms (day) / mycorrhiza (night) ──
  const pebbleCount = Math.floor(size.w / 20);
  for (let i = 0; i < pebbleCount; i++) {
    const px = _rng(600 + i * 3) * (size.w - 20) + 10;
    const py = groundY + GROUND_H + 8 + _rng(601 + i * 3) * (SOIL_H - 16);
    const pr = 1 + _rng(602 + i * 3) * 2;
    if (isNight) {
      // Mycorrhiza: faint glowing fungal network dots
      sideCtx.fillStyle = 'rgba(180,200,255,' + (0.06 + _rng(603 + i * 3) * 0.06) + ')';
      sideCtx.beginPath();
      sideCtx.arc(px, py, pr * 0.8, 0, Math.PI * 2);
      sideCtx.fill();
      // Occasional thin connection lines between nearby nodes
      if (i > 0 && _rng(604 + i * 3) > 0.6) {
        const px2 = _rng(600 + (i - 1) * 3) * (size.w - 20) + 10;
        const py2 = groundY + GROUND_H + 8 + _rng(601 + (i - 1) * 3) * (SOIL_H - 16);
        sideCtx.strokeStyle = 'rgba(160,180,240,0.04)';
        sideCtx.lineWidth = 0.5;
        sideCtx.beginPath();
        sideCtx.moveTo(px, py);
        sideCtx.quadraticCurveTo((px + px2) / 2, (py + py2) / 2 + (_rng(605 + i) - 0.5) * 20, px2, py2);
        sideCtx.stroke();
      }
    } else {
      // Pebbles: small rounded stones
      sideCtx.fillStyle = 'rgba(120,105,85,' + (0.12 + _rng(603 + i * 3) * 0.1) + ')';
      sideCtx.beginPath();
      sideCtx.ellipse(px, py, pr, pr * 0.7, _rng(604 + i * 3) * Math.PI, 0, Math.PI * 2);
      sideCtx.fill();
    }
  }

  // Earthworms (day only, a few wiggly lines)
  if (!isNight) {
    const wormCount = 2 + Math.floor(_rng(700) * 2);
    for (let i = 0; i < wormCount; i++) {
      const wx = _rng(710 + i * 4) * (size.w - 60) + 30;
      const wy = groundY + GROUND_H + 15 + _rng(711 + i * 4) * (SOIL_H - 30);
      const wLen = 10 + _rng(712 + i * 4) * 12;
      sideCtx.strokeStyle = 'rgba(180,120,100,0.2)';
      sideCtx.lineWidth = 1.5;
      sideCtx.lineCap = 'round';
      sideCtx.beginPath();
      sideCtx.moveTo(wx, wy);
      sideCtx.bezierCurveTo(
        wx + wLen * 0.3, wy - 4 + _rng(713 + i * 4) * 8,
        wx + wLen * 0.6, wy + 3 - _rng(714 + i * 4) * 6,
        wx + wLen, wy + (_rng(715 + i * 4) - 0.5) * 6
      );
      sideCtx.stroke();
      sideCtx.lineCap = 'butt';
    }
  }

    // ── Height ruler (left side) ──
  sideCtx.strokeStyle = isNight ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
  sideCtx.fillStyle   = isNight ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)';
  sideCtx.font = '8px Nunito, sans-serif';
  sideCtx.textAlign = 'right';
  sideCtx.textBaseline = 'middle';
  const hTickCm = maxHcm <= 60 ? 10 : (maxHcm <= 150 ? 25 : 50);
  for (let cm = hTickCm; cm <= maxHcm; cm += hTickCm) {
    const y = groundY - cm * pxPerCmAbove;
    if (y < 16) break;
    sideCtx.lineWidth = 0.5;
    sideCtx.beginPath();
    sideCtx.moveTo(RULER_W, y);
    sideCtx.lineTo(size.w, y);
    sideCtx.stroke();
    sideCtx.fillText(displayLength(cm), RULER_W - 3, y);
  }
  const rTickCm = maxRcm <= 40 ? 10 : (maxRcm <= 80 ? 20 : 30);
  for (let cm = rTickCm; cm <= maxRcm; cm += rTickCm) {
    const y = groundY + GROUND_H + cm * pxPerCmBelow;
    if (y > SIDE_H - 5) break;
    sideCtx.lineWidth = 0.5;
    sideCtx.beginPath();
    sideCtx.moveTo(RULER_W, y);
    sideCtx.lineTo(size.w, y);
    sideCtx.stroke();
    sideCtx.fillText(displayLength(cm), RULER_W - 3, y);
  }
  sideCtx.fillText('0', RULER_W - 3, groundY + 1);

  // ── Categorical fallback heights/depths ──
  const catDepthFrac = { 'shallow': 0.3, 'medium': 0.6, 'deep': 0.9 };
  const catHeightCm  = { 'ground-cover': 10, 'low': 30, 'medium': 60, 'tall': 120, 'climbing': 200 };

  // ── Draw each column's plants ──
  colEntries.forEach(({ plant, col }) => {
    const cx = GRID_PAD + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
    const pr = plant.properties || {};
    const m  = pr.metric || {};
    const dim = getPlantDimensions(plant, seasonMonth);

    let stemPx, rootPx, canopyPx;
    if (m.mature_height_cm) {
      stemPx   = dim.height   * pxPerCmAbove;
      rootPx   = dim.rootDepth * pxPerCmBelow;
      canopyPx = dim.spread   * pxPerCmAbove * 0.5;
    } else {
      const catH = catHeightCm[pr.growth_habit || 'low'] || 30;
      const catR = (catDepthFrac[pr.root_depth || 'shallow'] || 0.3) * maxRcm;
      const frac = seasonMonth > 0 ? growthCurve(getGrowthProgress(plant, seasonMonth)) : 1;
      stemPx   = catH * frac * pxPerCmAbove;
      rootPx   = catR * (0.3 + 0.7 * frac) * pxPerCmBelow;
      canopyPx = (catH * 0.3 * frac) * pxPerCmAbove;
    }

    // Not yet planted — show seed dot
    if (seasonMonth > 0 && dim.progress <= 0) {
      sideCtx.fillStyle = isNight ? 'rgba(143,188,143,0.3)' : 'rgba(139,115,85,0.3)';
      sideCtx.beginPath();
      sideCtx.arc(cx, groundY + GROUND_H + 6, 3, 0, Math.PI * 2);
      sideCtx.fill();
      return;
    }

    const stemTopY  = groundY - Math.max(stemPx, 2);
    const rootBotY  = groundY + GROUND_H + Math.max(rootPx, 2);

    // Root line (dashed)
    sideCtx.strokeStyle = isNight ? 'rgba(143,188,143,0.5)' : 'rgba(139,115,85,0.6)';
    sideCtx.lineWidth = 1.5;
    sideCtx.setLineDash([3, 3]);
    sideCtx.beginPath();
    sideCtx.moveTo(cx, groundY + GROUND_H);
    sideCtx.lineTo(cx, rootBotY);
    sideCtx.stroke();
    sideCtx.setLineDash([]);

    // Root tip dot
    sideCtx.fillStyle = isNight ? '#8fbc8f' : '#6B5B3E';
    sideCtx.beginPath();
    sideCtx.arc(cx, rootBotY, 2.5, 0, Math.PI * 2);
    sideCtx.fill();

    // Root lateral spread ellipse
    const rootSpreadCm = m.root_spread_cm || m.root_depth_cm || 20;
    const soil = getSoilType(bed);
    const effectiveSpread = rootSpreadCm * soil.rootFactor;
    const spreadPx = effectiveSpread * pxPerCmAbove * 0.5;
    if (spreadPx > 4) {
      const rootMidY = groundY + GROUND_H + (rootBotY - groundY - GROUND_H) * 0.5;
      const rootHalfH = (rootBotY - groundY - GROUND_H) * 0.45;
      sideCtx.fillStyle = isNight
        ? 'rgba(143,188,143,0.08)' : 'rgba(139,115,85,0.08)';
      sideCtx.strokeStyle = isNight
        ? 'rgba(143,188,143,0.2)' : 'rgba(139,115,85,0.2)';
      sideCtx.lineWidth = 0.75;
      sideCtx.setLineDash([2, 4]);
      sideCtx.beginPath();
      sideCtx.ellipse(cx, rootMidY, spreadPx, Math.max(rootHalfH, 3), 0, 0, Math.PI * 2);
      sideCtx.fill();
      sideCtx.stroke();
      sideCtx.setLineDash([]);
    }

    // Stem line
    const stemW = m.mature_height_cm ? Math.max(1.5, Math.min(4, m.mature_height_cm / 80)) : 2;
    sideCtx.strokeStyle = isNight ? '#5a8a5a' : '#588157';
    sideCtx.lineWidth = stemW;
    sideCtx.beginPath();
    sideCtx.moveTo(cx, groundY);
    sideCtx.lineTo(cx, stemTopY);
    sideCtx.stroke();

    // Canopy ellipse
    const canopyR = Math.max(canopyPx, 6);
    const canopyAlpha = dim.fraction >= 0.8 ? 0.35 : (dim.fraction >= 0.4 ? 0.25 : 0.15);
    sideCtx.fillStyle = isNight
      ? 'rgba(100,180,100,' + canopyAlpha + ')'
      : 'rgba(88,129,87,' + canopyAlpha + ')';
    sideCtx.beginPath();
    sideCtx.ellipse(cx, stemTopY + canopyR * 0.3, canopyR, canopyR * 0.7, 0, 0, Math.PI * 2);
    sideCtx.fill();

    // Plant emoji
    const emoji = emojiLookup ? emojiLookup(plant.id) : '🌱';
    sideCtx.font = stemPx > 15 ? '14px serif' : '10px serif';
    sideCtx.textAlign = 'center';
    sideCtx.textBaseline = 'bottom';
    sideCtx.fillStyle = 'white';
    sideCtx.fillText(emoji, cx, stemTopY - canopyR * 0.2);

    // Height label
    if (m.mature_height_cm && stemPx > 12) {
      const hLabel = displayLength(Math.round(dim.height));
      sideCtx.font = '8px Nunito, sans-serif';
      sideCtx.textAlign = 'center';
      sideCtx.textBaseline = 'bottom';
      sideCtx.fillStyle = isNight ? 'rgba(212,228,200,0.7)' : 'rgba(52,78,65,0.7)';
      sideCtx.fillText(hLabel, cx, stemTopY - canopyR * 0.2 - 14);
    }
  });

  // ── Title label ──
  const sideDim = bed.dimensions_cm || {};
  const soilLabel = sideDim.soil_depth ? ' \u00b7 Soil: ' + displayLength(sideDim.soil_depth) : '';
  const monthLabel = seasonMonth > 0 ? ' \u00b7 ' + MONTH_NAMES[seasonMonth] : '';
  sideCtx.fillStyle = isNight ? '#d4e4c8' : '#344e41';
  sideCtx.font = '11px Nunito, sans-serif';
  sideCtx.textAlign = 'left';
  sideCtx.textBaseline = 'top';
  sideCtx.fillText('Side View \u2014 Growth Profile' + soilLabel + monthLabel, GRID_PAD, 6);
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

  // Drag-from-canvas: pick up a planted cell
  if (!placingPlant && bed.cells[row][col]) {
    dragging = { row, col, plantId: bed.cells[row][col] };
    return; // wait for mouseup
  }

  pushUndo();
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

  // If dragging, draw ghost on canvas
  if (dragging) {
    renderBed();
    const emoji = emojiLookup ? emojiLookup(dragging.plantId) : '🌱';
    ctx.globalAlpha = 0.5;
    ctx.font = EMOJI_SIZE + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
    ctx.globalAlpha = 1;
    canvas.style.cursor = 'grabbing';
  }
}

function handleCanvasUp(e) {
  if (!dragging) return;
  const bed = getActiveBed();
  if (!bed) { dragging = null; return; }

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const { row, col } = canvasToGrid(x, y);

  // Valid target?
  if (row >= 0 && col >= 0 && row < bed.rows && col < bed.cols
      && isInsideShape(bed, row, col)
      && !(row === dragging.row && col === dragging.col)) {
    pushUndo();
    // If target is occupied, swap
    const targetPlant = bed.cells[row][col];
    setCell(bed, row, col, dragging.plantId);
    setCell(bed, dragging.row, dragging.col, targetPlant);
    saveBeds();
  }

  dragging = null;
  canvas.style.cursor = '';
  renderBed();
}

// ── Palette Drag-and-Drop ──

function handleCanvasDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cell = canvasToGrid(x, y);
  if (cell.row !== hoverCell?.row || cell.col !== hoverCell?.col) {
    hoverCell = cell;
    renderBed();
  }
}

function handleCanvasDrop(e) {
  e.preventDefault();
  const plantId = e.dataTransfer.getData('text/plant-id');
  if (!plantId) return;

  const bed = getActiveBed();
  if (!bed) return;
  const rect = canvas.getBoundingClientRect();
  const { row, col } = canvasToGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (row < 0 || col < 0 || row >= bed.rows || col >= bed.cols) return;
  if (!isInsideShape(bed, row, col)) return;

  pushUndo();
  setCell(bed, row, col, plantId);
  placingPlant = plantId;
  saveBeds();
  renderPlantPalette();
  updatePlacingLabel();
  renderBed();
}

function handleCanvasLeave() {
  hoverCell = null;
  if (dragging) {
    dragging = null;
    canvas.style.cursor = '';
  }
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
    const dimmed = seasonMonth > 0 && !isPlantInSeason(p, seasonMonth) ? ' palette-dimmed' : '';
    return '<button class="palette-plant' + (isActive ? ' palette-active' : '') + dimmed + '" ' +
      'data-plant="' + p.id + '" title="' + p.name + '" draggable="true">' +
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

export function setPlannerPlacingPlant(plantId) {
  if (!plantId) return false;

  const exists = plannerPlants.some(p => p.id === plantId && !p.stub);
  if (!exists) return false;

  placingPlant = plantId;
  renderPlantPalette();
  updatePlacingLabel();
  return true;
}

function handlePaletteDragStart(e) {
  const btn = e.target.closest('.palette-plant');
  if (!btn || !btn.dataset.plant) { e.preventDefault(); return; }
  e.dataTransfer.setData('text/plant-id', btn.dataset.plant);
  e.dataTransfer.effectAllowed = 'copy';
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
    pushUndo();
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

  // ── Spacing Crowding ──
  let crowdedCells = 0;
  for (let pr = 0; pr < bed.rows; pr++) {
    for (let pc = 0; pc < bed.cols; pc++) {
      const pid = bed.cells[pr]?.[pc];
      if (!pid || !isInsideShape(bed, pr, pc)) continue;
      const p = plannerPlants.find(pp => pp.id === pid);
      const spacingCm = p?.properties?.metric?.spacing_cm || p?.properties?.metric?.spread_cm || 0;
      if (spacingCm <= DEFAULT_CELL_CM) continue;
      const radCells = Math.ceil((spacingCm / 2) / DEFAULT_CELL_CM);
      // Check if any other plant is within this plant's spacing radius
      let tooClose = false;
      for (let dr = -radCells; dr <= radCells && !tooClose; dr++) {
        for (let dc = -radCells; dc <= radCells && !tooClose; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = pr + dr, nc = pc + dc;
          if (nr < 0 || nr >= bed.rows || nc < 0 || nc >= bed.cols) continue;
          if (!bed.cells[nr]?.[nc] || !isInsideShape(bed, nr, nc)) continue;
          const distCm = Math.sqrt(dr * dr + dc * dc) * DEFAULT_CELL_CM;
          if (distCm <= spacingCm / 2) { tooClose = true; }
        }
      }
      if (tooClose) crowdedCells++;
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

  // Water budget & yield
  let waterMlDay = 0;
  let yieldKgM2 = 0;
  let metricPlants = 0;

  for (const [pid, count] of Object.entries(plantCounts)) {
    const p = plannerPlants.find(pp => pp.id === pid);
    const m = p?.properties?.metric;
    if (!m) continue;
    metricPlants++;
    waterMlDay += (m.water_ml_per_day || 0) * count;
    yieldKgM2 += (m.yield_kg_per_m2 || 0);
  }

  const soil = getSoilType(bed);
  const waterLWeek = (waterMlDay * soil.waterFactor * 7) / 1000;

  // ── Nitrogen: proximity-aware (fixers only benefit nearby cells) ──
  // Build list of fixer cells and feeder cells
  const fixerCells = [];  // {r, c, nGm2, radiusCm}
  const feederCells = []; // {r, c, nGm2, pid}
  for (let r = 0; r < bed.rows; r++) {
    for (let c = 0; c < bed.cols; c++) {
      const pid = bed.cells[r]?.[c];
      if (!pid || !isInsideShape(bed, r, c)) continue;
      const p = plannerPlants.find(pp => pp.id === pid);
      const m = p?.properties?.metric;
      if (!m || m.nitrogen_g_per_m2 === undefined) continue;
      const nVal = m.nitrogen_g_per_m2;
      if (nVal > 0) {
        // Fixer: nitrogen influence radius = root_spread_cm × soil factors
        const baseRadius = m.root_spread_cm || m.root_depth_cm || m.spacing_cm || 30;
        const soil = getSoilType(bed);
        const radiusCm = baseRadius * soil.rootFactor * soil.n2Factor;
        fixerCells.push({ r, c, nGm2: nVal, radiusCm });
      } else if (nVal < 0) {
        feederCells.push({ r, c, nGm2: nVal, pid });
      }
    }
  }

  // For each feeder cell, check if any fixer is within root-diffusion range
  let coveredFeeders = 0;
  let totalFeeders = feederCells.length;
  let localNitrogenSum = 0; // sum of per-cell net nitrogen (proximity-weighted)

  feederCells.forEach(fc => {
    let bestFixerContrib = 0;
    fixerCells.forEach(fx => {
      const distCm = Math.sqrt((fc.r - fx.r) ** 2 + (fc.c - fx.c) ** 2) * DEFAULT_CELL_CM;
      if (distCm <= fx.radiusCm) {
        // Fixer is in range — contribution scales with distance (closer = more)
        const factor = 1 - (distCm / fx.radiusCm) * 0.5; // 100% at center, 50% at edge
        bestFixerContrib = Math.max(bestFixerContrib, fx.nGm2 * factor);
      }
    });
    const cellNet = fc.nGm2 + bestFixerContrib;
    localNitrogenSum += cellNet;
    if (bestFixerContrib > 0) coveredFeeders++;
  });

  // Also add fixer cells' own contribution (they're producing nitrogen)
  fixerCells.forEach(fx => { localNitrogenSum += fx.nGm2; });

  const nCoverage = totalFeeders > 0 ? Math.round((coveredFeeders / totalFeeders) * 100) : 100;
  const nClass = nCoverage >= 75 ? 'bed-stat--good' : (nCoverage >= 40 ? '' : 'bed-stat--bad');

  // ── Build HTML ──
  let html = '';

  // Row 1: basic counts
  html += '<div class="bed-stat"><span class="bed-stat-label">Plants</span><span class="bed-stat-value">' + plantCount + ' varieties</span></div>';
  html += '<div class="bed-stat"><span class="bed-stat-label">Filled</span><span class="bed-stat-value">' + filledCells + '/' + totalCells + ' cells</span></div>';
  html += '<div class="bed-stat"><span class="bed-stat-label">Companions</span><span class="bed-stat-value bed-stat--good">' + companionPairs + ' pairs ✓</span></div>';
  if (conflictPairs > 0) {
    html += '<div class="bed-stat"><span class="bed-stat-label">Conflicts</span><span class="bed-stat-value bed-stat--bad">' + conflictPairs + ' pairs ⚠</span></div>';
  }

  // Spacing density
  if (filledCells > 0) {
    const spacingPct = Math.round((1 - crowdedCells / filledCells) * 100);
    const spClass = spacingPct >= 80 ? 'bed-stat--good' : (spacingPct >= 50 ? '' : 'bed-stat--bad');
    const spIcon = spacingPct >= 80 ? '✓' : (spacingPct >= 50 ? '~' : '⚠');
    html += '<div class="bed-stat"><span class="bed-stat-label">📐 Spacing</span><span class="bed-stat-value ' + spClass + '">' + spacingPct + '% clear ' + spIcon + '</span></div>';
  }

  // Row 2: metric stats (only show if plants have metric data)
  if (metricPlants > 0) {
    html += '<div class="bed-stat"><span class="bed-stat-label">Bed Area</span><span class="bed-stat-value">' + displayArea(areaCm2) + '</span></div>';
    html += '<div class="bed-stat"><span class="bed-stat-label">Soil Volume</span><span class="bed-stat-value">' + displayVolume(soilVolL) + '</span></div>';
    html += '<div class="bed-stat"><span class="bed-stat-label">💧 Water</span><span class="bed-stat-value">' + displayVolume(waterLWeek) + '/week</span></div>';
    // Soil composition info
    html += '<div class="bed-stat"><span class="bed-stat-label">🌍 Soil</span><span class="bed-stat-value">' + soil.label + ' (' + soil.sand + '/' + soil.silt + '/' + soil.clay + ')</span></div>';
    if (soil.waterFactor !== 1.0) {
      const wAdj = soil.waterFactor > 1 ? '+' + Math.round((soil.waterFactor - 1) * 100) + '% (drains fast)' : Math.round((soil.waterFactor - 1) * 100) + '% (retains well)';
      html += '<div class="bed-stat"><span class="bed-stat-label">🌊 Moisture</span><span class="bed-stat-value">' + wAdj + '</span></div>';
    }

    if (totalFeeders > 0) {
      const nIcon = nCoverage >= 75 ? '✓' : (nCoverage >= 40 ? '~' : '⚠');
      html += '<div class="bed-stat"><span class="bed-stat-label">🌿 N₂ Coverage</span><span class="bed-stat-value ' + nClass + '">' + coveredFeeders + '/' + totalFeeders + ' feeders near fixers ' + nIcon + '</span></div>';
    } else if (fixerCells.length > 0) {
      html += '<div class="bed-stat"><span class="bed-stat-label">🌿 N₂</span><span class="bed-stat-value bed-stat--good">All fixers ✓</span></div>';
    }

    if (yieldKgM2 > 0) {
      const totalYieldKg = yieldKgM2 * areaM2;
      html += '<div class="bed-stat"><span class="bed-stat-label">🌾 Est. Yield</span><span class="bed-stat-value">' + displayWeight(totalYieldKg * 1000) + '</span></div>';
    }
  }

  // Row 3: unit toggle + actions
  html += '<div class="bed-stat-actions">';
  // Soil type selector
  html += '<select class="bed-action" id="soil-type-select" title="Soil type">';
  Object.entries(SOIL_TYPES).forEach(([key, st]) => {
    const sel = (bed.soilType || 'loam') === key ? ' selected' : '';
    html += '<option value="' + key + '"' + sel + '>' + st.label + '</option>';
  });
  html += '</select>';
  html += '<button class="bed-action" id="unit-toggle-btn">' + (unitPref === 'metric' ? '📏 Metric' : '📐 Imperial') + '</button>';
  html += '<button class="bed-action" id="export-png-btn" title="Save bed image">📸 Image</button>';
  html += '<button class="bed-action" id="export-json-btn" title="Export all beds">💾 Export</button>';
  html += '<button class="bed-action" id="import-json-btn" title="Import beds">📂 Import</button>';
  html += '<button class="bed-action" id="clear-bed-btn">Clear Bed</button>';
  if (beds.length > 1) {
    html += '<button class="bed-action bed-action--danger" id="remove-bed-btn">Remove Bed</button>';
  }
  html += '</div>';

  // Row 4: season scrubber
  html += '<div class="bed-stat-season">';
  html += '<label class="season-label">🗓️ Season: <span id="season-month-label">' + (seasonMonth === 0 ? 'All Year' : MONTH_NAMES[seasonMonth]) + '</span></label>';
  html += '<input type="range" id="season-slider" class="season-slider" min="0" max="12" value="' + seasonMonth + '" title="Slide to filter by month">';
  html += '</div>';

  // Row 5: growth progress (when season scrubber is active)
  if (seasonMonth > 0 && filledCells > 0) {
    let growthSum = 0, growthCount = 0;
    let tallest = '', tallestH = 0;
    for (let r = 0; r < bed.rows; r++) {
      for (let c = 0; c < bed.cols; c++) {
        const pid = bed.cells[r]?.[c];
        if (!pid || !isInsideShape(bed, r, c)) continue;
        const p = plannerPlants.find(pp => pp.id === pid);
        if (!p) continue;
        const dim = getPlantDimensions(p, seasonMonth);
        if (dim.matureH > 0) {
          growthSum += dim.fraction;
          growthCount++;
          if (dim.height > tallestH) { tallestH = dim.height; tallest = p.name || p.id; }
        }
      }
    }
    if (growthCount > 0) {
      const avgGrowth = Math.round((growthSum / growthCount) * 100);
      const gClass = avgGrowth >= 80 ? 'bed-stat--good' : (avgGrowth >= 30 ? '' : 'bed-stat--warn');
      const gPhase = avgGrowth >= 90 ? 'mature' : (avgGrowth >= 50 ? 'mid-season' : (avgGrowth > 0 ? 'early' : 'dormant'));
      html += '<div class="bed-stat"><span class="bed-stat-label">🌱 Growth</span><span class="bed-stat-value ' + gClass + '">' + avgGrowth + '% \u2014 ' + gPhase + '</span></div>';
      if (tallest && tallestH > 0) {
        html += '<div class="bed-stat"><span class="bed-stat-label">📏 Tallest</span><span class="bed-stat-value">' + tallest + ' \u00b7 ' + displayLength(Math.round(tallestH)) + '</span></div>';
      }
    }
  }

  // Hidden file input for import
  html += '<input type="file" id="import-file-input" accept=".json" hidden>';

  statsEl.innerHTML = html;

  // Direct slider wiring (input events from CDP don't bubble reliably)
  const sliderEl = document.getElementById('season-slider');
  if (sliderEl) {
    sliderEl.oninput = function() { setSeasonMonth(parseInt(this.value, 10)); };
  }
  const soilSelect = document.getElementById('soil-type-select');
  if (soilSelect) {
    soilSelect.onchange = function() {
      const bed = getActiveBed();
      if (bed) { bed.soilType = this.value; saveBeds(); renderBed(); }
    };
  }

  // Rotation tabs
  renderRotationTabs(bed);
}

// ── Stats Event Delegation (persistent, survives innerHTML replacement) ──
let statsDelegated = false;
function ensureStatsEventDelegation() {
  if (statsDelegated) return;
  const statsEl = document.getElementById('planner-bed-stats');
  if (!statsEl) return;
  statsDelegated = true;

  statsEl.addEventListener('click', function(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'clear-bed-btn') clearActiveBed();
    else if (btn.id === 'remove-bed-btn') removeBed();
    else if (btn.id === 'unit-toggle-btn') toggleUnits();
    else if (btn.id === 'export-png-btn') exportBedImage();
    else if (btn.id === 'export-json-btn') exportBedsJSON();
    else if (btn.id === 'import-json-btn') document.getElementById('import-file-input')?.click();
  });

  statsEl.addEventListener('input', function(e) {
    if (e.target.id === 'season-slider') {
      setSeasonMonth(parseInt(e.target.value, 10));
    }
  });

  statsEl.addEventListener('change', function(e) {
    if (e.target.id === 'import-file-input') {
      importBedsJSON(e.target.files[0]);
    }
  });
}

function toggleUnits() {
  unitPref = unitPref === 'metric' ? 'imperial' : 'metric';
  try { localStorage.setItem('garden-units', unitPref); } catch (e) {}
  renderBed();
}

// ── Export PNG ──

function exportBedImage() {
  const bed = getActiveBed();
  if (!bed || !canvas) return;
  canvas.toBlob(function(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (bed.name || 'garden-bed').replace(/\s+/g, '-').toLowerCase() + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// ── Import / Export Beds (JSON) ──

function exportBedsJSON() {
  const data = JSON.stringify(beds, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garden-beds.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importBedsJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported) || imported.length === 0) {
        alert('Invalid bed file — expected an array of beds.');
        return;
      }
      // Validate structure
      for (const b of imported) {
        if (!b.cells || !b.rows || !b.cols) {
          alert('Invalid bed data — missing cells, rows, or cols.');
          return;
        }
      }
      pushUndo();
      beds = imported;
      activeBedIdx = 0;
      // Ensure dimensions_cm on all imported beds
      for (const b of beds) {
        if (!b.dimensions_cm) {
          b.dimensions_cm = { width: b.cols * DEFAULT_CELL_CM, depth: b.rows * DEFAULT_CELL_CM, soil_depth: 30 };
        }
      }
      saveBeds();
      renderBedTabs();
      renderBed();
    } catch (err) {
      alert('Could not parse bed file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ── Growth Engine ──

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Sigmoid growth curve — slow establishment, fast vegetative, maturity plateau
function growthCurve(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const k = 8;
  const raw = 1 / (1 + Math.exp(-k * (t - 0.5)));
  const lo  = 1 / (1 + Math.exp(-k * -0.5));
  const hi  = 1 / (1 + Math.exp(-k *  0.5));
  return (raw - lo) / (hi - lo);
}

// Earliest month a plant starts growing (based on frost tolerance + indoor start)
function getPlantStartMonth(plant) {
  const t = plant.timing;
  if (!t) return 4; // default: April
  const frost = t.frost_tolerance || 'none';
  const startWeeks = t.indoor_start_weeks_before_frost || 0;
  const indoorOffset = Math.ceil(startWeeks / 4);

  if (frost === 'hard')     return 1;
  if (frost === 'moderate') return Math.max(1, 2 - indoorOffset);
  if (frost === 'light')    return Math.max(1, 3 - indoorOffset);
  return Math.max(1, 4 - indoorOffset); // 'none'
}

// Growth progress [0..1] at a given month — 0 = not started, 1 = mature
function getGrowthProgress(plant, month) {
  if (month <= 0) return 1; // scrubber off → show at maturity
  const startMonth = getPlantStartMonth(plant);
  if (month < startMonth) return 0; // not planted yet

  const t = plant.timing;
  const dtm = t?.days_to_maturity;
  const maturityDays = dtm ? (dtm[0] + dtm[1]) / 2 : 75; // default 75 days
  const daysGrowing = (month - startMonth) * 30; // approximate
  return Math.min(daysGrowing / maturityDays, 1);
}

// Dimensions at a given month — WASM growth engine when available, JS fallback
function getPlantDimensions(plant, month) {
  const m = plant.properties?.metric || {};
  const matureH   = m.mature_height_cm || 0;
  const matureS   = m.spread_cm        || 0;
  const matureR   = m.root_depth_cm    || 0;

  // Try WASM growth engine for plants with full metric data
  if (month > 0 && plant.timing?.days_to_maturity && matureH > 0) {
    try {
      const startMonth = getPlantStartMonth(plant);
      if (month < startMonth) {
        return { height: 0, spread: 0, rootDepth: 0, progress: 0, fraction: 0, matureH, matureS, matureR };
      }
      const daysGrowing = (month - startMonth) * 30;
      const plantDoy = startMonth * 30; // approximate planting day-of-year
      const soilKey = document.getElementById('soil-type-select')?.value || 'loam';
      const soil = SOIL_TYPES[soilKey] || SOIL_TYPES.loam;
      const env = {
        day_of_year: plantDoy,
        latitude: 42.0,
        altitude_m: 200,
        temp_high_c: 26,
        temp_low_c: 14,
        water_ml: 600,
        npk_available: [10.0, 5.0, 5.0],
        soil_water_factor: soil.waterFactor,
        soil_root_factor: soil.rootFactor,
        soil_n2_factor: soil.n2Factor,
      };
      const snapJson = simulate_growth(JSON.stringify(plant), daysGrowing, JSON.stringify(env), 0.0);
      const snap = JSON.parse(snapJson);
      const progress = getGrowthProgress(plant, month);
      return {
        height: snap.height_cm,
        spread: snap.spread_cm,
        rootDepth: snap.root_depth_cm,
        progress,
        fraction: snap.growth_rate,
        matureH, matureS, matureR,
        stage: snap.stage,
        stress: snap.stress_events,
      };
    } catch (e) {
      // Fall through to JS sigmoid
    }
  }

  // JS fallback
  const progress = getGrowthProgress(plant, month);
  const g = growthCurve(progress);

  return {
    height:    matureH * g,
    spread:    matureS * g,
    rootDepth: matureR * (0.3 + 0.7 * g),
    progress:  progress,
    fraction:  g,
    matureH, matureS, matureR,
  };
}

function isPlantInSeason(plant, month) {
  const t = plant.timing;
  if (!t) return true; // no timing data = always show

  // Simple frost-window model (zone-6 average).
  // Outdoor growing window determined by frost tolerance:
  //   none    → May–Sep (frost-free only)
  //   light   → Mar–Nov (tolerates light frost)
  //   moderate→ Feb–Nov (spring/fall crops)
  //   hard    → year-round (garlic, onions, cold-hardy greens)
  const frost = t.frost_tolerance || 'none';

  // Indoor start extends the "active" window earlier
  const startWeeks = t.indoor_start_weeks_before_frost || 0;
  const indoorOffset = Math.ceil(startWeeks / 4); // months of indoor activity

  let startMonth, endMonth;
  if (frost === 'hard') {
    startMonth = 1; endMonth = 12;
  } else if (frost === 'moderate') {
    startMonth = Math.max(1, 2 - indoorOffset); endMonth = 11;
  } else if (frost === 'light') {
    startMonth = Math.max(1, 3 - indoorOffset); endMonth = 11;
  } else {
    // frost === 'none' — tender crops
    startMonth = Math.max(1, 4 - indoorOffset); endMonth = 10;
  }

  return month >= startMonth && month <= endMonth;
}

function setSeasonMonth(m) {
  seasonMonth = m;
  renderPlantPalette();
  renderBed();
  const label = document.getElementById('season-month-label');
  if (label) label.textContent = m === 0 ? 'All Year' : MONTH_NAMES[m];
}

// ── Crop Rotation ──

function addRotationSeason(bed) {
  if (!bed.rotations) bed.rotations = [];
  bed.rotations.push({
    label: 'Season ' + (bed.rotations.length + 1),
    cells: JSON.parse(JSON.stringify(bed.cells)),
  });
  saveBeds();
}

function renderRotationTabs(bed) {
  const container = document.getElementById('rotation-tabs');
  if (!container || !bed.rotations || bed.rotations.length === 0) {
    if (container) container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = '<span class="rotation-label">Rotations:</span> ' +
    bed.rotations.map((rot, i) =>
      '<button class="rotation-tab" data-rot-idx="' + i + '">' + rot.label + '</button>'
    ).join('') +
    '<button class="rotation-tab rotation-tab-save" id="save-rotation-btn">💾 Save Current</button>';
}

function handleRotationTabClick(e) {
  const tab = e.target.closest('.rotation-tab');
  if (!tab) return;
  const bed = getActiveBed();
  if (!bed) return;

  if (tab.id === 'save-rotation-btn') {
    addRotationSeason(bed);
    renderRotationTabs(bed);
    return;
  }

  const idx = parseInt(tab.dataset.rotIdx);
  if (isNaN(idx) || !bed.rotations?.[idx]) return;

  // Load that rotation's cells into the current bed
  pushUndo();
  bed.cells = JSON.parse(JSON.stringify(bed.rotations[idx].cells));
  saveBeds();
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
  renderSideView(bed);
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

  // Event listeners — canvas
  canvas.addEventListener('mousedown', handleCanvasClick);
  canvas.addEventListener('mousemove', handleCanvasMove);
  canvas.addEventListener('mouseup', handleCanvasUp);
  canvas.addEventListener('mouseleave', handleCanvasLeave);
  canvas.addEventListener('touchstart', handleCanvasTouch, { passive: false });

  // Palette drag-and-drop onto canvas
  canvas.addEventListener('dragover', handleCanvasDragOver);
  canvas.addEventListener('drop', handleCanvasDrop);

  // Palette click + drag
  const paletteEl = document.getElementById('planner-palette');
  paletteEl?.addEventListener('click', handlePaletteClick);
  paletteEl?.addEventListener('dragstart', handlePaletteDragStart);

  document.getElementById('planner-bed-tabs')?.addEventListener('click', handleBedTabClick);
  document.getElementById('planner-view-toggle')?.addEventListener('click', toggleView);
  document.getElementById('planner-add-bed')?.addEventListener('click', addNewBed);

  // Rotation tabs
  document.getElementById('rotation-tabs')?.addEventListener('click', handleRotationTabClick);

  // Keyboard shortcuts (undo/redo)
  document.addEventListener('keydown', function(e) {
    // Only handle when planner is visible
    if (!document.getElementById('planner-panel')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      redo();
    }
  });

  // Event delegation for dynamic stats UI
  ensureStatsEventDelegation();

  // Initial render
  renderBedTabs();
  renderPlantPalette();
  updatePlacingLabel();
  renderBed();
}
