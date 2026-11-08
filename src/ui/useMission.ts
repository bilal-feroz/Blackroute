// The BlackRoute mission: Watch -> Investigate -> Plan -> Decide -> Recover.
// AI investigates and recommends, the simulator verifies, a human decides.

import { useCallback, useEffect, useRef, useState } from 'react';
import { askAgent, aiStatus, type AgentReport, type AiStatus } from '../agents/run';
import { liveFeed, matchSignals, replayFeed, type SignalFeed } from '../agents/signals';
import {
  dispatcherOffline,
  dispatcherTools,
  leverNames,
  redteamOffline,
  redteamTools,
  sentinelOffline,
  sentinelSignals,
  sentinelTools,
  strategistOffline,
  strategistTools,
  tracerOffline,
  tracerTools,
} from '../agents/tools';
import type { AgentId } from '../agents/prompts';
import { simulate } from '../core/engine';
import { aed, pct } from '../core/format';
import { runPlanner } from '../core/planClient';
import { costOfWaiting, type Candidate, type PlanProgress, type PlanResult, type WaitingCost } from '../core/planner';
import { scanRadar, type RadarItem } from '../core/radar';
import { redTeam, type RedTeamReport } from '../core/redteam';
import { SCENARIO_BY_ID, toDisruption, type Scenario } from '../core/scenarios';
import type { Disruption, SimRun } from '../core/types';

export type Stage = 'watch' | 'investigate' | 'plan' | 'decide' | 'recover';
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'watch', label: 'Watch' },
  { id: 'investigate', label: 'Investigate' },
  { id: 'plan', label: 'Plan' },
  { id: 'decide', label: 'Decide' },
  { id: 'recover', label: 'Recover' },
];

export interface LogEntry {
  id: number;
  agent: AgentId | 'human' | 'system';
  kind: 'start' | 'tool' | 'output' | 'handoff' | 'note' | 'warn';
  text: string;
  detail?: string;
  at: number;
}

export interface Decision {
  status: 'approved' | 'rejected';
  by: string;
  note: string;
  at: number;
}

export interface Mission {
  stage: Stage;
  ai: AiStatus | null;
  useAi: boolean;
  feed: SignalFeed | null;
  feedMode: 'live' | 'replay';
  feedError: string | null;
  radar: RadarItem[];
  baseRun: SimRun;
  sentinel: AgentReport<'sentinel'> | null;
  scenario: Scenario | null;
  disruption: Disruption | null;
  doNothing: SimRun | null;
  tracer: AgentReport<'tracer'> | null;
  plan: PlanResult | null;
  progress: PlanProgress | null;
  waiting: WaitingCost[] | null;
  strategist: AgentReport<'strategist'> | null;
  chosen: Candidate | null;
  stress: RedTeamReport | null;
  redteam: AgentReport<'redteam'> | null;
  decision: Decision | null;
  recovery: SimRun | null;
  dispatcher: AgentReport<'dispatcher'> | null;
  log: LogEntry[];
  busy: string | null;
}

let logId = 1;

function initial(): Mission {
  return {
    stage: 'watch',
    ai: null,
    useAi: true,
    feed: null,
    feedMode: 'live',
    feedError: null,
    radar: scanRadar(),
    baseRun: simulate({ record: true }),
    sentinel: null,
    scenario: null,
    disruption: null,
    doNothing: null,
    tracer: null,
    plan: null,
    progress: null,
    waiting: null,
    strategist: null,
    chosen: null,
    stress: null,
    redteam: null,
    decision: null,
    recovery: null,
    dispatcher: null,
    log: [],
    busy: null,
  };
}

