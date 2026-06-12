/**
 * optimizer.js — Growth Environment Optimizer
 *
 * Given either one plant or a selected crop mix and fixed soil/location,
 * sweeps controllable variables (planting date, water, nitrogen) to find the
 * configuration that maximizes a composite performance score.
 *
 * Treats the WASM sim as a black box: input env → output snapshots → score.
 * Like lab research: isolate variables, set controls, measure outcomes.
 */

import { simulate_season, simulate_plan } from './pkg/companion_graph.js';

// ── Scoring weights ──
const WEIGHTS = {
  peakYield:     0.35,
  avgGrowthRate: 0.25,
  stressFreePct: 0.20,
  heightRatio:   0.10,
  gddEfficiency: 0.10,
};

// ── Sweep ranges ──
const DOY_STEP     = 5;
const DOY_MIN      = 1;
const DOY_MAX      = 365;

const WATER_LEVELS = [200, 400, 600, 900, 1200, 1800];
const N_LEVELS     = [3, 6, 10, 15, 20, 30];

const PRIORITY_LABELS = {
  balanced: 'Balanced mix',
  focus: 'Prioritize focus crop',
  weakest: 'Protect weakest crop',
};

/**
 * Returns a 0.0–1.0 penalty factor for planting frost-sensitive plants
 * in a frost-risk season. Uses latitude to estimate frost windows.
 * 'hard' tolerance = no penalty; 'none' in frost zone = 0.05×.
 */
function frostSafetyFactor(plant, doy, latitude) {
  const tolerance = plant?.timing?.frost_tolerance || 'none';
  if (tolerance === 'hard') return 1.0;

  const absLat = Math.abs(latitude || 0);
  if (absLat < 20) return 1.0; // Tropical — no frost risk

  // Approximate last-spring-frost and first-fall-frost DOY from latitude.
  // Calibrated for North America; reasonable for other temperate regions.
  const lastSpringFrost = Math.max(0, Math.round(4 * (absLat - 20)));
  const firstFallFrost  = Math.min(365, Math.round(365 - 3.5 * (absLat - 20)));

  const inFrostZone = doy <= lastSpringFrost || doy >= firstFallFrost;
  if (!inFrostZone) return 1.0;

  if (tolerance === 'none' || tolerance === '?') return 0.05;
  if (tolerance === 'light')                     return 0.30;
  if (tolerance === 'moderate')                  return 0.65;
  return 1.0;
}

function scoreRun(snapshots, plant, doy = null, latitude = null) {
  if (!snapshots || snapshots.length === 0) return { score: 0, breakdown: {} };

  const maxGeneticHeight = plant.properties?.metric?.mature_height_cm || 100;
  const matDays = ((plant.timing.days_to_maturity[0] + plant.timing.days_to_maturity[1]) / 2) || 75;

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

  // Viability guard: if the plant never grew beyond seedling (frost-killed,
  // wrong season, or bad conditions), return a near-zero score immediately.
  // Without this, a frost-killed plant accumulates zero stress events for
  // ~150 "dead" days, which inflates stressFreePct and misleads the optimizer.
  if (peakHeight < maxGeneticHeight * 0.08 || avgGrowthRate < 0.02) {
    return {
      score: 0.01,
      breakdown: { peakYield: 0, avgGrowthRate: 0, stressFreePct: 0, heightRatio: 0, gddEfficiency: 0 },
      raw: { peakYield: 0, avgGrowthRate: 0, stressFreePct: 0, peakHeight, finalGDD },
      viability: false,
    };
  }

  const targetGDD = matDays * 15;
  const gddRatio = finalGDD / targetGDD;
  const gddEfficiency = gddRatio >= 0.8 && gddRatio <= 1.5
    ? 1.0
    : gddRatio < 0.8
      ? gddRatio / 0.8
      : Math.max(0, 1.0 - (gddRatio - 1.5) * 0.3);

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

  // Frost-aware DOY penalty: strongly penalise frost-sensitive plants
  // planted in the frost season for the given latitude.
  const finalScore = (doy !== null && latitude !== null)
    ? score * frostSafetyFactor(plant, doy, latitude)
    : score;

  return { score: finalScore, breakdown, raw: { peakYield, avgGrowthRate, stressFreePct, peakHeight, finalGDD } };
}

