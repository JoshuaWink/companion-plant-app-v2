/**
 * optimizer.js — Growth Environment Optimizer
 *
 * Given a plant and fixed soil/location, sweeps controllable variables
 * (planting date, water, nitrogen) to find the configuration that
 * maximizes a composite performance score.
 *
 * Treats the WASM sim as a black box: input env → output snapshots → score.
 * Like lab research: isolate variables, set controls, measure outcomes.
 */

import { simulate_season } from './pkg/companion_graph.js';

// ── Scoring weights ──
const WEIGHTS = {
  peakYield:     0.35,
  avgGrowthRate: 0.25,
  stressFreePct: 0.20,
  heightRatio:   0.10,
  gddEfficiency: 0.10,
};

// ── Sweep ranges ──
const DOY_STEP     = 5;     // test every 5 days
const DOY_MIN      = 1;
const DOY_MAX      = 365;

const WATER_LEVELS = [200, 400, 600, 900, 1200, 1800];  // mL/day
const N_LEVELS     = [3, 6, 10, 15, 20, 30];             // g/m²

/**
 * Score a single simulation run.
 *
 * @param {Array} snapshots  Array of Snapshot objects from WASM
 * @param {Object} plant     Plant object with properties.metric + timing
 * @returns {{ score: number, breakdown: Object }}
 */
function scoreRun(snapshots, plant) {
  if (!snapshots || snapshots.length === 0) return { score: 0, breakdown: {} };

  const maxGeneticHeight = plant.properties?.metric?.mature_height_cm || 100;
  const matDays = ((plant.timing.days_to_maturity[0] + plant.timing.days_to_maturity[1]) / 2) || 75;

  // Metrics
  let peakYield = 0;
  let totalGrowthRate = 0;
  let stressFreeDays = 0;
  let peakHeight = 0;
  let finalGDD = 0;

  for (const snap of snapshots) {
    if (snap.yield_projected_kg > peakYield) peakYield = snap.yield_projected_kg;
    totalGrowthRate += snap.growth_rate;
    if (!snap.stress_events || snap.stress_events.length === 0) stressFreeDays++;
    if (snap.height_cm > peakHeight) peakHeight = snap.height_cm;
    finalGDD = snap.gdd_accumulated;
  }

  const avgGrowthRate = totalGrowthRate / snapshots.length;
  const stressFreePct = stressFreeDays / snapshots.length;
  const heightRatio = Math.min(peakHeight / maxGeneticHeight, 1.0);

  // GDD efficiency: how well we hit the target GDD range
  // Optimal GDD ≈ matDays × 15 (avg ~15 GDD/day in ideal conditions)
  const targetGDD = matDays * 15;
  const gddRatio = finalGDD / targetGDD;
  const gddEfficiency = gddRatio >= 0.8 && gddRatio <= 1.5
    ? 1.0
    : gddRatio < 0.8
      ? gddRatio / 0.8
      : Math.max(0, 1.0 - (gddRatio - 1.5) * 0.3);

  // Normalize yield to 0–1 range (plant's genetic max yield_kg_m2)
  const maxYield = plant.properties?.metric?.yield_kg_per_m2 || 1;
  const yieldNorm = Math.min(peakYield / maxYield, 1.0);

  const breakdown = {
    peakYield: yieldNorm,
    avgGrowthRate: Math.min(avgGrowthRate, 1.0),
    stressFreePct,
    heightRatio,
    gddEfficiency,
  };

  const score =
    WEIGHTS.peakYield     * breakdown.peakYield +
    WEIGHTS.avgGrowthRate * breakdown.avgGrowthRate +
    WEIGHTS.stressFreePct * breakdown.stressFreePct +
    WEIGHTS.heightRatio   * breakdown.heightRatio +
    WEIGHTS.gddEfficiency * breakdown.gddEfficiency;

  return { score, breakdown, raw: { peakYield, avgGrowthRate, stressFreePct, peakHeight, finalGDD } };
}

/**
 * Run one simulation with given parameters and return scored result.
 */
function evalConfig(plant, doy, waterMl, nAvailable, latitude, soil) {
  const matMax = plant.timing.days_to_maturity[1] || 90;
  const numDays = Math.min(matMax + 30, 365);

  const env = {
    day_of_year: doy,
    latitude,
    altitude_m: 200,
    temp_high_c: 28,  // placeholder — the WASM sim varies temp internally via sinusoidal model
    temp_low_c: 16,
    water_ml: waterMl,
    npk_available: [nAvailable, 5.0, 5.0],
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
    const snapshots = JSON.parse(resultJson);
    return scoreRun(snapshots, plant);
  } catch {
    return { score: 0, breakdown: {}, raw: {} };
  }
}

/**
 * Full optimizer sweep.
 *
 * @param {Object} plant       Plant data object
 * @param {number} latitude    Location latitude
 * @param {Object} soil        Soil preset { waterFactor, rootFactor, n2Factor }
 * @param {number} tempHigh    Avg summer high °C (used in sweep)
 * @param {number} tempLow     Avg summer low °C (used in sweep)
 * @param {Function} onProgress  Optional callback(pct) for UI progress
 * @returns {Object}  { best, current, landscape, allResults }
 */
