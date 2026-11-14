import { expect, test } from 'vitest';
import { simulate } from '../src/core/engine';
import { plan } from '../src/core/planner';
import { SCENARIO_BY_ID, toDisruption } from '../src/core/scenarios';
import { dispatcherOffline, dispatcherTools } from '../src/agents/tools';
import { checkGrounding } from '../src/agents/grounding';
import { actionPackJson, actionPackMarkdown } from '../src/ui/actionPack';
import type { Mission } from '../src/ui/useMission';

test('action pack holds the decision, the numbers, the drafts and the audit trail', () => {
  const s = SCENARIO_BY_ID.hormuz_closure;
  const d = toDisruption(s);
  const p = plan(s, d, { futures: 4 });
  const t = dispatcherTools(s, p.recommended, 'Ops manager', '');
  const out = dispatcherOffline(t);
  const report = { agent: 'dispatcher' as const, out, source: 'rules' as const, grounding: checkGrounding(out, t), ms: 1 };
  const m = {
    scenario: s,
    chosen: p.recommended,
    doNothing: simulate({ disruption: d }),
    recovery: simulate({ disruption: d, levers: p.recommended.levers }),
    decision: { status: 'approved', by: 'Ops manager', note: '', at: Date.UTC(2026, 10, 14, 9) },
    dispatcher: report,
    sentinel: null,
    tracer: null,
    strategist: null,
    redteam: null,
  } as unknown as Mission;
  const md = actionPackMarkdown(m);
  expect(md).toContain('# BlackRoute action pack: Strait of Hormuz closed');
  expect(md).toContain('Approved by **Ops manager**');
  expect(md).toContain('| Orders on time |');
  expect(md).toContain('## Checklist');
  expect(md).toContain('Dispatcher: rule-based report');
  expect(md).toContain('Nothing in this pack has been sent.');
  const json = actionPackJson(m);
  expect(json.plan.levers).toEqual(p.recommended.levers);
  expect(json.reports.dispatcher?.out.messages.length).toBeGreaterThan(0);
});