export function useMission(onRestart?: (hour: number) => void) {
  const [m, setM] = useState<Mission>(initial);
  const ref = useRef(m);
  ref.current = m;

  const patch = useCallback((p: Partial<Mission>) => setM((prev) => ({ ...prev, ...p })), []);
  const log = useCallback((agent: LogEntry['agent'], kind: LogEntry['kind'], text: string, detail?: string) => {
    setM((prev) => ({ ...prev, log: [...prev.log.slice(-120), { id: logId++, agent, kind, text, detail, at: Date.now() }] }));
  }, []);
  const reportLog = useCallback(
    (r: AgentReport) => {
      const src = r.source === 'ai' ? `answered by ${r.model}` : 'rule-based report';
      log(r.agent, 'output', `${src} in ${(r.ms / 1000).toFixed(1)} s`, r.grounding.ok ? `Grounding: all ${r.grounding.checked} numbers traced to the simulator` : `Grounding: ${r.grounding.unsupported.length} number(s) not found in the tool results (${r.grounding.unsupported.join(', ')})`);
      if (r.note) log(r.agent, 'warn', r.note);
    },
    [log],
  );

  // ---------------------------------------------------------------- feed
  const loadFeed = useCallback(
    async (mode: 'live' | 'replay', replayId = 'hormuz_closure') => {
      patch({ feedMode: mode, busy: 'Reading signals', feedError: null });
      if (mode === 'replay') {
        patch({ feed: replayFeed(replayId), busy: null });
        log('system', 'note', `Replay mode: simulated signals for "${SCENARIO_BY_ID[replayId].title}"`);
        return;
      }
      try {
        const feed = await liveFeed();
        patch({ feed, busy: null, feedError: feed.signals.length ? null : 'No live signals right now.' });
        log('system', 'note', `Live feed: ${feed.signals.length} signals${feed.weather ? `, Dubai gusts up to ${feed.weather.maxGustKmh} km/h` : ''}`);
      } catch {
        patch({ busy: null, feedError: 'Live sources are not reachable. Try replay mode.' });
      }
    },
    [log, patch],
  );

  useEffect(() => {
    aiStatus().then((ai) => patch({ ai }));
    loadFeed('live');
    log('system', 'note', 'Black Route Radar scanned 10 ways the network can break');
  }, [loadFeed, log, patch]);

  // ---------------------------------------------------------------- Sentinel
  const runSentinel = useCallback(async () => {
    const feed = ref.current.feed;
    if (!feed) return;
    patch({ busy: 'Sentinel is reading signals' });
    log('sentinel', 'start', `Reading ${feed.signals.length} signals`);
    const matches = matchSignals(feed.signals);
    log('sentinel', 'tool', 'match_signals()', matches.length ? `Top match: ${SCENARIO_BY_ID[matches[0].scenarioId].title} (score ${matches[0].score})` : 'No keyword matches');
    const tools = sentinelTools(matches);
    const signals = sentinelSignals(feed.signals);
    const rep = await askAgent('sentinel', tools, signals, () => sentinelOffline(feed.signals, matches), ref.current.useAi && !!ref.current.ai);
    reportLog(rep);
    const sc = SCENARIO_BY_ID[rep.out.scenarioId] ?? null;
    const radar = sc ? scanRadar({ [sc.id]: rep.out.likelihood }) : ref.current.radar;
    patch({ sentinel: rep, scenario: sc, radar, busy: null });
    if (sc) log('sentinel', 'handoff', `Raised ${sc.title} to ${pct(rep.out.likelihood, 0)} likelihood and handed it to Tracer`);
  }, [log, patch, reportLog]);

  // ---------------------------------------------------------------- Tracer
  const investigate = useCallback(
    async (scenario: Scenario, daysLong?: number, drill = false) => {
      const d = toDisruption(scenario, daysLong ?? scenario.defaultDays);
      if (drill) log('human', 'note', `Operator started a drill: ${scenario.title} for ${Math.round(d.durationHours / 24)} days`);
      patch({ busy: 'Tracer is simulating the impact', scenario, disruption: d, stage: 'investigate', plan: null, strategist: null, chosen: null, stress: null, redteam: null, decision: null, recovery: null, dispatcher: null, tracer: null });
      log('tracer', 'start', `Tracing ${scenario.title}`);
      await new Promise((r) => setTimeout(r, 30));
      const run = simulate({ disruption: d, record: true });
      const normal = ref.current.baseRun.metrics;
      log('tracer', 'tool', 'simulate(do nothing, 3 weeks)', `${pct(run.metrics.serviceLevel)} on time, ${Math.round(run.metrics.latePallets)} pallets late, ${aed(run.metrics.costAed - normal.costAed)} extra`);
      const tools = tracerTools(scenario, run, normal);
      const rep = await askAgent('tracer', tools, null, () => tracerOffline(tools), ref.current.useAi && !!ref.current.ai);
      reportLog(rep);
      patch({ doNothing: run, tracer: rep, busy: null });
      onRestart?.(Math.max(0, d.startHour - 4));
      log('tracer', 'handoff', 'Handed the impact to Strategist');
    },
    [log, onRestart, patch, reportLog],
  );

  // ---------------------------------------------------------------- Strategist
  const findPlans = useCallback(async () => {
    const { scenario, disruption } = ref.current;
    if (!scenario || !disruption) return;
    patch({ stage: 'plan', busy: 'Strategist is testing plans', progress: { done: 0, total: 1, label: 'Starting' } });
    log('strategist', 'start', `Testing ${scenario.levers.length} recovery levers and their combinations`);
    const result = await runPlanner(scenario.id, disruption, 20, (p) => patch({ progress: p }));
    log('strategist', 'tool', `plan(Monte Carlo, ${result.recommended.summary.futures} futures each)`, `${result.runs} simulations in ${(result.ms / 1000).toFixed(1)} s. Best: ${leverNames(result.recommended.levers)}`);
    const waiting = costOfWaiting(disruption, result.recommended.levers);
    log('strategist', 'tool', 'cost_of_waiting(now, +1 day, +3 days)', waiting.map((w) => aed(w.metrics.costAed)).join(' / '));
    const tools = strategistTools(result, waiting);
    const rep = await askAgent('strategist', tools, null, () => strategistOffline(tools), ref.current.useAi && !!ref.current.ai);
    reportLog(rep);
    patch({ plan: result, waiting, strategist: rep, chosen: result.recommended, progress: null, busy: null });
    log('strategist', 'handoff', 'Sent the recommended plan to Red Team');
  }, [log, patch, reportLog]);

  const choose = useCallback((c: Candidate) => patch({ chosen: c, stress: null, redteam: null }), [patch]);

  // ---------------------------------------------------------------- Red Team
  const stressTest = useCallback(async () => {
    const { scenario, disruption, chosen } = ref.current;
    if (!scenario || !disruption || !chosen) return;
    patch({ stage: 'decide', busy: 'Red Team is trying to break the plan' });
    log('redteam', 'start', `Stress-testing: ${leverNames(chosen.levers)}`);
    await new Promise((r) => setTimeout(r, 30));
    const report = redTeam(scenario, disruption, chosen.levers);
    log('redteam', 'tool', 'stress_test(5 scenarios)', `Passed ${report.survived} of ${report.tests.length}. Weakest: ${report.weakest.title} (${pct(report.weakest.metrics.serviceLevel)} on time)`);
    const tools = redteamTools(report, chosen);
    const rep = await askAgent('redteam', tools, null, () => redteamOffline(tools), ref.current.useAi && !!ref.current.ai);
    reportLog(rep);
    patch({ stress: report, redteam: rep, busy: null });
    log('redteam', 'handoff', 'Plan, evidence and risks are ready for a human decision');
  }, [log, patch, reportLog]);

  // ---------------------------------------------------------------- Human + Dispatcher
  const decide = useCallback(
    async (status: Decision['status'], by: string, note: string) => {
      const { scenario, disruption, chosen } = ref.current;
      if (!scenario || !disruption || !chosen) return;
      const decision: Decision = { status, by: by || 'Operations manager', note, at: Date.now() };
      log('human', 'note', `${decision.by} ${status} the plan${note ? `: "${note}"` : ''}`);
      if (status === 'rejected') {
        patch({ decision, stage: 'plan', stress: null, redteam: null });
        return;
      }
      patch({ decision, busy: 'Dispatcher is drafting the actions' });
      const recovery = simulate({ disruption, levers: chosen.levers, record: true });
      log('system', 'tool', 'simulate(approved plan)', `${pct(recovery.metrics.serviceLevel)} on time vs ${pct(ref.current.doNothing?.metrics.serviceLevel ?? 0)} doing nothing`);
      log('dispatcher', 'start', 'Drafting the action pack');
      const tools = dispatcherTools(scenario, chosen, decision.by, note);
      const rep = await askAgent('dispatcher', tools, null, () => dispatcherOffline(tools), ref.current.useAi && !!ref.current.ai);
      reportLog(rep);
      patch({ recovery, dispatcher: rep, stage: 'recover', busy: null });
      onRestart?.(Math.max(0, disruption.startHour - 4));
      log('dispatcher', 'handoff', `${rep.out.messages.length} drafts ready for a human to review and send`);
    },
    [log, onRestart, patch, reportLog],
  );

  const goto = useCallback((stage: Stage) => patch({ stage }), [patch]);
  const reset = useCallback(() => {
    setM((prev) => ({ ...initial(), ai: prev.ai, useAi: prev.useAi, feed: prev.feed, feedMode: prev.feedMode, log: prev.log }));
    log('system', 'note', 'Back to watching the network');
    onRestart?.(0);
  }, [log, onRestart]);
  const setUseAi = useCallback((v: boolean) => patch({ useAi: v }), [patch]);

  return { m, loadFeed, runSentinel, investigate, findPlans, choose, stressTest, decide, goto, reset, setUseAi };
}

/** Which run the 3D view should play for the current stage. */
export function activeRun(m: Mission, compare: 'plan' | 'nothing'): SimRun {
  if (m.stage === 'recover' && m.recovery) return compare === 'nothing' && m.doNothing ? m.doNothing : m.recovery;
  if ((m.stage === 'investigate' || m.stage === 'plan' || m.stage === 'decide') && m.doNothing) return m.doNothing;
  return m.baseRun;
}
