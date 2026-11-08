import { describe, expect, test } from 'vitest';
import { costOfWaiting, plan } from '../src/core/planner';
import { scanRadar } from '../src/core/radar';
import { redTeam } from '../src/core/redteam';
import { SCENARIO_BY_ID, toDisruption } from '../src/core/scenarios';

const s = SCENARIO_BY_ID.hormuz_closure;
const d = toDisruption(s);

describe('planner', () => {
  const result = plan(s, d, { futures: 8 });

  test('recommends a plan that beats doing nothing', () => {
    expect(result.recommended.levers.length).toBeGreaterThan(0);
    expect(result.recommended.summary.service).toBeGreaterThan(result.doNothing.summary.service);
    expect(result.recommended.summary.totalCost).toBeLessThan(result.doNothing.summary.totalCost);
  });

  test('gives a best plan for every goal and groups goals that agree', () => {
    for (const g of ['balanced', 'cheapest', 'fastest', 'greenest'] as const) expect(result.best[g]).toBeDefined();
    const goals = result.options.flatMap((o) => o.goals).sort();
    expect(goals).toEqual(['balanced', 'cheapest', 'fastest', 'greenest']);
  });

  test('acting later costs more', () => {
    const w = costOfWaiting(d, result.recommended.levers);
    expect(w[2].metrics.costAed).toBeGreaterThan(w[0].metrics.costAed);
    const dc = toDisruption(SCENARIO_BY_ID.al_quoz_outage);
    const w2 = costOfWaiting(dc, ['rebalance', 'priority']);
    expect(w2[2].metrics.costAed).toBeGreaterThan(w2[0].metrics.costAed);
  });

  test('says "monitor only" when no lever really helps', () => {
    const minor = SCENARIO_BY_ID.e311_closure;
    const r = plan(minor, toDisruption(minor), { futures: 4 });
    expect(r.recommended.levers.length).toBeLessThanOrEqual(1);
  });
});

describe('Black Route Radar', () => {
  test('ranks every scenario and puts the riskiest first', () => {
    const items = scanRadar();
    expect(items.length).toBeGreaterThan(5);
    expect(items[0].riskScore).toBe(100);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].riskAed).toBeGreaterThanOrEqual(items[i].riskAed);
  });

  test('a live signal raises a link up the ranking', () => {
    const before = scanRadar().findIndex((i) => i.scenario.id === 'hormuz_closure');
    const after = scanRadar({ hormuz_closure: 0.7 }).findIndex((i) => i.scenario.id === 'hormuz_closure');
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBe(0);
  });
});

describe('Red Team', () => {
  test('runs five stress tests on a plan', () => {
    const r = redTeam(s, d, ['divert_fujairah', 'priority']);
    expect(r.tests).toHaveLength(5);
    expect(r.survived).toBeGreaterThanOrEqual(0);
    expect(['robust', 'mostly robust', 'fragile']).toContain(r.verdict);
  });
});