function normalizeTarget(target) {
  if (target && Array.isArray(target.planPlants)) {
    return {
      scope: target.scope || (target.planPlants.length > 1 ? 'selected' : 'single'),
      planPlants: target.planPlants.filter(Boolean),
      focusPlantId: target.focusPlantId || target.planPlants[0]?.id || null,
      priorityMode: target.priorityMode || 'balanced',
      plantCounts: target.plantCounts || null,
      planLabel: target.planLabel || 'Selected Crop Mix',
    };
  }

  return {
    scope: 'single',
    planPlants: [target].filter(Boolean),
    focusPlantId: target?.id || null,
    priorityMode: 'balanced',
    plantCounts: null,
    planLabel: target?.name || 'Single Plant',
  };
}

function buildEnv(doy, waterMl, nAvailable, latitude, soil, tempHigh, tempLow) {
  return {
    day_of_year: doy,
    latitude,
    altitude_m: 200,
    temp_high_c: tempHigh,
    temp_low_c: tempLow,
    water_ml: waterMl,
    npk_available: [nAvailable, 5.0, 5.0],
    soil_water_factor: soil.waterFactor,
    soil_root_factor: soil.rootFactor,
    soil_n2_factor: soil.n2Factor,
  };
}

function getSeasonLength(planPlants) {
  const matMax = Math.max(...planPlants.map((plant) => plant.timing?.days_to_maturity?.[1] || 90), 90);
  return Math.min(matMax + 30, 365);
}

function buildPlanInputs(targetInfo) {
  const orderedPlants = [...targetInfo.planPlants].sort((left, right) => {
    if (left.id === targetInfo.focusPlantId) return -1;
    if (right.id === targetInfo.focusPlantId) return 1;
    return left.name.localeCompare(right.name);
  });

  const plan = {
    plan_name: targetInfo.planLabel,
    management_mode: 'managed',
    plantings: orderedPlants.map((plant, idx) => ({
      plant_id: plant.id,
      role: plant.id === targetInfo.focusPlantId || idx === 0 ? 'primary' : 'support',
      planting_day_offset: 0,
      seed_treatments: [],
    })),
  };

  return { orderedPlants, planJson: JSON.stringify(plan) };
}

function getMemberWeight(member, targetInfo) {
  if (targetInfo.plantCounts && targetInfo.plantCounts[member.plantId] != null) {
    return Math.max(1, Number(targetInfo.plantCounts[member.plantId]) || 1);
  }
  return 1;
}

function weightedAverage(members, targetInfo, metric = 'score') {
  if (!members.length) return 0;

  let total = 0;
  let totalWeight = 0;
  members.forEach((member) => {
    const weight = getMemberWeight(member, targetInfo);
    total += (member[metric] || 0) * weight;
    totalWeight += weight;
  });

  return totalWeight > 0 ? total / totalWeight : 0;
}

function aggregateBreakdown(members, targetInfo) {
  const keys = ['peakYield', 'avgGrowthRate', 'stressFreePct', 'heightRatio', 'gddEfficiency'];
  return keys.reduce((acc, key) => {
    acc[key] = weightedAverage(
      members.map((member) => ({
        ...member,
        [key]: member.breakdown?.[key] || 0,
      })),
      targetInfo,
      key,
    );
    return acc;
  }, {});
}

function aggregatePlanScore(members, targetInfo) {
  const meanScore = weightedAverage(members, targetInfo, 'score');

  if (targetInfo.priorityMode === 'focus') {
    const focusMember = members.find((member) => member.plantId === targetInfo.focusPlantId) || members[0];
    const others = members.filter((member) => member !== focusMember);
    const otherScore = others.length ? weightedAverage(others, targetInfo, 'score') : focusMember.score;
    return 0.6 * focusMember.score + 0.4 * otherScore;
  }

  if (targetInfo.priorityMode === 'weakest') {
    return Math.min(...members.map((member) => member.score));
  }

  return meanScore;
}

