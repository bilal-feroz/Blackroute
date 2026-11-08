// The demo network: a fictional UAE distributor ("Falcon Distribution") that
// imports through real ports and real shipping chokepoints. Everything the
// simulator, the planner and both 3D views need lives here, so a different
// business is a data change, not a code change.
//
// Sailing times and positions are realistic approximations, not live data.
// Likelihoods are illustrative baselines that the Sentinel agent raises when
// it sees matching live signals.

import type { Chokepoint, Customer, Dc, Lever, LeverId, Origin, Port, Road, Sku, SkuId } from './types';

export const COMPANY = 'Falcon Distribution';
export const HORIZON_HOURS = 21 * 24;

export const SKUS: Sku[] = [
  { id: 'ELEC', name: 'Electronics', palletValue: 42000, latePerDay: 950, color: '#22d3ee' },
  { id: 'AUTO', name: 'Auto parts', palletValue: 18000, latePerDay: 520, color: '#a78bfa' },
  { id: 'FMCG', name: 'Consumer goods', palletValue: 6500, latePerDay: 260, color: '#34d399' },
];
export const SKU_IDS: SkuId[] = SKUS.map((s) => s.id);
export const SKU_BY_ID = Object.fromEntries(SKUS.map((s) => [s.id, s])) as Record<SkuId, Sku>;

export const CHOKEPOINTS: Chokepoint[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    geo: { lat: 26.57, lon: 56.25 },
    longRouteExtraDays: null,
    longRouteName: null,
    baseLikelihood: 0.06,
    blurb: 'Every ship to Jebel Ali and Khalifa passes here. Fujairah sits outside it.',
  },
  {
    id: 'bab_el_mandeb',
    name: 'Bab el-Mandeb',
    geo: { lat: 12.58, lon: 43.33 },
    longRouteExtraDays: 12,
    longRouteName: 'Cape of Good Hope',
    baseLikelihood: 0.3,
    blurb: 'Southern gate of the Red Sea on the Europe lane.',
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    geo: { lat: 30.42, lon: 32.35 },
    longRouteExtraDays: 12,
    longRouteName: 'Cape of Good Hope',
    baseLikelihood: 0.08,
    blurb: 'The short cut between Europe and the Gulf.',
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    geo: { lat: 2.5, lon: 101.2 },
    longRouteExtraDays: 2,
    longRouteName: 'Lombok Strait',
    baseLikelihood: 0.03,
    blurb: 'The main lane from East Asia into the Indian Ocean.',
  },
];
export const CHOKEPOINT_BY_ID = Object.fromEntries(CHOKEPOINTS.map((c) => [c.id, c])) as Record<string, Chokepoint>;

