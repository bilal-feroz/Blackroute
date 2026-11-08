import { describe, expect, test } from 'vitest';
import { simulate } from '../src/core/engine';
import { SCENARIO_BY_ID, toDisruption } from '../src/core/scenarios';

const hormuz = toDisruption(SCENARIO_BY_ID.hormuz_closure);

describe('simulator', () => {
  test('is deterministic for the same seed', () => {
    const a = simulate({ disruption: hormuz, seed: 42 }).metrics;
    const b = simulate({ disruption: hormuz, seed: 42 }).metrics;
    expect(a).toEqual(b);
  });

  test('a Hormuz closure causes late orders and holds ships at the strait', () => {
    const run = simulate({ disruption: hormuz, record: true });
    expect(run.metrics.serviceLevel).toBeLessThan(0.95);
    expect(run.vessels.some((v) => v.heldAt === 'hormuz')).toBe(true);
    expect(run.events.some((e) => e.tone === 'bad')).toBe(true);
  });

  test('diverting to Fujairah reroutes ships outside the strait and recovers service', () => {
    const none = simulate({ disruption: hormuz }).metrics;
    const run = simulate({ disruption: hormuz, levers: ['divert_fujairah'], record: true });
    expect(run.vessels.some((v) => v.port === 'fujairah')).toBe(true);
    expect(run.metrics.serviceLevel).toBeGreaterThan(none.serviceLevel);
  });

  test('recording keeps hourly series and truck trips for the 3D replay', () => {
    const run = simulate({ record: true });
    expect(run.stockSeries.al_quoz.length).toBe(run.horizonHours);
    expect(run.trips.length).toBeGreaterThan(20);
  });

  test('serving key accounts first cuts their late pallets', () => {
    const none = simulate({ disruption: hormuz }).metrics;
    const prio = simulate({ disruption: hormuz, levers: ['priority'] }).metrics;
    expect(prio.priorityLatePallets).toBeLessThan(none.priorityLatePallets);
  });

  test('a closed DC can be covered by its neighbour', () => {
    const d = toDisruption(SCENARIO_BY_ID.al_quoz_outage);
    const none = simulate({ disruption: d }).metrics;
    const reb = simulate({ disruption: d, levers: ['rebalance'] }).metrics;
    expect(reb.serviceLevel).toBeGreaterThan(none.serviceLevel);
  });
});
