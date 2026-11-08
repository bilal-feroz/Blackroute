// Recovery planner. Tests combinations of recovery levers against many
// possible futures (Monte Carlo) and ranks them for four goals.
// Every number it returns comes from the simulator.

import { simulate } from './engine';
import { LEVER_BY_ID } from './network';
import { mulberry32 } from './rng';
import type { Scenario } from './scenarios';
import type { Disruption, LeverId, Metrics } from './types';

export type Objective = 'balanced' | 'cheapest' | 'fastest' | 'greenest';
export const OBJECTIVES: { id: Objective; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'Balanced', blurb: 'Lowest total cost once late-delivery penalties are counted.' },
  { id: 'cheapest', label: 'Cheapest', blurb: 'Lowest spend that still keeps service above 97%.' },
  { id: 'fastest', label: 'Fastest', blurb: 'Fewest late deliveries and quickest recovery.' },
  { id: 'greenest', label: 'Greenest', blurb: 'Lowest CO₂ that still keeps service above 97%.' },
];

/** service level a future must reach to count as "held" */
export const SERVICE_TARGET = 0.97;

export interface Summary {
  service: number;
  serviceP10: number;
  latePalletDays: number;
  priorityLate: number;
  recoveryHours: number | null;
  /** money spent on the response (no penalties) */
  spend: number;
  /** spend + late-delivery penalties */
  totalCost: number;
  co2: number;
  /** futures where service stayed at or above target */
  held: number;
  futures: number;
}

export interface Candidate {
  levers: LeverId[];
  expected: Metrics;
  summary: Summary;
  scores: Record<Objective, number>;
}

export interface PlanResult {
  disruption: Disruption;
  doNothing: Candidate;
  candidates: Candidate[];
  best: Record<Objective, Candidate>;
  recommended: Candidate;
  /** which goals each distinct plan wins */
  options: { candidate: Candidate; goals: Objective[] }[];
  runs: number;
  ms: number;
}

export interface PlanProgress {
  done: number;
  total: number;
  label: string;
}

const spendOf = (m: Metrics) => m.costAed - (m.costBreakdown.latePenalties ?? 0);

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

export function evaluate(disruption: Disruption, levers: LeverId[], futures: number, seed = 7, actHour?: number): Candidate {
  const expected = simulate({ disruption, levers, actHour }).metrics;
  const rand = mulberry32(seed);
  const ms: Metrics[] = [];
  for (let i = 0; i < futures; i++) {
    const s = Math.floor(rand() * 1e9);
    const durationFactor = 0.8 + rand() * 0.6; // the disruption can run 20% short or 40% long
    ms.push(simulate({ disruption, levers, actHour, seed: s, durationFactor }).metrics);
  }
  const avg = (f: (m: Metrics) => number) => ms.reduce((a, m) => a + f(m), 0) / Math.max(1, ms.length);
  const recov = ms.map((m) => m.recoveryHours);
  const summary: Summary = {
    service: avg((m) => m.serviceLevel),
    serviceP10: percentile(ms.map((m) => m.serviceLevel), 0.1),
    latePalletDays: avg((m) => m.latePalletDays),
    priorityLate: avg((m) => m.priorityLatePallets),
    recoveryHours: recov.some((r) => r === null) ? null : avg((m) => m.recoveryHours ?? 0),
    spend: avg(spendOf),
    totalCost: avg((m) => m.costAed),
    co2: avg((m) => m.co2Kg),
    held: ms.filter((m) => m.serviceLevel >= SERVICE_TARGET).length,
    futures: ms.length,
  };
  const c: Candidate = { levers: [...levers].sort(byLeverOrder), expected, summary, scores: { balanced: 0, cheapest: 0, fastest: 0, greenest: 0 } };
  c.scores = score(c);
  return c;
}

function score(c: Candidate): Record<Objective, number> {
  const s = c.summary;
  const riskPenalty = (1 - s.held / Math.max(1, s.futures)) * 60000;
  // falling below the service target loses customers, not just penalty fees
  const churn = Math.max(0, SERVICE_TARGET - s.service) * 6_000_000;
  const okService = s.service >= SERVICE_TARGET;
  const recoveryDays = s.recoveryHours === null ? 30 : s.recoveryHours / 24;
  return {
    balanced: s.totalCost + riskPenalty + churn,
    cheapest: okService ? s.spend : 1e9 + s.totalCost,
    fastest: s.latePalletDays * 1000 + recoveryDays * 2000 + s.spend / 1e4,
    greenest: okService ? s.co2 : 1e12 + s.totalCost,
  };
}

