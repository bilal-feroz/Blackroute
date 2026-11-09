import { describe, expect, test } from 'vitest';
import { checkGrounding } from '../src/agents/grounding';
import { OUTPUT } from '../src/agents/prompts';
import { matchSignals, replayFeed } from '../src/agents/signals';
import {
  dispatcherOffline,
  dispatcherTools,
  redteamOffline,
  redteamTools,
  sentinelOffline,
  strategistOffline,
  strategistTools,
  tracerOffline,
  tracerTools,
} from '../src/agents/tools';
import { simulate } from '../src/core/engine';
import { costOfWaiting, plan } from '../src/core/planner';
import { redTeam } from '../src/core/redteam';
import { SCENARIO_BY_ID, toDisruption } from '../src/core/scenarios';

describe('grounding check', () => {
  test('passes numbers that come from the tools', () => {
    const g = checkGrounding({ s: 'On time 87.4% and AED 1.05M extra, 640 pallets late' }, { onTimePct: 87.4, cost: 1048000, late: 640 });
    expect(g.ok).toBe(true);
  });
  test('accepts a rounded amount like "AED 15k" for 14,600', () => {
    expect(checkGrounding({ s: 'AED 15k extra cost' }, { extraCostAed: 14600 }).ok).toBe(true);
    expect(checkGrounding({ s: 'AED 1.05M' }, { cost: 1046000 }).ok).toBe(true);
    expect(checkGrounding({ s: 'AED 17k extra cost' }, { extraCostAed: 14600 }).ok).toBe(false);
  });
  test('flags numbers the model made up', () => {
    const g = checkGrounding({ s: 'This saves AED 2.4M and 912 pallets' }, { cost: 1048000, late: 640 });
    expect(g.ok).toBe(false);
    expect(g.unsupported.length).toBe(2);
  });
});

describe('Sentinel', () => {
  test('replay signals for Hormuz point to the Hormuz scenario', () => {
    const feed = replayFeed('hormuz_closure');
    const m = matchSignals(feed.signals);
    expect(m[0].scenarioId).toBe('hormuz_closure');
    const out = sentinelOffline(feed.signals, m);
    expect(OUTPUT.sentinel.safeParse(out).success).toBe(true);
    expect(out.scenarioId).toBe('hormuz_closure');
  });
});

describe('rule-based agent reports are valid and grounded', () => {
  const s = SCENARIO_BY_ID.hormuz_closure;
  const d = toDisruption(s);
  const run = simulate({ disruption: d, record: true });
  const normal = simulate({}).metrics;
  const p = plan(s, d, { futures: 4 });
  const waiting = costOfWaiting(d, p.recommended.levers);

  test('Tracer', () => {
    const t = tracerTools(s, run, normal);
    const out = tracerOffline(t);
    expect(OUTPUT.tracer.safeParse(out).success).toBe(true);
    expect(checkGrounding(out, t).unsupported).toEqual([]);
  });
  test('Strategist', () => {
    const t = strategistTools(p, waiting);
    const out = strategistOffline(t);
    expect(OUTPUT.strategist.safeParse(out).success).toBe(true);
    expect(checkGrounding(out, t).unsupported).toEqual([]);
  });
  test('Red Team', () => {
    const t = redteamTools(redTeam(s, d, p.recommended.levers), p.recommended);
    const out = redteamOffline(t);
    expect(OUTPUT.redteam.safeParse(out).success).toBe(true);
    expect(checkGrounding(out, t).unsupported).toEqual([]);
  });
  test('Dispatcher', () => {
    const t = dispatcherTools(s, p.recommended, 'Operations manager', '');
    const out = dispatcherOffline(t);
    expect(OUTPUT.dispatcher.safeParse(out).success).toBe(true);
    expect(out.messages.length).toBeGreaterThan(0);
  });
});
