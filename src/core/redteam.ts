// Red Team stress test: before a plan reaches a human, try to break it.
// Each test re-runs the simulator with something going worse than expected.

import { simulate } from './engine';
import { mulberry32 } from './rng';
import type { Scenario } from './scenarios';
import type { Disruption, LeverId, Metrics } from './types';

export const STRESS_TARGET = 0.95;

export interface StressTest {
  id: string;
  title: string;
  what: string;
  metrics: Metrics;
  held: boolean;
}

export interface RedTeamReport {
  tests: StressTest[];
  survived: number;
  verdict: 'robust' | 'mostly robust' | 'fragile';
  weakest: StressTest;
}

function secondShock(scenario: Scenario, d: Disruption): { shock: Disruption; label: string } {
  const end = d.startHour + d.durationHours;
  if (scenario.place === 'global') {
    // when a chokepoint reopens, ships arrive in a bunch and jam the port
    return {
      shock: { kind: 'port_congestion', target: 'jebel_ali', startHour: Math.max(d.startHour + 24, end - 24), durationHours: 96 },
      label: 'Jebel Ali jams when the held ships all arrive at once',
    };
  }
  if (scenario.kind === 'weather') {
    return { shock: { kind: 'road_closure', target: 'e311', startHour: d.startHour + 12, durationHours: 72 }, label: 'A crash closes the E311 during the storm' };
  }
  return { shock: { kind: 'weather', target: 'uae', startHour: d.startHour + 24, durationHours: 48 }, label: 'A sandstorm hits while the network is already stretched' };
}

export function redTeam(scenario: Scenario, disruption: Disruption, levers: LeverId[]): RedTeamReport {
  const run = (extra: Partial<Parameters<typeof simulate>[0]>) => simulate({ disruption, levers, ...extra }).metrics;
  const tests: StressTest[] = [];
  const add = (id: string, title: string, what: string, metrics: Metrics) =>
    tests.push({ id, title, what, metrics, held: metrics.serviceLevel >= STRESS_TARGET });

  add('longer', 'It lasts 50% longer', `The disruption runs ${Math.round((disruption.durationHours * 1.5) / 24)} days instead of ${Math.round(disruption.durationHours / 24)}.`, run({ durationFactor: 1.5 }));
  add('surge', 'Demand jumps 20%', 'Customers panic-buy while stock is short.', run({ demandFactor: 1.2 }));
  const second = secondShock(scenario, disruption);
  add('second', 'A second shock', second.label + '.', run({ extraDisruption: second.shock }));
  add('late', 'We act a day late', 'Approval takes 24 hours, so every lever starts a day later.', run({ actHour: disruption.startHour + 24 }));

  // the unluckiest of 20 random futures
  const rand = mulberry32(99);
  let worst: Metrics | null = null;
  for (let i = 0; i < 20; i++) {
    const m = run({ seed: Math.floor(rand() * 1e9), durationFactor: 0.8 + rand() * 0.6 });
    if (!worst || m.serviceLevel < worst.serviceLevel) worst = m;
  }
  add('unlucky', 'Unluckiest of 20 futures', 'Slow ships, high demand and a long disruption, all at once.', worst!);

  const survived = tests.filter((t) => t.held).length;
  const weakest = [...tests].sort((a, b) => a.metrics.serviceLevel - b.metrics.serviceLevel)[0];
  const verdict = survived === tests.length ? 'robust' : survived >= tests.length - 2 ? 'mostly robust' : 'fragile';
  return { tests, survived, verdict, weakest };
}