export const ORIGINS: Origin[] = [
  {
    id: 'shanghai',
    name: 'Shanghai',
    country: 'China',
    geo: { lat: 31.23, lon: 121.47 },
    transitHours: 18 * 24,
    route: [
      { chokepoint: 'malacca', hoursBeforeEta: 240 },
      { chokepoint: 'hormuz', hoursBeforeEta: 12 },
    ],
    cargo: { ELEC: 208, AUTO: 62, FMCG: 125 },
    firstEtaHour: 30,
    vessels: ['Jade Horizon', 'Eastern Lantern', 'Silk Meridian'],
    lane: [
      { lat: 31.2, lon: 121.9 },
      { lat: 24.5, lon: 120.0 },
      { lat: 12.0, lon: 112.5 },
      { lat: 1.6, lon: 104.6 },
      { lat: 2.5, lon: 101.2 },
      { lat: 5.8, lon: 95.0 },
      { lat: 5.6, lon: 80.5 },
      { lat: 13.0, lon: 66.0 },
      { lat: 22.5, lon: 60.5 },
      { lat: 25.4, lon: 57.4 },
      { lat: 26.57, lon: 56.25 },
      { lat: 25.6, lon: 55.4 },
      { lat: 25.01, lon: 55.06 },
    ],
  },
  {
    id: 'mundra',
    name: 'Mundra',
    country: 'India',
    geo: { lat: 22.74, lon: 69.7 },
    transitHours: 4 * 24,
    route: [{ chokepoint: 'hormuz', hoursBeforeEta: 12 }],
    cargo: { ELEC: 21, AUTO: 104, FMCG: 270 },
    firstEtaHour: 70,
    vessels: ['Kutch Pioneer', 'Saffron Tide', 'Arabian Courier'],
    lane: [
      { lat: 22.74, lon: 69.7 },
      { lat: 22.0, lon: 66.5 },
      { lat: 23.6, lon: 60.0 },
      { lat: 25.4, lon: 57.4 },
      { lat: 26.57, lon: 56.25 },
      { lat: 25.6, lon: 55.4 },
      { lat: 25.01, lon: 55.06 },
    ],
  },
  {
    id: 'rotterdam',
    name: 'Rotterdam',
    country: 'Netherlands',
    geo: { lat: 51.95, lon: 4.14 },
    transitHours: 20 * 24,
    route: [
      { chokepoint: 'suez', hoursBeforeEta: 204 },
      { chokepoint: 'bab_el_mandeb', hoursBeforeEta: 120 },
      { chokepoint: 'hormuz', hoursBeforeEta: 12 },
    ],
    cargo: { ELEC: 62, AUTO: 104, FMCG: 270 },
    firstEtaHour: 110,
    vessels: ['Nordic Crest', 'Maas Voyager', 'Delta Sovereign'],
    lane: [
      { lat: 51.95, lon: 4.14 },
      { lat: 50.2, lon: -1.5 },
      { lat: 44.0, lon: -9.8 },
      { lat: 36.0, lon: -6.3 },
      { lat: 37.2, lon: 8.0 },
      { lat: 33.8, lon: 22.0 },
      { lat: 31.6, lon: 32.3 },
      { lat: 30.42, lon: 32.35 },
      { lat: 27.5, lon: 34.0 },
      { lat: 20.0, lon: 38.6 },
      { lat: 12.58, lon: 43.33 },
      { lat: 12.6, lon: 50.0 },
      { lat: 17.5, lon: 58.5 },
      { lat: 22.5, lon: 60.5 },
      { lat: 25.4, lon: 57.4 },
      { lat: 26.57, lon: 56.25 },
      { lat: 25.6, lon: 55.4 },
      { lat: 25.01, lon: 55.06 },
    ],
  },
  {
    id: 'singapore',
    name: 'Singapore',
    country: 'Singapore',
    geo: { lat: 1.26, lon: 103.84 },
    transitHours: 11 * 24,
    route: [
      { chokepoint: 'malacca', hoursBeforeEta: 228 },
      { chokepoint: 'hormuz', hoursBeforeEta: 12 },
    ],
    cargo: { ELEC: 125, AUTO: 42, FMCG: 208 },
    firstEtaHour: 150,
    vessels: ['Lion City Spirit', 'Straits Harmony', 'Temasek Bay'],
    lane: [
      { lat: 1.26, lon: 103.84 },
      { lat: 2.5, lon: 101.2 },
      { lat: 5.8, lon: 95.0 },
      { lat: 5.6, lon: 80.5 },
      { lat: 13.0, lon: 66.0 },
      { lat: 22.5, lon: 60.5 },
      { lat: 25.4, lon: 57.4 },
      { lat: 26.57, lon: 56.25 },
      { lat: 25.6, lon: 55.4 },
      { lat: 25.01, lon: 55.06 },
    ],
  },
];
export const ORIGIN_BY_ID = Object.fromEntries(ORIGINS.map((o) => [o.id, o])) as Record<string, Origin>;

/** The long way round Africa, used when the Red Sea / Suez is shut. */
export const CAPE_LANE = [
  { lat: 51.95, lon: 4.14 },
  { lat: 50.2, lon: -1.5 },
  { lat: 44.0, lon: -9.8 },
  { lat: 30.0, lon: -15.0 },
  { lat: 10.0, lon: -20.0 },
  { lat: -10.0, lon: 2.0 },
  { lat: -34.36, lon: 18.47 },
  { lat: -32.0, lon: 33.0 },
  { lat: -15.0, lon: 45.5 },
  { lat: 2.0, lon: 52.0 },
  { lat: 17.5, lon: 58.5 },
  { lat: 22.5, lon: 60.5 },
  { lat: 25.4, lon: 57.4 },
  { lat: 26.57, lon: 56.25 },
  { lat: 25.6, lon: 55.4 },
  { lat: 25.01, lon: 55.06 },
];

export const PORTS: Port[] = [
  {
    id: 'jebel_ali',
    name: 'Jebel Ali Port',
    geo: { lat: 25.01, lon: 55.06 },
    unloadPerHour: 60,
    outsideHormuz: false,
    roadHours: { dubai_south: 1, al_quoz: 1.5, sharjah: 2.5 },
    baseLikelihood: 0.15,
  },
  {
    id: 'fujairah',
    name: 'Fujairah Port',
    geo: { lat: 25.17, lon: 56.36 },
    unloadPerHour: 35,
    outsideHormuz: true,
    roadHours: { dubai_south: 2.6, al_quoz: 2.2, sharjah: 1.7 },
    baseLikelihood: 0.03,
  },
];
export const PORT_BY_ID = Object.fromEntries(PORTS.map((p) => [p.id, p])) as Record<string, Port>;
export const MAIN_PORT = 'jebel_ali';
export const ALT_PORT = 'fujairah';

export const DCS: Dc[] = [
  { id: 'dubai_south', name: 'Dubai South DC', area: 'Dubai South', targetDays: 3, startDays: 2.1, baseLikelihood: 0.04 },
  { id: 'al_quoz', name: 'Al Quoz DC', area: 'Al Quoz', targetDays: 3, startDays: 2.1, baseLikelihood: 0.04 },
  { id: 'sharjah', name: 'Sharjah DC', area: 'Sharjah', targetDays: 3, startDays: 2.3, baseLikelihood: 0.04 },
];
export const DC_BY_ID = Object.fromEntries(DCS.map((d) => [d.id, d])) as Record<string, Dc>;

