import { expect, test } from 'vitest';
import * as tools from '../src/agents/tools';
import * as radar from '../src/core/radar';
import * as sc from '../src/core/scenarios';
import { simulate } from '../src/core/engine';

test('leverNames reads like a plan', () => {
  expect(tools.leverNames([])).toBe('Monitor and hold (no levers)');
  expect(tools.leverNames(['divert_fujairah'])).toBe('Divert ships to Fujairah');
});

test('linkName names the link a scenario breaks', () => {
  expect(radar.linkName(sc.SCENARIO_BY_ID.hormuz_closure)).toBe('Strait of Hormuz');
  expect(radar.linkName(sc.SCENARIO_BY_ID.jebel_ali_congestion)).toBe('Jebel Ali Port');
});

test('every scenario starts with a likelihood between 0 and 1', () => {
  for (const s of sc.SCENARIOS) {
    const p = radar.baseLikelihood(s);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  }
});

test('toDisruption starts at detection and lasts the planning case', () => {
  const s = sc.SCENARIO_BY_ID.hormuz_closure;
  const d = sc.toDisruption(s);
  expect(d.startHour).toBe(sc.DETECTION_HOUR);
  expect(d.durationHours).toBe(Math.round(s.defaultDays * 24));
  expect(sc.toDisruption(s, 2).durationHours).toBe(48);
});

test('metricsBrief rounds numbers for the agents', () => {
  const b = tools.metricsBrief(simulate({}).metrics);
  expect(Number.isInteger(b.onTimePct * 10)).toBe(true);
  expect(Number.isInteger(b.totalCostAed)).toBe(true);
});
