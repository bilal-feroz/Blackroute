// Shared types for the BlackRoute network, simulator and planner.

export type SkuId = 'ELEC' | 'AUTO' | 'FMCG';

export interface Sku {
  id: SkuId;
  name: string;
  /** what one pallet is worth, AED */
  palletValue: number;
  /** lost sales and penalties per pallet-day a customer waits beyond the promise, AED */
  latePerDay: number;
  color: string;
}

export type NodeKind = 'origin' | 'chokepoint' | 'port' | 'dc' | 'customer';

/** A place on the real map (global corridor view). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface RouteLeg {
  chokepoint: string;
  /** how many hours before reaching Jebel Ali the vessel passes this point */
  hoursBeforeEta: number;
}

export interface Origin {
  id: string;
  name: string;
  country: string;
  geo: GeoPoint;
  /** chokepoints a vessel from here passes on the normal route, in order */
  route: RouteLeg[];
  /** normal sailing time to Jebel Ali, hours */
  transitHours: number;
  /** fictional vessel names on this lane */
  vessels: string[];
  /** pallets on a normal weekly vessel */
  cargo: Record<SkuId, number>;
  /** hour of the first sailing in the plan (can be before 0 = already at sea) */
  firstEtaHour: number;
  /** sea lane waypoints for the map, origin first */
  lane: GeoPoint[];
}

export interface Chokepoint {
  id: string;
  name: string;
  geo: GeoPoint;
  /** extra days if vessels take the long way round instead of waiting */
  longRouteExtraDays: number | null;
  longRouteName: string | null;
  /** chance of a serious disruption in the next month, before live signals */
  baseLikelihood: number;
  blurb: string;
}

export interface Port {
  id: string;
  name: string;
  geo: GeoPoint;
  /** pallets per hour the cranes can unload */
  unloadPerHour: number;
  /** true if ships reach it without passing the Strait of Hormuz */
  outsideHormuz: boolean;
  /** road hours to each DC */
  roadHours: Record<string, number>;
  baseLikelihood: number;
}

export interface Dc {
  id: string;
  name: string;
  area: string;
  /** days of demand the DC keeps on hand normally */
  targetDays: number;
  /** days of demand on hand at the start */
  startDays: number;
  baseLikelihood: number;
}

export interface Customer {
  id: string;
  name: string;
  dc: string;
  /** key account with a strict delivery promise */
  priority: boolean;
  /** pallets ordered per day */
  demand: Record<SkuId, number>;
}

export interface Road {
  id: string;
  name: string;
  /** the DCs this road serves from Jebel Ali */
  dcs: string[];
  baseLikelihood: number;
}

/** Positions on the 3D board for the local digital twin (x = east, z = south). */
export interface BoardPlace {
  id: string;
  pos: [number, number];
}

export type DisruptionKind =
  | 'chokepoint'
  | 'port_closure'
  | 'port_congestion'
  | 'dc_outage'
  | 'road_closure'
  | 'weather'
  | 'supplier';

export interface Disruption {
  kind: DisruptionKind;
  /** id of the chokepoint / port / dc / road / origin hit */
  target: string;
  startHour: number;
  durationHours: number;
}

export type LeverId =
  | 'divert_fujairah'
  | 'long_route'
  | 'regional_buy'
  | 'air_freight'
  | 'rebalance'
  | 'priority'
  | 'extra_trucks';

export interface Lever {
  id: LeverId;
  name: string;
  short: string;
  description: string;
}

export interface SimOptions {
  disruption?: Disruption | null;
  /** a second disruption (used by the Red Team stress test) */
  extraDisruption?: Disruption | null;
  levers?: LeverId[];
  /** hour the levers take effect (cost of waiting) */
  actHour?: number;
  /** seed for random futures; omit for the expected (no-noise) run */
  seed?: number;
  /** multiplier on disruption length for this future */
  durationFactor?: number;
  /** multiplier on customer demand (Red Team demand surge) */
  demandFactor?: number;
  horizonHours?: number;
  /** keep hourly series and trips for the 3D replay */
  record?: boolean;
}

export interface TruckTrip {
  from: string;
  to: string;
  depart: number;
  arrive: number;
  pallets: number;
  /** recovery move created by a lever */
  recovery: boolean;
}

export type VesselStatus = 'sailing' | 'held' | 'anchored' | 'berthed' | 'done';

export interface VesselTrack {
  id: string;
  name: string;
  origin: string;
  port: string;
  plannedEta: number;
  eta: number;
  berthHour: number | null;
  doneHour: number | null;
  heldAt: string | null;
  rerouted: string | null;
}

export interface SimEvent {
  hour: number;
  tone: 'info' | 'warn' | 'bad' | 'good';
  text: string;
  node?: string;
}

export interface Metrics {
  orderedPallets: number;
  onTimePallets: number;
  latePallets: number;
  unfilledPallets: number;
  /** share of pallets delivered within 24 h of the order */
  serviceLevel: number;
  latePalletDays: number;
  priorityLatePallets: number;
  stockoutHours: number;
  /** hours from the disruption start until the network is back to normal; null = not within horizon */
  recoveryHours: number | null;
  costAed: number;
  co2Kg: number;
  /** cost split for the plan card */
  costBreakdown: Record<string, number>;
}

export interface SimRun {
  options: SimOptions;
  metrics: Metrics;
  events: SimEvent[];
  vessels: VesselTrack[];
  trips: TruckTrip[];
  /** hourly stock per node, total pallets (dc ids + port ids) */
  stockSeries: Record<string, Float32Array>;
  /** hourly stock per dc per sku */
  skuSeries: Record<string, Record<SkuId, Float32Array>>;
  /** hourly open backlog per customer (pallets) */
  backlogSeries: Record<string, Float32Array>;
  horizonHours: number;
}
