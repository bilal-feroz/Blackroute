import { test } from 'vitest';
import { simulate } from '../src/core/engine';
import { SCENARIOS, toDisruption } from '../src/core/scenarios';

const fmt = (r: ReturnType<typeof simulate>) => {
  const m = r.metrics;
  return `svc ${(m.serviceLevel * 100).toFixed(1)}% late ${m.latePallets.toFixed(0)} lpd ${m.latePalletDays.toFixed(0)} prio ${m.priorityLatePallets.toFixed(0)} rec ${m.recoveryHours} cost ${(m.costAed / 1000).toFixed(0)}k co2 ${(m.co2Kg / 1000).toFixed(1)}t`;
};

test('calibration print', () => {
  const t0 = performance.now();
  console.log('baseline', fmt(simulate({})));
  for (const s of SCENARIOS) {
    const d = toDisruption(s);
    console.log(s.id.padEnd(22), 'none ', fmt(simulate({ disruption: d })));
    console.log(''.padEnd(22), 'all  ', fmt(simulate({ disruption: d, levers: s.levers })));
  }
  console.log('ms per run', ((performance.now() - t0) / (1 + SCENARIOS.length * 2)).toFixed(2));
});