export const CUSTOMERS: Customer[] = [
  { id: 'ecommerce', name: 'E-commerce fulfilment', dc: 'dubai_south', priority: true, demand: { ELEC: 22, AUTO: 4, FMCG: 18 } },
  { id: 'industrial', name: 'JAFZA industrial clients', dc: 'dubai_south', priority: true, demand: { ELEC: 2, AUTO: 16, FMCG: 4 } },
  { id: 'abu_dhabi', name: 'Abu Dhabi retail', dc: 'dubai_south', priority: false, demand: { ELEC: 10, AUTO: 8, FMCG: 30 } },
  { id: 'dubai_retail', name: 'Dubai retail stores', dc: 'al_quoz', priority: false, demand: { ELEC: 14, AUTO: 6, FMCG: 40 } },
  { id: 'northern', name: 'Sharjah and Northern Emirates', dc: 'sharjah', priority: false, demand: { ELEC: 8, AUTO: 6, FMCG: 28 } },
];
export const CUSTOMER_BY_ID = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c])) as Record<string, Customer>;

export const ROADS: Road[] = [
  { id: 'e77', name: 'E77 Expo Road', dcs: ['dubai_south'], baseLikelihood: 0.05 },
  { id: 'e11', name: 'E11 Sheikh Zayed Road', dcs: ['al_quoz'], baseLikelihood: 0.08 },
  { id: 'e311', name: 'E311 Mohammed bin Zayed Road', dcs: ['sharjah'], baseLikelihood: 0.08 },
];
export const ROAD_BY_ID = Object.fromEntries(ROADS.map((r) => [r.id, r])) as Record<string, Road>;

/** Daily demand per DC per SKU (sum of its customers). */
export function dcDailyDemand(dc: string, sku: SkuId): number {
  let n = 0;
  for (const c of CUSTOMERS) if (c.dc === dc) n += c.demand[sku];
  return n;
}

export const TRUCK = {
  pallets: 22,
  fleet: 16,
  costPerHour: 160,
  co2PerHour: 38,
};

export const COSTS = {
  /** key accounts have penalty clauses: their late pallet-days cost this much more */
  priorityMultiplier: 2.5,
  /** port stock at the start, in days of total demand */
  portStartDays: 1.0,
  fujairahPerPallet: 210,
  longRoutePerPallet: 140,
  longRouteCo2PerPallet: 95,
  airPerPallet: 2600,
  airCo2PerPallet: 1450,
  airPalletsPerDay: 26,
  extraTruckFactor: 0.6,
  /** a ship waiting for a berth or a strait, AED per hour */
  demurragePerHour: 2200,
  /** regional suppliers in Saudi Arabia and Oman: premium price, trucked in */
  regionalPalletsPerDay: 70,
  regionalPremiumPerPallet: 500,
  regionalCo2PerPallet: 85,
  regionalLeadHours: 60,
  extraTruckPerDay: 9500,
};

export const LEVERS: Lever[] = [
  {
    id: 'divert_fujairah',
    name: 'Divert ships to Fujairah',
    short: 'Fujairah',
    description: 'Ships call at Fujairah, outside the Strait of Hormuz, and trucks bring the cargo across the Emirates.',
  },
  {
    id: 'long_route',
    name: 'Sail the long way round',
    short: 'Long route',
    description: 'Ships stuck behind a closed chokepoint take the longer sea route instead of waiting.',
  },
  {
    id: 'regional_buy',
    name: 'Buy from regional suppliers',
    short: 'Regional buy',
    description: 'Buy auto parts and consumer goods from suppliers in Saudi Arabia and Oman at a premium and truck them in.',
  },
  {
    id: 'air_freight',
    name: 'Fly in electronics',
    short: 'Air freight',
    description: 'Daily air cargo of the highest-value stock into Al Maktoum airport, next to Dubai South DC.',
  },
  {
    id: 'rebalance',
    name: 'Rebalance stock between DCs',
    short: 'Rebalance',
    description: 'Move stock from the DC with the most cover to the ones running low, and serve a closed DC’s customers from the nearest one.',
  },
  {
    id: 'priority',
    name: 'Serve key accounts first',
    short: 'Key accounts',
    description: 'When stock is short, key accounts with strict delivery promises are served before everyone else.',
  },
  {
    id: 'extra_trucks',
    name: 'Hire extra trucks',
    short: 'Extra trucks',
    description: 'Add 60% more trucks to move cargo out of the ports faster.',
  },
];
export const LEVER_BY_ID = Object.fromEntries(LEVERS.map((l) => [l.id, l])) as Record<LeverId, Lever>;

/** Nearest other DC, used when a DC is closed and stock is rebalanced. */
export const BACKUP_DC: Record<string, string> = {
  dubai_south: 'al_quoz',
  al_quoz: 'dubai_south',
  sharjah: 'al_quoz',
};
