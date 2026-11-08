// The road map of the local digital twin (Dubai area, not to scale) and a
// tiny shortest-path finder, so every truck drives along real roads.
// Board coordinates: x runs east, z runs south. The sea is on the west.

export type P = [number, number];

export const ROAD_NODES: Record<string, P> = {
  GATE: [-22, 0], // Jebel Ali port gate
  J1: [0, 0],
  DSD: [0, 22], // Dubai South DC dock
  WJ: [-14, 22],
  ECOM: [-18, 34], // e-commerce fulfilment
  ADP: [-14, 52], // road out to Abu Dhabi and Saudi Arabia
  EJ: [30, 22],
  AIR: [30, 38], // Al Maktoum airport cargo terminal
  JAF_J: [0, -20],
  JAF: [-10, -20], // JAFZA industrial clients
  J2: [32, 0],
  AQD: [32, -6], // Al Quoz DC dock
  J3: [60, 0],
  CITY: [60, 14], // Dubai retail stores
  SHD: [60, -20], // Sharjah DC dock
  NP: [82, -20], // road out to the Northern Emirates
  FUJ: [82, 0], // road in from Fujairah port
};

const EDGES: [string, string][] = [
  ['GATE', 'J1'],
  ['J1', 'DSD'],
  ['DSD', 'WJ'],
  ['WJ', 'ECOM'],
  ['WJ', 'ADP'],
  ['DSD', 'EJ'],
  ['EJ', 'AIR'],
  ['J1', 'JAF_J'],
  ['JAF_J', 'JAF'],
  ['J1', 'J2'],
  ['J2', 'AQD'],
  ['J2', 'J3'],
  ['J3', 'CITY'],
  ['J3', 'SHD'],
  ['SHD', 'NP'],
  ['J3', 'FUJ'],
];

export const ROAD_EDGES = EDGES;

/** Which road node each simulator node uses. */
export const NODE_OF: Record<string, string> = {
  jebel_ali: 'GATE',
  fujairah: 'FUJ',
  regional: 'ADP',
  airport: 'AIR',
  dubai_south: 'DSD',
  al_quoz: 'AQD',
  sharjah: 'SHD',
  ecommerce: 'ECOM',
  industrial: 'JAF',
  abu_dhabi: 'ADP',
  dubai_retail: 'CITY',
  northern: 'NP',
};

const adj: Record<string, string[]> = {};
for (const [a, b] of EDGES) {
  (adj[a] ??= []).push(b);
  (adj[b] ??= []).push(a);
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pathCache = new Map<string, P[]>();

/** Shortest road path between two road nodes, as a list of points. */
export function roadPath(from: string, to: string): P[] {
  const key = `${from}>${to}`;
  const hit = pathCache.get(key);
  if (hit) return hit;
  const best: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = '';
    let cd = Infinity;
    for (const n of open) if (best[n] < cd) ((cd = best[n]), (cur = n));
    open.delete(cur);
    if (cur === to) break;
    for (const nb of adj[cur] ?? []) {
      const d = cd + dist(ROAD_NODES[cur], ROAD_NODES[nb]);
      if (d < (best[nb] ?? Infinity)) {
        best[nb] = d;
        prev[nb] = cur;
        open.add(nb);
      }
    }
  }
  const out: P[] = [];
  let n: string | undefined = to;
  while (n) {
    out.unshift(ROAD_NODES[n]);
    if (n === from) break;
    n = prev[n];
  }
  pathCache.set(key, out);
  return out;
}

export function pathBetween(simFrom: string, simTo: string): P[] {
  return roadPath(NODE_OF[simFrom] ?? 'GATE', NODE_OF[simTo] ?? 'J1');
}

/** Point and heading at fraction t (0..1) along a polyline. */
export function along(path: P[], t: number): { x: number; z: number; angle: number } {
  if (path.length < 2) return { x: path[0]?.[0] ?? 0, z: path[0]?.[1] ?? 0, angle: 0 };
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i]);
    seg.push(d);
    total += d;
  }
  let target = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, target / seg[i]) : 0;
      const a = path[i];
      const b = path[i + 1];
      return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, angle: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    target -= seg[i];
  }
  const last = path[path.length - 1];
  return { x: last[0], z: last[1], angle: 0 };
}
