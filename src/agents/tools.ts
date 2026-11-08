// The tool results each agent sees (compact, rounded numbers straight from the
// simulator) and the rule-based reports used when no AI model is available.

import { CUSTOMERS, DC_BY_ID, LEVER_BY_ID, ORIGIN_BY_ID, CHOKEPOINT_BY_ID, COMPANY } from '../core/network';
import type { PlanResult, Candidate, WaitingCost } from '../core/planner';
import type { RedTeamReport } from '../core/redteam';
import { SCENARIOS, SCENARIO_BY_ID, type Scenario } from '../core/scenarios';
import type { Metrics, SimRun } from '../core/types';
import { aed, dayTime, days, pct } from '../core/format';
import type { AgentOutput } from './prompts';
import type { Match, Signal } from './signals';

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function metricsBrief(m: Metrics) {
  return {
    onTimePct: r1(m.serviceLevel * 100),
    latePallets: r0(m.latePallets),
    latePalletDays: r0(m.latePalletDays),
    keyAccountLatePallets: r0(m.priorityLatePallets),
    recoveryDays: m.recoveryHours === null ? 'not within 3 weeks' : r1(m.recoveryHours / 24),
    totalCostAed: r0(m.costAed),
    co2Tonnes: r1(m.co2Kg / 1000),
  };
}

export function leverNames(levers: string[]): string {
  return levers.length ? levers.map((l) => LEVER_BY_ID[l as keyof typeof LEVER_BY_ID].name).join(' + ') : 'Monitor and hold (no levers)';
}

// ---------------------------------------------------------------- Sentinel
export function sentinelTools(matches: Match[]) {
  return {
    knownScenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title, summary: s.summary })),
    keywordMatches: matches.slice(0, 5).map((m) => ({ scenarioId: m.scenarioId, score: m.score, signalIds: m.signalIds })),
  };
}

export function sentinelSignals(signals: Signal[]) {
  return signals.slice(0, 18).map((s) => ({ id: s.id, title: s.title, source: s.source, published: s.publishedAt.slice(0, 10) }));
}

export function sentinelOffline(signals: Signal[], matches: Match[]): AgentOutput['sentinel'] {
  const top = matches[0];
  if (!top) {
    return {
      scenarioId: 'none',
      confidence: 0.8,
      likelihood: 0.05,
      headline: 'No threat to the network in current signals',
      summary: `Read ${signals.length} signals. None of them point at a lane, port or road this network depends on.`,
      evidence: [],
    };
  }
  const s = SCENARIO_BY_ID[top.scenarioId];
  const strength = Math.min(1, top.score / 6);
  return {
    scenarioId: s.id,
    // keyword counting can say a threat is in the news, not how likely it is to hit us
    confidence: r3(0.4 + strength * 0.4),
    likelihood: r3(Math.min(0.6, 0.15 + strength * 0.4)),
    headline: `Signals point to: ${s.title}`,
    summary: `${top.signalIds.length} of ${signals.length} signals mention this. ${s.summary}`,
    evidence: top.signalIds.slice(0, 4).map((id) => ({ signalId: id, why: 'mentions the same place and type of disruption' })),
  };
}

// ---------------------------------------------------------------- Tracer
export function tracerTools(scenario: Scenario, run: SimRun, normal: Metrics) {
  const d = run.options.disruption!;
  const held = run.vessels.filter((v) => v.heldAt).map((v) => ({
    ship: v.name,
    from: ORIGIN_BY_ID[v.origin]?.name ?? v.origin,
    heldAt: CHOKEPOINT_BY_ID[v.heldAt!]?.name ?? ORIGIN_BY_ID[v.heldAt!]?.name ?? v.heldAt,
    delayDays: r1((v.eta - v.plannedEta) / 24),
  }));
  const shortages = run.events.filter((e) => e.tone === 'bad').slice(0, 8).map((e) => ({ when: dayTime(e.hour), what: e.text }));
  const customers = CUSTOMERS.map((c) => {
    const b = run.backlogSeries[c.id];
    let peak = 0;
    if (b) for (const x of b) peak = Math.max(peak, x);
    return { customer: c.name, keyAccount: c.priority, peakPalletsWaiting: r0(peak) };
  }).filter((c) => c.peakPalletsWaiting > 0);
  return {
    disruption: { title: scenario.title, startsAt: dayTime(d.startHour), lastsDays: r1(d.durationHours / 24) },
    doNothing: metricsBrief(run.metrics),
    normalThreeWeeks: { totalCostAed: r0(normal.costAed) },
    extraCostAed: r0(run.metrics.costAed - normal.costAed),
    shipsHeld: held.slice(0, 6),
    shortages,
    customersHit: customers,
  };
}

