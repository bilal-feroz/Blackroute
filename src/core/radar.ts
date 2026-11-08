// Black Route Radar: before anything happens, break every link in the
// network on purpose (in the simulator) and rank the ones that would hurt most.
// Risk = how likely it is (base rate, raised by live signals) x what it would cost.

import { simulate } from './engine';
import { CHOKEPOINT_BY_ID, DC_BY_ID, ORIGIN_BY_ID, PORT_BY_ID, ROAD_BY_ID } from './network';
import { SCENARIOS, toDisruption, type Scenario } from './scenarios';
import type { Metrics } from './types';

export interface RadarItem {
  scenario: Scenario;
  /** name of the link that breaks */
  link: string;
  likelihood: number;
  /** extra cost vs a normal three weeks, incl. late-delivery penalties, AED */
  impactAed: number;
  /** expected loss = likelihood x impact, AED */
  riskAed: number;
  /** 0-100 for the gauges */
  impactScore: number;
  riskScore: number;
  metrics: Metrics;
  boosted: boolean;
}

export function baseLikelihood(s: Scenario): number {
  switch (s.kind) {
    case 'chokepoint':
      return CHOKEPOINT_BY_ID[s.target]?.baseLikelihood ?? 0.05;
    case 'port_congestion':
      return PORT_BY_ID[s.target]?.baseLikelihood ?? 0.1;
    case 'port_closure':
      return 0.03;
    case 'dc_outage':
      return DC_BY_ID[s.target]?.baseLikelihood ?? 0.04;
    case 'road_closure':
      return ROAD_BY_ID[s.target]?.baseLikelihood ?? 0.05;
    case 'weather':
      return 0.18;
    case 'supplier':
      return 0.04;
  }
}

export function linkName(s: Scenario): string {
  switch (s.kind) {
    case 'chokepoint':
      return CHOKEPOINT_BY_ID[s.target]?.name ?? s.target;
    case 'port_congestion':
    case 'port_closure':
      return PORT_BY_ID[s.target]?.name ?? s.target;
    case 'dc_outage':
      return DC_BY_ID[s.target]?.name ?? s.target;
    case 'road_closure':
      return ROAD_BY_ID[s.target]?.name ?? s.target;
    case 'weather':
      return 'Dubai roads and cranes';
    case 'supplier':
      return `${ORIGIN_BY_ID[s.target]?.name ?? s.target} lane`;
  }
}

/**
 * @param likelihoodOverride scenario id -> likelihood from live signals
 */
export function scanRadar(likelihoodOverride: Record<string, number> = {}): RadarItem[] {
  const base = simulate({}).metrics.costAed;
  const raw = SCENARIOS.map((scenario) => {
    const metrics = simulate({ disruption: toDisruption(scenario) }).metrics;
    const impactAed = Math.max(0, metrics.costAed - base);
    const boosted = likelihoodOverride[scenario.id] !== undefined;
    const likelihood = boosted ? likelihoodOverride[scenario.id] : baseLikelihood(scenario);
    return { scenario, link: linkName(scenario), likelihood, impactAed, riskAed: likelihood * impactAed, metrics, boosted };
  });
  const maxImpact = Math.max(1, ...raw.map((r) => r.impactAed));
  const maxRisk = Math.max(1, ...raw.map((r) => r.riskAed));
  return raw
    .map((r) => ({
      ...r,
      impactScore: Math.round((100 * r.impactAed) / maxImpact),
      riskScore: Math.round((100 * r.riskAed) / maxRisk),
    }))
    .sort((a, b) => b.riskAed - a.riskAed);
}