const LEVER_ORDER: LeverId[] = ['divert_fujairah', 'long_route', 'regional_buy', 'air_freight', 'extra_trucks', 'rebalance', 'priority'];
function byLeverOrder(a: LeverId, b: LeverId) {
  return LEVER_ORDER.indexOf(a) - LEVER_ORDER.indexOf(b);
}

function combos<T>(items: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length) out.push([...acc]);
    if (acc.length === maxSize) return;
    for (let i = start; i < items.length; i++) rec(i + 1, [...acc, items[i]]);
  };
  rec(0, []);
  return out;
}

/** Simpler plans win near-ties: a lever has to earn its place. */
function pick(cands: Candidate[], objective: Objective): Candidate {
  const sorted = [...cands].sort((a, b) => a.scores[objective] - b.scores[objective]);
  const top = sorted[0];
  const tol = Math.abs(top.scores[objective]) * 0.02;
  const near = sorted.filter((c) => c.scores[objective] - top.scores[objective] <= tol);
  near.sort((a, b) => a.levers.length - b.levers.length || a.scores[objective] - b.scores[objective]);
  return near[0];
}

export function plan(
  scenario: Scenario,
  disruption: Disruption,
  opts: { futures?: number; onProgress?: (p: PlanProgress) => void } = {},
): PlanResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const futures = opts.futures ?? 20;
  const levers = scenario.levers;
  let runs = 0;

  // 1. screen every single lever on the expected future
  const screened = levers
    .map((l) => ({ l, m: simulate({ disruption, levers: [l] }).metrics }))
    .sort((a, b) => a.m.costAed - b.m.costAed);
  runs += levers.length;
  const shortlist = screened.slice(0, 4).map((x) => x.l);

  // 2. every combination of up to three shortlisted levers, plus each single lever
  const sets = new Map<string, LeverId[]>();
  sets.set('', []);
  for (const l of levers) sets.set(l, [l]);
  for (const c of combos(shortlist, 3)) sets.set([...c].sort(byLeverOrder).join('+'), c);

  const list = [...sets.values()];
  const total = list.length;
  const candidates: Candidate[] = [];
  list.forEach((ls, i) => {
    opts.onProgress?.({ done: i, total, label: ls.length ? ls.map((l) => LEVER_BY_ID[l].short).join(' + ') : 'Do nothing' });
    candidates.push(evaluate(disruption, ls, futures));
    runs += futures + 1;
  });
  opts.onProgress?.({ done: total, total, label: 'Ranking plans' });

  const doNothing = candidates.find((c) => c.levers.length === 0)!;
  // "monitor and hold" is a real option: no lever has to be pulled if none helps
  const options = candidates;
  const best = {
    balanced: pick(options, 'balanced'),
    cheapest: pick(options, 'cheapest'),
    fastest: pick(options, 'fastest'),
    greenest: pick(options, 'greenest'),
  };

  const grouped: { candidate: Candidate; goals: Objective[] }[] = [];
  for (const o of ['balanced', 'fastest', 'cheapest', 'greenest'] as Objective[]) {
    const c = best[o];
    const g = grouped.find((x) => x.candidate === c);
    if (g) g.goals.push(o);
    else grouped.push({ candidate: c, goals: [o] });
  }

  candidates.sort((a, b) => a.scores.balanced - b.scores.balanced);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { disruption, doNothing, candidates, best, recommended: best.balanced, options: grouped, runs, ms: t1 - t0 };
}

export interface WaitingCost {
  delayHours: number;
  metrics: Metrics;
}

/** What it costs to act later: the same plan started now, in a day and in three days. */
export function costOfWaiting(disruption: Disruption, levers: LeverId[], delays = [0, 24, 72]): WaitingCost[] {
  return delays.map((d) => ({
    delayHours: d,
    metrics: simulate({ disruption, levers, actHour: disruption.startHour + d }).metrics,
  }));
}