function scorePlanRun(planResults, targetInfo, doy = null, latitude = null) {
  const byId = new Map(targetInfo.planPlants.map((plant) => [plant.id, plant]));
  const members = (planResults || [])
    .map((result) => {
      const plant = byId.get(result.plant_id);
      if (!plant) return null;
      const scored = scoreRun(result.snapshots || [], plant, doy, latitude);
      return {
        plantId: plant.id,
        name: plant.name,
        count: targetInfo.plantCounts?.[plant.id] || 1,
        ...scored,
      };
    })
    .filter(Boolean);

  if (!members.length) {
    return { score: 0, breakdown: {}, raw: {}, members: [] };
  }

  return {
    score: aggregatePlanScore(members, targetInfo),
    breakdown: aggregateBreakdown(members, targetInfo),
    raw: {
      memberCount: members.length,
      weightedMeanScore: weightedAverage(members, targetInfo, 'score'),
      weakestScore: Math.min(...members.map((member) => member.score)),
    },
    members,
  };
}

function runTarget(target, doy, waterMl, nAvailable, latitude, soil, tempHigh, tempLow) {
  const targetInfo = normalizeTarget(target);
  const env = buildEnv(doy, waterMl, nAvailable, latitude, soil, tempHigh, tempLow);

  if (targetInfo.planPlants.length <= 1) {
    const plant = targetInfo.planPlants[0];
    if (!plant) return { score: 0, breakdown: {}, raw: {}, members: [] };

    try {
      const resultJson = simulate_season(
        JSON.stringify(plant),
        getSeasonLength([plant]),
        JSON.stringify(env),
      );
      const snapshots = JSON.parse(resultJson);
      return scoreRun(snapshots, plant, doy, latitude);
    } catch {
      return { score: 0, breakdown: {}, raw: {}, members: [] };
    }
  }

  try {
    const { orderedPlants, planJson } = buildPlanInputs(targetInfo);
    const resultJson = simulate_plan(
      planJson,
      JSON.stringify(orderedPlants),
      getSeasonLength(orderedPlants),
      JSON.stringify(env),
    );
    return scorePlanRun(JSON.parse(resultJson), targetInfo, doy, latitude);
  } catch {
    return { score: 0, breakdown: {}, raw: {}, members: [] };
  }
}

export function optimizeGrowth(plant, latitude, soil, tempHigh, tempLow, onProgress) {
  const targetInfo = normalizeTarget(plant);

  const results = [];
  const landscape = [];
  let best = null;

  const doySteps = [];
  for (let d = DOY_MIN; d <= DOY_MAX; d += DOY_STEP) doySteps.push(d);

  const totalCombos = doySteps.length * WATER_LEVELS.length * N_LEVELS.length;
  let completed = 0;

  for (const doy of doySteps) {
    let doyBest = null;

    for (const waterMl of WATER_LEVELS) {
      for (const nAvail of N_LEVELS) {
        const scored = runTarget(targetInfo, doy, waterMl, nAvail, latitude, soil, tempHigh, tempLow);
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

export function compareWithCurrent(plant, latitude, soil, currentDoy, currentWater, currentN, tempHigh, tempLow) {
  return runTarget(plant, currentDoy, currentWater, currentN, latitude, soil, tempHigh, tempLow);
}

export function sensitivityAnalysis(plant, latitude, soil, baseDoy, baseWater, baseN, tempHigh, tempLow) {
  const targetInfo = normalizeTarget(plant);

  function runOne(doy, water, n) {
    return runTarget(targetInfo, doy, water, n, latitude, soil, tempHigh, tempLow);
  }

  const baseline = runOne(baseDoy, baseWater, baseN);

  const dateSweep = [];
  for (let delta = -30; delta <= 30; delta += 5) {
    const doy = ((baseDoy + delta - 1 + 365) % 365) + 1;
    const r = runOne(doy, baseWater, baseN);
    dateSweep.push({ delta, doy, score: r.score });
  }

  const waterSweep = [];
  for (let pct = 30; pct <= 250; pct += 20) {
    const water = Math.round(baseWater * pct / 100);
    const r = runOne(baseDoy, water, baseN);
    waterSweep.push({ pct, water, score: r.score });
  }

  const nSweep = [];
  for (const n of [1, 3, 5, 8, 10, 15, 20, 25, 30]) {
    const r = runOne(baseDoy, baseWater, n);
    nSweep.push({ n, score: r.score });
  }

  return { baseline, dateSweep, waterSweep, nSweep };
}

export function doyLabel(doy) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(new Date().getFullYear(), 0);
  d.setDate(doy);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function optimizerPriorityLabel(mode) {
  return PRIORITY_LABELS[mode] || PRIORITY_LABELS.balanced;
}