export function tracerOffline(t: ReturnType<typeof tracerTools>): AgentOutput['tracer'] {
  const first = t.shortages[0];
  return {
    headline: `Doing nothing: ${t.doNothing.onTimePct}% of orders on time, ${aed(t.extraCostAed)} extra cost`,
    summary: `${t.disruption.title} from ${t.disruption.startsAt} for ${t.disruption.lastsDays} days. ${t.shipsHeld.length ? `${t.shipsHeld.length} ship${t.shipsHeld.length === 1 ? '' : 's'} held, ` : ''}${t.doNothing.latePallets} pallets reach customers late.`,
    affected: [
      ...t.shipsHeld.slice(0, 3).map((s) => ({ place: s.ship, impact: `held at ${s.heldAt} for ${s.delayDays} days` })),
      ...t.customersHit.slice(0, 4).map((c) => ({ place: c.customer, impact: `up to ${c.peakPalletsWaiting} pallets waiting${c.keyAccount ? ' (key account)' : ''}` })),
    ],
    firstShortage: first ? `${first.when}: ${first.what}` : 'No stock-out in the next three weeks',
  };
}

// ---------------------------------------------------------------- Strategist
function candidateBrief(c: Candidate) {
  return {
    plan: leverNames(c.levers),
    levers: c.levers,
    onTimePct: r1(c.summary.service * 100),
    worstCaseOnTimePct: r1(c.summary.serviceP10 * 100),
    futuresHeld: `${c.summary.held} of ${c.summary.futures}`,
    lateDays: r0(c.summary.latePalletDays),
    recoveryDays: c.summary.recoveryHours === null ? 'not within 3 weeks' : r1(c.summary.recoveryHours / 24),
    responseSpendAed: r0(c.summary.spend),
    totalCostAed: r0(c.summary.totalCost),
    co2Tonnes: r1(c.summary.co2 / 1000),
  };
}

export function strategistTools(p: PlanResult, waiting: WaitingCost[]) {
  const runnerUp = p.candidates.find((c) => c !== p.recommended);
  return {
    futuresPerPlan: p.recommended.summary.futures,
    simulationsRun: p.runs,
    doNothing: candidateBrief(p.doNothing),
    recommended: candidateBrief(p.recommended),
    savingVsDoNothingAed: r0(p.doNothing.summary.totalCost - p.recommended.summary.totalCost),
    runnerUp: runnerUp ? candidateBrief(runnerUp) : null,
    bestPerGoal: p.options.map((o) => ({ goals: o.goals, ...candidateBrief(o.candidate) })),
    costOfWaiting: waiting.map((w) => ({ actAfterHours: w.delayHours, totalCostAed: r0(w.metrics.costAed), onTimePct: r1(w.metrics.serviceLevel * 100) })),
  };
}

export function strategistOffline(t: ReturnType<typeof strategistTools>): AgentOutput['strategist'] {
  const rec = t.recommended;
  const none = t.doNothing;
  const saved = t.savingVsDoNothingAed;
  const w = t.costOfWaiting;
  const why = [
    `Keeps ${rec.onTimePct}% of orders on time (doing nothing: ${none.onTimePct}%).`,
    `Holds up in ${rec.futuresHeld} simulated futures.`,
  ];
  if (saved > 0) why.push(`Costs ${aed(saved)} less than doing nothing once late-delivery penalties are counted.`);
  const tradeoffs = [`Response spend ${aed(rec.responseSpendAed)}.`, `${rec.co2Tonnes} t CO₂ over three weeks.`];
  if (w.length > 2 && w[2].totalCostAed > w[0].totalCostAed) tradeoffs.push(`Waiting ${Math.round(w[2].actAfterHours / 24)} days before acting raises the total to ${aed(w[2].totalCostAed)}.`);
  return {
    headline: rec.levers.length ? `Recommend: ${rec.plan}` : 'Recommend: monitor and hold',
    recommendation: rec.levers.length
      ? `${rec.plan}. ${rec.onTimePct}% on time, ${aed(rec.totalCostAed)} all-in over three weeks.`
      : `No lever beats doing nothing here. Keep watching; ${rec.onTimePct}% of orders stay on time.`,
    why,
    tradeoffs,
    whyNotRunnerUp: t.runnerUp
      ? `${t.runnerUp.plan}: ${t.runnerUp.onTimePct}% on time for ${aed(t.runnerUp.totalCostAed)}, held in ${t.runnerUp.futuresHeld} futures.`
      : 'No other plan was close.',
  };
}

// ---------------------------------------------------------------- Red Team
export function redteamTools(report: RedTeamReport, chosen: Candidate) {
  return {
    plan: leverNames(chosen.levers),
    passMarkOnTimePct: 95,
    testsPassed: `${report.survived} of ${report.tests.length}`,
    verdictFromTests: report.verdict,
    tests: report.tests.map((t) => ({ test: t.title, what: t.what, onTimePct: r1(t.metrics.serviceLevel * 100), keyAccountLatePallets: r0(t.metrics.priorityLatePallets), totalCostAed: r0(t.metrics.costAed), held: t.held })),
  };
}

