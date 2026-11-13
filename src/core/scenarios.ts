// The disruptions BlackRoute knows how to model. The Sentinel agent maps live
// signals onto these, and an operator can also trigger them by hand.
import type { Disruption, DisruptionKind, LeverId } from './types.js';

export interface Scenario {
  id: string;
  title: string;
  kind: DisruptionKind;
  target: string;
  defaultDays: number;
  /** one line, plain English */
  summary: string;
  /** words that suggest this scenario in a news headline */
  keywords: string[];
  levers: LeverId[];
  /** where it shows up in the views */
  place: 'global' | 'local';
}

export const DETECTION_HOUR = 24;

export const SCENARIOS: Scenario[] = [
  {
    id: 'hormuz_closure',
    title: 'Strait of Hormuz closed',
    kind: 'chokepoint',
    target: 'hormuz',
    defaultDays: 6,
    summary: 'No ships can pass the strait, so nothing reaches Jebel Ali.',
    keywords: ['hormuz', 'strait of hormuz', 'gulf shipping', 'tanker seized', 'iran navy'],
    levers: ['divert_fujairah', 'regional_buy', 'air_freight', 'rebalance', 'priority', 'extra_trucks'],
    place: 'global',
  },
  {
    id: 'red_sea',
    title: 'Red Sea attacks at Bab el-Mandeb',
    kind: 'chokepoint',
    target: 'bab_el_mandeb',
    defaultDays: 14,
    summary: 'Ships from Europe stop at the Red Sea gate and wait or sail around Africa.',
    keywords: ['red sea', 'bab el-mandeb', 'houthi', 'gulf of aden', 'shipping attack'],
    levers: ['long_route', 'regional_buy', 'air_freight', 'rebalance', 'priority'],
    place: 'global',
  },
  {
    id: 'suez_blockage',
    title: 'Suez Canal blocked',
    kind: 'chokepoint',
    target: 'suez',
    defaultDays: 6,
    summary: 'A grounded ship blocks the canal and the Europe lane queues up.',
    keywords: ['suez', 'suez canal', 'canal blocked', 'grounded vessel'],
    levers: ['long_route', 'regional_buy', 'air_freight', 'rebalance', 'priority'],
    place: 'global',
  },
  {
    id: 'malacca_closure',
    title: 'Strait of Malacca disrupted',
    kind: 'chokepoint',
    target: 'malacca',
    defaultDays: 5,
    summary: 'Ships from East Asia are held at the strait.',
    keywords: ['malacca', 'strait of malacca', 'singapore strait', 'piracy'],
    levers: ['long_route', 'regional_buy', 'air_freight', 'rebalance', 'priority'],
    place: 'global',
  },
  {
    id: 'mundra_strike',
    title: 'Port strike in Mundra',
    kind: 'supplier',
    target: 'mundra',
    defaultDays: 10,
    summary: 'Ships cannot leave Mundra, so the India lane stops.',
    keywords: ['mundra', 'india port strike', 'gujarat port', 'dockworkers strike'],
    levers: ['regional_buy', 'air_freight', 'rebalance', 'priority'],
    place: 'global',
  },
  {
    id: 'jebel_ali_congestion',
    title: 'Jebel Ali port congestion',
    kind: 'port_congestion',
    target: 'jebel_ali',
    defaultDays: 5,
    summary: 'Ships wait days at anchor for a berth and the cranes work slowly.',
    keywords: ['jebel ali', 'port congestion', 'dubai port', 'dp world', 'berth delay'],
    levers: ['divert_fujairah', 'extra_trucks', 'rebalance', 'priority', 'air_freight'],
    place: 'local',
  },
  {
    id: 'jebel_ali_shutdown',
    title: 'Jebel Ali terminal shutdown',
    kind: 'port_closure',
    target: 'jebel_ali',
    defaultDays: 4,
    summary: 'A systems outage stops the terminal: no ships unload and no trucks leave.',
    keywords: ['jebel ali outage', 'port cyber attack', 'cyber attack', 'terminal shutdown', 'port system outage'],
    levers: ['divert_fujairah', 'air_freight', 'rebalance', 'priority'],
    place: 'local',
  },
  {
    id: 'sandstorm',
    title: 'Severe sandstorm over Dubai',
    kind: 'weather',
    target: 'uae',
    defaultDays: 3,
    summary: 'Low visibility keeps trucks off the roads at night and slows the cranes.',
    keywords: ['sandstorm', 'dust storm', 'low visibility', 'shamal', 'weather warning'],
    levers: ['extra_trucks', 'rebalance', 'priority'],
    place: 'local',
  },
  {
    id: 'e311_closure',
    title: 'E311 highway closed',
    kind: 'road_closure',
    target: 'e311',
    defaultDays: 4,
    summary: 'Trucks to Sharjah take a long detour.',
    keywords: ['e311', 'mohammed bin zayed road', 'highway closure', 'road closed sharjah'],
    levers: ['extra_trucks', 'rebalance', 'priority'],
    place: 'local',
  },
  {
    id: 'al_quoz_outage',
    title: 'Al Quoz DC power failure',
    kind: 'dc_outage',
    target: 'al_quoz',
    defaultDays: 3,
    summary: 'The warehouse cannot ship, so Dubai stores stop getting stock.',
    keywords: ['al quoz', 'warehouse fire', 'power outage dubai', 'warehouse outage'],
    levers: ['rebalance', 'extra_trucks', 'priority'],
    place: 'local',
  },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s])) as Record<string, Scenario>;

export function toDisruption(s: Scenario, days = s.defaultDays, startHour = DETECTION_HOUR): Disruption {
  return { kind: s.kind, target: s.target, startHour, durationHours: Math.round(days * 24) };
}
