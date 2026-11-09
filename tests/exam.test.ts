// Runs the exam set and prints the baseline scores.
// npm run exam
import { describe, expect, test } from 'vitest';
import { DETECT_CASES, toSignals } from '../evals/exam';
import { checkGrounding } from '../src/agents/grounding';
import { OUTPUT } from '../src/agents/prompts';
import { matchSignals } from '../src/agents/signals';
import { sentinelOffline, strategistOffline, strategistTools, tracerOffline, tracerTools } from '../src/agents/tools';
import { simulate } from '../src/core/engine';
import { costOfWaiting, plan } from '../src/core/planner';
import { SCENARIOS, toDisruption } from '../src/core/scenarios';

const pct = (a: number, b: number) => `${a}/${b} (${Math.round((a / b) * 100)}%)`;

describe('exam set: Sentinel detection (rule-based baseline)', () => {
  const rows = DETECT_CASES.map((c) => {
    const signals = toSignals(c);
    const out = sentinelOffline(signals, matchSignals(signals));
    return { id: c.id, note: c.note, expect: c.expect, got: out.scenarioId, valid: OUTPUT.sentinel.safeParse(out).success };
  });
  const correct = rows.filter((r) => r.got === r.expect).length;

  test('baseline', () => {
    console.table(rows.map((r) => ({ ...r, pass: r.got === r.expect ? 'yes' : 'NO' })));
    console.log(`Sentinel detection: ${pct(correct, rows.length)}`);
    expect(rows.every((r) => r.valid)).toBe(true);
    // the baseline must not get worse
    expect(correct).toBeGreaterThanOrEqual(13);
  });
});

describe('exam set: plans and reports for all 10 disruptions', () => {
  const normal = simulate({}).metrics;
  const rows = SCENARIOS.map((s) => {
    const d = toDisruption(s);
    const run = simulate({ disruption: d, record: true });
    const p = plan(s, d, { futures: 6 });
    const t1 = tracerTools(s, run, normal);
    const t2 = strategistTools(p, costOfWaiting(d, p.recommended.levers));
    const r1 = tracerOffline(t1);
    const r2 = strategistOffline(t2);
    const rec = p.recommended.summary;
    const none = p.doNothing.summary;
    return {
      scenario: s.id,
      plan: p.recommended.levers.join(' + ') || 'monitor only',
      onTimeDoNothing: Math.round(none.service * 1000) / 10,
      onTimePlan: Math.round(rec.service * 1000) / 10,
      costDoNothing: Math.round(none.totalCost),
      costPlan: Math.round(rec.totalCost),
      onTimeNotWorse: rec.service >= none.service - 0.001,
      cheaperOrSame: rec.totalCost <= none.totalCost + 1,
      grounded: checkGrounding(r1, t1).ok && checkGrounding(r2, t2).ok,
      valid: OUTPUT.tracer.safeParse(r1).success && OUTPUT.strategist.safeParse(r2).success,
    };
  });

  test('baseline', () => {
    console.table(rows);
    const onTime = rows.filter((r) => r.onTimeNotWorse).length;
    const cheaper = rows.filter((r) => r.cheaperOrSame).length;
    const grounded = rows.filter((r) => r.grounded).length;
    console.log(`Plan keeps on-time rate at or above doing nothing: ${pct(onTime, rows.length)}`);
    console.log(`Plan costs the same or less than doing nothing: ${pct(cheaper, rows.length)}`);
    console.log(`Reports fully grounded: ${pct(grounded, rows.length)}`);
    expect(rows.every((r) => r.valid)).toBe(true);
    expect(onTime).toBe(rows.length);
    expect(cheaper).toBeGreaterThanOrEqual(9);
    expect(grounded).toBe(rows.length);
  });
});