export function redteamOffline(t: ReturnType<typeof redteamTools>): AgentOutput['redteam'] {
  const failed = t.tests.filter((x) => !x.held);
  return {
    verdict: t.verdictFromTests as AgentOutput['redteam']['verdict'],
    summary: `${t.plan} passed ${t.testsPassed} stress tests (pass mark ${t.passMarkOnTimePct}% on time).`,
    concerns: failed.slice(0, 4).map((f) => ({
      title: f.test,
      detail: `${f.what} On-time delivery drops to ${f.onTimePct}%.`,
      severity: f.onTimePct < 90 ? 'high' : 'medium',
    })),
    safeguards: [
      ...(failed.some((f) => f.test.includes('late')) ? ['Pre-approve the plan so it can start the moment the alert fires.'] : []),
      ...(failed.some((f) => f.test.includes('Demand')) ? ['Cap order quantities for non-key customers while stock is short.'] : []),
      ...(failed.some((f) => f.test.includes('longer')) ? ['Book a second recovery lever now in case the disruption runs long.'] : []),
      'Review the plan again if the disruption changes.',
    ].slice(0, 4),
  };
}

// ---------------------------------------------------------------- Dispatcher
export function dispatcherTools(scenario: Scenario, chosen: Candidate, approvedBy: string, note: string) {
  return {
    company: COMPANY,
    disruption: scenario.title,
    approvedPlan: leverNames(chosen.levers),
    levers: chosen.levers.map((l) => ({ id: l, what: LEVER_BY_ID[l].description })),
    expected: { onTimePct: r1(chosen.summary.service * 100), totalCostAed: r0(chosen.summary.totalCost), responseSpendAed: r0(chosen.summary.spend) },
    keyAccounts: CUSTOMERS.filter((c) => c.priority).map((c) => c.name),
    dcs: Object.values(DC_BY_ID).map((d) => d.name),
    approvedBy,
    managerNote: note,
  };
}

export function dispatcherOffline(t: ReturnType<typeof dispatcherTools>): AgentOutput['dispatcher'] {
  const messages: AgentOutput['dispatcher']['messages'] = [];
  const has = (id: string) => t.levers.some((l) => l.id === id);
  if (has('divert_fujairah'))
    messages.push({ to: 'Shipping line and Fujairah port agent', channel: 'email', subject: 'Request: divert inbound calls to Fujairah', body: `Current disruption: ${t.disruption}. Please divert our inbound vessels from Jebel Ali to Fujairah until further notice. We will arrange trucking from Fujairah to our DCs. Please confirm new ETAs and port charges today.` });
  if (has('long_route'))
    messages.push({ to: 'Shipping line', channel: 'email', subject: 'Request: reroute affected sailings', body: `Please reroute our affected sailings via the longer route rather than holding them. Send revised ETAs and any surcharge for approval.` });
  if (has('regional_buy'))
    messages.push({ to: 'Regional suppliers (Saudi Arabia, Oman)', channel: 'email', subject: 'Urgent order: auto parts and consumer goods', body: `Current disruption: ${t.disruption}. While it lasts we need daily deliveries of auto parts and consumer goods to our three Dubai and Sharjah DCs. Please confirm volumes, price and first delivery date.` });
  if (has('air_freight'))
    messages.push({ to: 'Air cargo forwarder', channel: 'email', subject: 'Book daily air cargo into Al Maktoum (DWC)', body: `Please book daily air freight of electronics into Al Maktoum airport for delivery to Dubai South DC, starting as soon as possible. Send the schedule and rate.` });
  if (has('extra_trucks'))
    messages.push({ to: 'Trucking partner', channel: 'phone', subject: 'Add trucks for the next week', body: `We need about 60% more trucks for port and DC moves from today. Please confirm how many you can add and from when.` });
  if (has('rebalance'))
    messages.push({ to: 'DC managers', channel: 'whatsapp', subject: 'Stock transfers between DCs', body: `We are moving stock between DCs to cover the shortage. Please prepare outbound pallets and expect transfer trucks today.` });
  messages.push({ to: `Key accounts (${t.keyAccounts.join(', ')})`, channel: 'email', subject: 'Supply update', body: `Regional supply is disrupted (${t.disruption}). We have a recovery plan in place and expect to keep about ${t.expected.onTimePct}% of your deliveries on time. We will update you daily.` });
  return {
    brief: `${t.disruption}. Approved plan: ${t.approvedPlan}. Expected ${t.expected.onTimePct}% of orders on time at ${aed(t.expected.totalCostAed)} all-in over three weeks.${t.managerNote ? ` Note from ${t.approvedBy}: ${t.managerNote}` : ''}`,
    messages: messages.slice(0, 6),
    checklist: ['Send the drafts above after review', 'Confirm new ETAs with the shipping line', 'Brief the DC and transport teams', 'Re-run BlackRoute when the situation changes'],
  };
}

export { aed, pct, days };
