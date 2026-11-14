// Runs the exam set against the live AI model (needs a key in .env).
// npm run exam:live
import { describe, expect, test } from 'vitest';
import { provider, runAgent } from '../api/_lib/llm';
import { DETECT_CASES, toSignals } from '../evals/exam';
import { checkGrounding } from '../src/agents/grounding';
import { OUTPUT, fitLists } from '../src/agents/prompts';
import { matchSignals } from '../src/agents/signals';
import { sentinelSignals, sentinelTools, strategistTools, tracerTools } from '../src/agents/tools';
import { simulate } from '../src/core/engine';
import { costOfWaiting, plan } from '../src/core/planner';
import { SCENARIOS, toDisruption } from '../src/core/scenarios';

const live = !!provider() && process.env.LIVE_EXAM === '1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parse(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  }
}

async function ask(agent: Parameters<typeof runAgent>[0], tools: unknown, signals: unknown) {
  const t0 = performance.now();
  for (let i = 0; ; i++) {
    try {
      const r = await runAgent(agent, tools, signals);
      return { ...r, ms: performance.now() - t0 };
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(8000 * (i + 1)); // free tier: wait out the per-minute limit
    }
  }
}

describe.skipIf(!live)('live AI exam', () => {
  test('Sentinel on the 16 signal cases', { timeout: 600_000 }, async () => {
    const rows = [];
    for (const c of DETECT_CASES) {
      const signals = toSignals(c);
      const r = await ask('sentinel', sentinelTools(matchSignals(signals)), sentinelSignals(signals));
      const out = OUTPUT.sentinel.safeParse(fitLists('sentinel', parse(r.text)));
      rows.push({ id: c.id, expect: c.expect, got: out.success ? out.data.scenarioId : 'INVALID', pass: out.success && out.data.scenarioId === c.expect, ms: Math.round(r.ms) });
      await sleep(1500);
    }
    console.table(rows);
    const correct = rows.filter((r) => r.pass).length;
    const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    console.log(`LIVE Sentinel (${provider()!.model}): ${correct}/${rows.length}, median ${ms[ms.length >> 1]} ms, max ${ms[ms.length - 1]} ms`);
    expect(correct).toBeGreaterThanOrEqual(14);
  });

  test('Tracer and Strategist reports on all 10 disruptions', { timeout: 900_000 }, async () => {
    const normal = simulate({}).metrics;
    const rows = [];
    for (const s of SCENARIOS) {
      const d = toDisruption(s);
      const p = plan(s, d, { futures: 6 });
      const t1 = tracerTools(s, simulate({ disruption: d, record: true }), normal);
      const t2 = strategistTools(p, costOfWaiting(d, p.recommended.levers));
      const a = await ask('tracer', t1, null);
      await sleep(1500);
      const b = await ask('strategist', t2, null);
      await sleep(1500);
      const o1 = OUTPUT.tracer.safeParse(fitLists('tracer', parse(a.text)));
      const o2 = OUTPUT.strategist.safeParse(fitLists('strategist', parse(b.text)));
      const g1 = o1.success ? checkGrounding(o1.data, t1) : null;
      const g2 = o2.success ? checkGrounding(o2.data, t2) : null;
      rows.push({
        scenario: s.id,
        valid: o1.success && o2.success,
        grounded: !!g1?.ok && !!g2?.ok,
        unsupported: [...(g1?.unsupported ?? []), ...(g2?.unsupported ?? [])].join(' ') || '-',
        ms: Math.round((a.ms + b.ms) / 2),
      });
    }
    console.table(rows);
    const valid = rows.filter((r) => r.valid).length;
    const grounded = rows.filter((r) => r.grounded).length;
    console.log(`LIVE reports: valid ${valid}/${rows.length}, fully grounded ${grounded}/${rows.length}`);
    expect(valid).toBe(rows.length);
  });
});
