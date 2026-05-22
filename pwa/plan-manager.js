/**
 * plan-manager.js — Planting Plan save/load/export/import
 *
 * Manages PlantingPlan objects in localStorage and provides
 * JSON export/import for sharing plans.
 *
 * Storage key: "planting-plans" → { [planName]: PlantingPlan }
 */

import { simulate_plan } from './pkg/companion_graph.js';

const STORAGE_KEY = 'planting-plans';

// ── CRUD ────────────────────────────────────────────

/** Get all saved plans as { planName: PlantingPlan } */
export function getAllPlans() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

/** Get a single plan by name, or null */
export function getPlan(name) {
  return getAllPlans()[name] || null;
}

/** Save a plan (overwrites if same name exists) */
export function savePlan(plan) {
  if (!plan || !plan.plan_name) throw new Error('Plan must have a plan_name');
  const all = getAllPlans();
  all[plan.plan_name] = plan;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return plan;
}

/** Delete a plan by name */
export function deletePlan(name) {
  const all = getAllPlans();
  delete all[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** List all plan names */
export function listPlanNames() {
  return Object.keys(getAllPlans());
}

// ── Export / Import ─────────────────────────────────

/** Export a plan as a JSON file download */
export function exportPlan(name) {
  const plan = getPlan(name);
  if (!plan) throw new Error(`Plan "${name}" not found`);

  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.toLowerCase().replace(/\s+/g, '-')}.plan.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Import a plan from a JSON file (returns Promise<PlantingPlan>) */
export function importPlan(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const plan = JSON.parse(reader.result);
        if (!plan.plan_name || !Array.isArray(plan.plantings)) {
          reject(new Error('Invalid plan format: must have plan_name and plantings array'));
          return;
        }
        savePlan(plan);
        resolve(plan);
      } catch (e) {
        reject(new Error('Failed to parse plan JSON: ' + e.message));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ── Simulation ──────────────────────────────────────

/**
 * Run a planting plan simulation.
 * @param {object} plan - PlantingPlan object
 * @param {Array} plantsDb - Full plant database array
 * @param {number} numDays - Season length in days
 * @param {object} env - Base environment object
 * @returns {Array} Per-plant results: [{ plant_id, role, planting_day_offset, snapshots }]
 */
export function runPlanSimulation(plan, plantsDb, numDays, env) {
  const resultJson = simulate_plan(
    JSON.stringify(plan),
    JSON.stringify(plantsDb),
    numDays,
    JSON.stringify(env)
  );
  return JSON.parse(resultJson);
}

// ── UI Wiring ───────────────────────────────────────

/**
 * Build plan management UI controls.
 * Call after DOM is ready. Appends to the given container element.
 */
export function mountPlanUI(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="plan-manager" style="margin: 1rem 0; padding: 1rem; border: 1px solid #444; border-radius: 8px;">
      <h3 style="margin: 0 0 0.75rem 0;">Planting Plans</h3>

      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <select id="plan-selector" style="flex: 1; min-width: 150px; padding: 0.4rem;">
          <option value="">— Select a plan —</option>
        </select>
        <button id="plan-load-btn" title="Load selected plan">Load</button>
        <button id="plan-delete-btn" title="Delete selected plan">Delete</button>
        <button id="plan-export-btn" title="Export as JSON">Export</button>
      </div>

      <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; align-items: center;">
        <label style="cursor: pointer; padding: 0.4rem 0.8rem; border: 1px solid #666; border-radius: 4px;">
          Import JSON
          <input type="file" id="plan-import-input" accept=".json" style="display: none;">
        </label>
        <span id="plan-status" style="font-size: 0.85rem; color: #aaa;"></span>
      </div>
    </div>
  `;

  const selector = container.querySelector('#plan-selector');
  const statusEl = container.querySelector('#plan-status');

  function refreshSelector() {
    const names = listPlanNames();
    const current = selector.value;
    selector.innerHTML = '<option value="">— Select a plan —</option>';
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      selector.appendChild(opt);
    });
    if (names.includes(current)) selector.value = current;
  }

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#f44' : '#4f4';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }

  // Load
  container.querySelector('#plan-load-btn').addEventListener('click', () => {
    const name = selector.value;
    if (!name) { showStatus('Select a plan first', true); return; }
    const plan = getPlan(name);
    if (plan) {
      showStatus(`Loaded "${name}"`);
      container.dispatchEvent(new CustomEvent('plan-loaded', { detail: plan, bubbles: true }));
    }
  });

  // Delete
  container.querySelector('#plan-delete-btn').addEventListener('click', () => {
    const name = selector.value;
    if (!name) { showStatus('Select a plan first', true); return; }
    deletePlan(name);
    refreshSelector();
    showStatus(`Deleted "${name}"`);
  });

  // Export
  container.querySelector('#plan-export-btn').addEventListener('click', () => {
    const name = selector.value;
    if (!name) { showStatus('Select a plan first', true); return; }
    try {
      exportPlan(name);
      showStatus(`Exported "${name}"`);
    } catch (e) {
      showStatus(e.message, true);
    }
  });

  // Import
  container.querySelector('#plan-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const plan = await importPlan(file);
      refreshSelector();
      selector.value = plan.plan_name;
      showStatus(`Imported "${plan.plan_name}"`);
      container.dispatchEvent(new CustomEvent('plan-loaded', { detail: plan, bubbles: true }));
    } catch (err) {
      showStatus(err.message, true);
    }
    e.target.value = ''; // reset file input
  });

  refreshSelector();
  return { refreshSelector, showStatus };
}


// ── Bootstrap ───────────────────────────────────────

/**
 * Seed example plans from data/plans/ if no plans exist in localStorage.
 * Call once at app startup.
 */
export async function bootstrapExamplePlans() {
  const existing = listPlanNames();
  if (existing.length > 0) return; // user already has plans

  const examples = ['three-sisters'];
  for (const name of examples) {
    try {
      const resp = await fetch(`/data/plans/${name}.json`);
      if (resp.ok) {
        const plan = await resp.json();
        savePlan(plan);
      }
    } catch {
      // Silently skip — example plans are optional
    }
  }
}