export function optimizeGrowth(plant, latitude, soil, tempHigh, tempLow, onProgress) {
  const matMax = plant.timing.days_to_maturity[1] || 90;
  const numDays = Math.min(matMax + 30, 365);
  const plantJson = JSON.stringify(plant);

  const results = [];
  const landscape = [];  // DOY → best score at that DOY (for the heatmap)
  let best = null;

  const doySteps = [];
  for (let d = DOY_MIN; d <= DOY_MAX; d += DOY_STEP) doySteps.push(d);

  const totalCombos = doySteps.length * WATER_LEVELS.length * N_LEVELS.length;
  let completed = 0;

  for (const doy of doySteps) {
    let doyBest = null;

    for (const waterMl of WATER_LEVELS) {
      for (const nAvail of N_LEVELS) {
        const env = {
          day_of_year: doy,
          latitude,
          altitude_m: 200,
          temp_high_c: tempHigh,
          temp_low_c: tempLow,
          water_ml: waterMl,
          npk_available: [nAvail, 5.0, 5.0],
          soil_water_factor: soil.waterFactor,
          soil_root_factor: soil.rootFactor,
          soil_n2_factor: soil.n2Factor,
        };

        let scored;
        try {
          const resultJson = simulate_season(plantJson, numDays, JSON.stringify(env));
          const snapshots = JSON.parse(resultJson);
          scored = scoreRun(snapshots, plant);
        } catch {
          scored = { score: 0, breakdown: {}, raw: {} };
        }

        const entry = { doy, waterMl, nAvail, ...scored };
        results.push(entry);

        if (!doyBest || scored.score > doyBest.score) doyBest = entry;
        if (!best || scored.score > best.score) best = entry;

        completed++;
      }
    }

    landscape.push({ doy, score: doyBest ? doyBest.score : 0 });

    if (onProgress) onProgress(completed / totalCombos);
  }

  return { best, landscape, totalCombos, results: results.length };
}

/**
 * Quick comparison of current user settings vs optimal.
 */
export function compareWithCurrent(plant, latitude, soil, currentDoy, currentWater, currentN, tempHigh, tempLow) {
  const matMax = plant.timing.days_to_maturity[1] || 90;
  const numDays = Math.min(matMax + 30, 365);

  const env = {
    day_of_year: currentDoy,
    latitude,
    altitude_m: 200,
    temp_high_c: tempHigh,
    temp_low_c: tempLow,
    water_ml: currentWater,
    npk_available: [currentN, 5.0, 5.0],
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
    const snapshots = JSON.parse(resultJson);
    return scoreRun(snapshots, plant);
  } catch {
    return { score: 0, breakdown: {}, raw: {} };
  }
}

/**
 * Analyze individual multiplier sensitivity at a given config.
 * Varies one parameter at a time to show how each affects the score.
 */
export function sensitivityAnalysis(plant, latitude, soil, baseDoy, baseWater, baseN, tempHigh, tempLow) {
  const matMax = plant.timing.days_to_maturity[1] || 90;
  const numDays = Math.min(matMax + 30, 365);
  const plantJson = JSON.stringify(plant);

  function runOne(doy, water, n) {
    const env = {
      day_of_year: doy,
      latitude,
      altitude_m: 200,
      temp_high_c: tempHigh,
      temp_low_c: tempLow,
      water_ml: water,
      npk_available: [n, 5.0, 5.0],
      soil_water_factor: soil.waterFactor,
      soil_root_factor: soil.rootFactor,
      soil_n2_factor: soil.n2Factor,
    };
    try {
      const snapshots = JSON.parse(simulate_season(plantJson, numDays, JSON.stringify(env)));
      return scoreRun(snapshots, plant);
    } catch { return { score: 0 }; }
  }

  const baseline = runOne(baseDoy, baseWater, baseN);

  // Sweep planting date ±30 days
  const dateSweep = [];
  for (let delta = -30; delta <= 30; delta += 5) {
    const doy = ((baseDoy + delta - 1 + 365) % 365) + 1;
    const r = runOne(doy, baseWater, baseN);
    dateSweep.push({ delta, doy, score: r.score });
  }

  // Sweep water ±50%
  const waterSweep = [];
  for (let pct = 30; pct <= 250; pct += 20) {
    const water = Math.round(baseWater * pct / 100);
    const r = runOne(baseDoy, water, baseN);
    waterSweep.push({ pct, water, score: r.score });
  }

  // Sweep nitrogen
  const nSweep = [];
  for (const n of [1, 3, 5, 8, 10, 15, 20, 25, 30]) {
    const r = runOne(baseDoy, baseWater, n);
    nSweep.push({ n, score: r.score });
  }

  return { baseline, dateSweep, waterSweep, nSweep };
}

/**
 * Format DOY as human-readable date label.
 */
export function doyLabel(doy) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(new Date().getFullYear(), 0);
  d.setDate(doy);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
