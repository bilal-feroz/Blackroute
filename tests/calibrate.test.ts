import { describe, expect, test } from 'vitest';
import { simulate } from '../src/core/engine';
import { SCENARIOS, toDisruption } from '../src/core/scenarios';

describe('every scenario behaves sensibly', () => {
  const base = simulate({}).metrics;

  test('a normal three weeks has no late orders', () => {
    expect(base.serviceLevel).toBe(1);
    expect(base.latePallets).toBe(0);
  });

  for (const s of SCENARIOS) {
    test(`${s.id}: never better than normal, and its levers never make it worse`, () => {
      const d = toDisruption(s);
      const none = simulate({ disruption: d }).metrics;
      const all = simulate({ disruption: d, levers: s.levers }).metrics;
      expect(none.serviceLevel).toBeLessThanOrEqual(base.serviceLevel + 1e-9);
      expect(all.serviceLevel).toBeGreaterThanOrEqual(none.serviceLevel - 0.005);
    });
  }
});
