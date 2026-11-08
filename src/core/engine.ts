// BlackRoute simulator. Plays three weeks of the network hour by hour:
// ships sail and pass chokepoints, port cranes unload, trucks carry pallets
// to the DCs, customers order every morning and the DCs serve them.
//
// The simulator is the only source of numbers in the app. The AI agents read
// its results; they never make numbers up.

import {
  ALT_PORT,
  BACKUP_DC,
  CHOKEPOINT_BY_ID,
  COSTS,
  CUSTOMERS,
  DCS,
  DC_BY_ID,
  HORIZON_HOURS,
  MAIN_PORT,
  ORIGINS,
  PORTS,
  PORT_BY_ID,
  ROADS,
  SKU_BY_ID,
  SKU_IDS,
  TRUCK,
  dcDailyDemand,
} from './network';
import { between, mulberry32 } from './rng';
import type {
  Disruption,
  LeverId,
  Metrics,
  SimEvent,
  SimOptions,
  SimRun,
  SkuId,
  TruckTrip,
  VesselTrack,
} from './types';

type Stock = Record<SkuId, number>;
const zero = (): Stock => ({ ELEC: 0, AUTO: 0, FMCG: 0 });
const total = (s: Stock) => s.ELEC + s.AUTO + s.FMCG;

interface Vessel extends VesselTrack {
  cargo: Stock;
  remaining: Stock;
  totalPallets: number;
  status: 'sailing' | 'anchored' | 'berthed' | 'done';
  viaLongRoute: boolean;
}

interface Order {
  customer: string;
  sku: SkuId;
  qty: number;
  hour: number;
}

interface Window {
  start: number;
  end: number;
}

const DISPATCH_HOURS = new Set([5, 13, 21]);
const ORDER_HOUR = 9;
const QUEUE_HOURS = 5;

function windowOf(d: Disruption, factor: number): Window {
  return { start: d.startHour, end: d.startHour + Math.round(d.durationHours * factor) };
}

const inWin = (w: Window | null, h: number) => !!w && h >= w.start && h < w.end;

export function simulate(opts: SimOptions = {}): SimRun {
  const H = opts.horizonHours ?? HORIZON_HOURS;
  const levers = new Set<LeverId>(opts.levers ?? []);
  const actHour = opts.actHour ?? opts.disruption?.startHour ?? 0;
  const noisy = opts.seed !== undefined;
  const rand = mulberry32(opts.seed ?? 1);
  const factor = opts.durationFactor ?? 1;
  const record = opts.record ?? false;

  const disruptions = [opts.disruption, opts.extraDisruption].filter(Boolean) as Disruption[];
  const winFor = (kind: Disruption['kind'], target?: string): Window | null => {
    for (const d of disruptions) if (d.kind === kind && (target === undefined || d.target === target)) return windowOf(d, factor);
    return null;
  };
  const mainStart = opts.disruption ? opts.disruption.startHour : null;

  const events: SimEvent[] = [];
  const say = (hour: number, tone: SimEvent['tone'], text: string, node?: string) => {
    events.push({ hour, tone, text, node });
  };

  const cost: Record<string, number> = { trucking: 0, rerouting: 0, air: 0, extraTrucks: 0, latePenalties: 0 };
  let co2 = 0;

  // ---------- ships: build the schedule, then apply chokepoint and port effects up front
  const vessels: Vessel[] = [];
  let heldCount: Record<string, number> = {};
  for (const o of ORIGINS) {
    const supplier = winFor('supplier', o.id);
    for (let k = 0; ; k++) {
      let eta = o.firstEtaHour + k * 168;
      if (eta > H + 24 * 14) break;
      if (noisy) eta += Math.round(between(rand, -10, 10));
      const cargo = zero();
      for (const s of SKU_IDS) cargo[s] = Math.round(o.cargo[s] * (noisy ? between(rand, 0.92, 1.08) : 1));
      const v: Vessel = {
        id: `${o.id}-${k}`,
        name: o.vessels[k % o.vessels.length],
        origin: o.id,
        port: MAIN_PORT,
        plannedEta: eta,
        eta,
        berthHour: null,
        doneHour: null,
        heldAt: null,
        rerouted: null,
        cargo,
        remaining: { ...cargo },
        totalPallets: total(cargo),
        status: 'sailing',
        viaLongRoute: false,
      };

      // a strike at the origin keeps ships in port until it ends
      const depart = eta - o.transitHours;
      if (supplier && depart >= supplier.start && depart < supplier.end) {
        v.eta += supplier.end - depart;
        v.heldAt = o.id;
      }

      // chokepoints along the way
      let delay = v.eta - eta;
      for (const leg of o.route) {
        const cp = CHOKEPOINT_BY_ID[leg.chokepoint];
        const w = winFor('chokepoint', leg.chokepoint);
        const pass = eta + delay - leg.hoursBeforeEta;
        if (!w || pass < w.start || pass >= w.end) continue;

        const queue = (heldCount[cp.id] = (heldCount[cp.id] ?? 0) + 1) * QUEUE_HOURS;
        const wait = w.end - pass + queue;
        const decide = Math.max(w.start, actHour);

        if (cp.id === 'hormuz' && levers.has('divert_fujairah') && decide < w.end) {
          // ships outside the strait call at Fujairah instead
          const arrive = Math.max(pass, decide) - 6 + (decide > pass ? 6 : 0);
          v.port = ALT_PORT;
          v.rerouted = 'Fujairah';
          v.eta = arrive + 2;
          delay = v.eta - eta;
          break;
        }
        if (levers.has('long_route') && cp.longRouteExtraDays !== null && decide < w.end) {
          const extra = cp.longRouteExtraDays * 24 + Math.max(0, decide - pass);
          if (extra < wait) {
            delay += extra;
            v.rerouted = cp.longRouteName;
            v.viaLongRoute = true;
            continue;
          }
        }
        delay += wait;
        v.heldAt = cp.id;
      }
      if (v.port === MAIN_PORT) v.eta = eta + delay;

      // Jebel Ali shut or jammed: ships still outside the strait can divert
      const shut = winFor('port_closure', MAIN_PORT) ?? winFor('port_congestion', MAIN_PORT);
      if (shut && v.port === MAIN_PORT && levers.has('divert_fujairah')) {
        const decide = Math.max(shut.start, actHour);
        const hormuzPass = v.eta - 12;
        if (v.eta >= shut.start && v.eta < shut.end + 24 && hormuzPass >= decide) {
          v.port = ALT_PORT;
          v.rerouted = 'Fujairah';
          v.eta = hormuzPass - 4;
        }
      }
      vessels.push(v);
    }
  }
  heldCount = {};
  vessels.sort((a, b) => a.eta - b.eta);

  if (opts.disruption) {
    for (const v of vessels) {
      if (v.heldAt && CHOKEPOINT_BY_ID[v.heldAt]) {
        say(Math.max(v.plannedEta - 48, opts.disruption.startHour), 'warn', `${v.name} held at ${CHOKEPOINT_BY_ID[v.heldAt].name}`, v.heldAt);
      } else if (v.rerouted) {
        say(Math.max(actHour, opts.disruption.startHour), 'good', `${v.name} rerouted via ${v.rerouted}`, v.port);
      }
    }
  }

  // ---------- state
  const portStock: Record<string, Stock> = {};
  for (const p of PORTS) portStock[p.id] = zero();
  for (const s of SKU_IDS) {
    let d = 0;
    for (const dc of DCS) d += dcDailyDemand(dc.id, s);
    portStock[MAIN_PORT][s] = Math.round(d * COSTS.portStartDays);
  }
  const dcStock: Record<string, Stock> = {};
  const inTransit: Record<string, Stock> = {};
  for (const dc of DCS) {
    dcStock[dc.id] = zero();
    inTransit[dc.id] = zero();
    for (const s of SKU_IDS) dcStock[dc.id][s] = Math.round(dcDailyDemand(dc.id, s) * dc.startDays);
  }

  const fleet = Math.round(TRUCK.fleet * (levers.has('extra_trucks') ? 1 + COSTS.extraTruckFactor : 1));
  const truckFreeAt: number[] = [];
  for (let i = 0; i < TRUCK.fleet; i++) truckFreeAt.push(0);
  const pending: { to: string; arrive: number; cargo: Stock }[] = [];
  const trips: TruckTrip[] = [];

  const backlog: Order[] = [];
  let ordered = 0;
  let onTime = 0;
  let late = 0;
  let latePalletDays = 0;
  let latePenalty = 0;
  let priorityLate = 0;
  let stockoutHours = 0;
  let lastTroubleHour = -1;
  const ranOut = new Set<string>();

  const stockSeries: Record<string, Float32Array> = {};
  const skuSeries: Record<string, Record<SkuId, Float32Array>> = {};
  const backlogSeries: Record<string, Float32Array> = {};
  if (record) {
    for (const p of PORTS) stockSeries[p.id] = new Float32Array(H);
    for (const dc of DCS) {
      stockSeries[dc.id] = new Float32Array(H);
      skuSeries[dc.id] = { ELEC: new Float32Array(H), AUTO: new Float32Array(H), FMCG: new Float32Array(H) };
    }
    for (const c of CUSTOMERS) backlogSeries[c.id] = new Float32Array(H);
  }

  const portWindows = {
    closed: winFor('port_closure', MAIN_PORT),
    congested: winFor('port_congestion', MAIN_PORT),
  };
  const weather = winFor('weather');
  const dcOut = DCS.map((d) => ({ id: d.id, w: winFor('dc_outage', d.id) }));
  const roadOut = ROADS.map((r) => ({ road: r, w: winFor('road_closure', r.id) }));
  const longestEnd = disruptions.reduce((m, d) => Math.max(m, d.startHour + d.durationHours * factor), 0);
  const extraTruckDays = levers.has('extra_trucks') ? Math.max(1, Math.ceil((longestEnd + 72 - actHour) / 24)) : 0;
  if (extraTruckDays && opts.disruption) cost.extraTrucks += extraTruckDays * COSTS.extraTruckPerDay;
  if (levers.has('extra_trucks')) for (let i = TRUCK.fleet; i < fleet; i++) truckFreeAt.push(actHour);

  // closure flags are worked out once per hour (see the loop) to keep runs fast
  const closedNow: Record<string, boolean> = {};
  let closedHour = -1;
  const dcClosed = (id: string, h: number) => {
    if (h !== closedHour) {
      closedHour = h;
      for (const d of dcOut) closedNow[d.id] = inWin(d.w, h);
    }
    return closedNow[id];
  };
  const servingDc = (customerDc: string, h: number) =>
    dcClosed(customerDc, h) && levers.has('rebalance') && h >= actHour ? BACKUP_DC[customerDc] : customerDc;

  const roadFactor = (port: string, dc: string, h: number) => {
    let f = 1;
    if (port === MAIN_PORT) for (const r of roadOut) if (r.road.dcs.includes(dc) && inWin(r.w, h)) f *= 2.4;
    if (inWin(weather, h)) f *= 1.8;
    return f;
  };

  const freeTrucks = (h: number) => {
    let n = 0;
    for (const t of truckFreeAt) if (t <= h) n++;
    return n;
  };

  const sendTrucks = (from: string, to: string, h: number, want: Stock, recovery: boolean, fromDc = false) => {
    const pallets = Math.min(total(want), freeTrucks(h) * TRUCK.pallets);
    if (pallets < 1) return 0;
    let left = pallets;
    const cargo = zero();
    const wantTotal = total(want);
    for (const s of SKU_IDS) {
      const q = Math.min(want[s], Math.floor((want[s] / wantTotal) * pallets));
      cargo[s] = q;
      left -= q;
    }
    for (const s of SKU_IDS) {
      if (left <= 0) break;
      const extra = Math.min(left, want[s] - cargo[s]);
      cargo[s] += extra;
      left -= extra;
    }
    const sent = total(cargo);
    if (sent < 1) return 0;
    const baseHours = fromDc ? 1.2 : PORT_BY_ID[from].roadHours[to];
    const hours = baseHours * (fromDc ? 1 : roadFactor(from, to, h)) * (noisy ? between(rand, 0.92, 1.1) : 1);
    const trucks = Math.ceil(sent / TRUCK.pallets);
    let used = 0;
    for (let i = 0; i < truckFreeAt.length && used < trucks; i++) {
      if (truckFreeAt[i] <= h) {
        truckFreeAt[i] = h + hours * 2 + 1;
        used++;
      }
    }
    const src = fromDc ? dcStock[from] : portStock[from];
    for (const s of SKU_IDS) {
      src[s] -= cargo[s];
      inTransit[to][s] += cargo[s];
    }
    const trip: TruckTrip = { from, to, depart: h, arrive: h + hours, pallets: sent, recovery };
    pending.push({ to, arrive: h + hours, cargo });
    if (record) {
      // one entry per truck so the 3D view can animate every vehicle
      for (let i = 0; i < trucks; i++) trips.push({ ...trip, depart: h + i * 0.18, arrive: h + hours + i * 0.18, pallets: Math.min(TRUCK.pallets, sent - i * TRUCK.pallets) });
    }
    cost.trucking += trucks * hours * 2 * TRUCK.costPerHour;
    co2 += trucks * hours * 2 * TRUCK.co2PerHour;
    if (from === ALT_PORT) cost.rerouting += 0; // port fee is counted at unloading
    return sent;
  };

  // deliveries that do not use our own fleet (air cargo, regional carriers)
  const externalTrip = (from: string, to: string, h: number, hours: number, cargo: Stock) => {
    const pallets = total(cargo);
    if (pallets < 0.5) return;
    for (const s of SKU_IDS) inTransit[to][s] += cargo[s];
    const trip: TruckTrip = { from, to, depart: h, arrive: h + hours, pallets, recovery: true };
    pending.push({ to, arrive: h + hours, cargo: { ...cargo } });
    if (record) {
      const trucks = Math.max(1, Math.round(pallets / TRUCK.pallets));
      for (let i = 0; i < trucks; i++) trips.push({ ...trip, depart: h + i * 0.25, arrive: h + hours + i * 0.25, pallets: pallets / trucks });
    }
  };

  let portWasClosed = false;
  let firstAirHour = -1;
  let firstRegionalHour = -1;

  for (let h = 0; h < H; h++) {
    // ----- port status
    const jaClosed = inWin(portWindows.closed, h);
    if (jaClosed && !portWasClosed) say(h, 'bad', 'Jebel Ali terminal stops working', MAIN_PORT);
    if (!jaClosed && portWasClosed) say(h, 'info', 'Jebel Ali terminal back online', MAIN_PORT);
    portWasClosed = jaClosed;

    // ----- ships arrive and queue
    for (const v of vessels) {
      if (v.status === 'sailing' && v.eta <= h) v.status = 'anchored';
    }

    // ----- berths and cranes
    for (const p of PORTS) {
      let rate = p.unloadPerHour;
      let berths = p.id === MAIN_PORT ? 2 : 1;
      const congested = p.id === MAIN_PORT && inWin(portWindows.congested, h);
      if (p.id === MAIN_PORT) {
        if (jaClosed) rate = 0;
        else if (congested) {
          rate *= 0.3;
          berths = 1;
        }
      }
      if (inWin(weather, h)) rate *= 0.4;
      const atBerth: Vessel[] = [];
      for (const v of vessels) if (v.port === p.id && v.status === 'berthed') atBerth.push(v);
      if (rate > 0) {
        for (const v of vessels) {
          if (atBerth.length >= berths) break;
          // in a jam, ships wait at anchor for days before a berth frees up
          if (v.port === p.id && v.status === 'anchored' && (!congested || h - v.eta >= 60)) {
            v.status = 'berthed';
            v.berthHour = h;
            atBerth.push(v);
          }
        }
      }
      const share = atBerth.length ? rate / atBerth.length : 0;
      for (const v of atBerth) {
        const left = total(v.remaining);
        const take = Math.min(left, share);
        if (take <= 0) continue;
        for (const s of SKU_IDS) {
          const q = (v.remaining[s] / left) * take;
          v.remaining[s] -= q;
          portStock[p.id][s] += q;
        }
        if (p.id === ALT_PORT) cost.rerouting += take * COSTS.fujairahPerPallet;
        if (v.viaLongRoute) {
          cost.rerouting += take * COSTS.longRoutePerPallet;
          co2 += take * COSTS.longRouteCo2PerPallet;
        }
        if (total(v.remaining) < 0.5) {
          v.status = 'done';
          v.doneHour = h;
        }
      }
    }

    // ----- trucks arrive
    for (let i = pending.length - 1; i >= 0; i--) {
      const t = pending[i];
      if (t.arrive <= h + 1) {
        for (const sk of SKU_IDS) {
          inTransit[t.to][sk] = Math.max(0, inTransit[t.to][sk] - t.cargo[sk]);
          dcStock[t.to][sk] += t.cargo[sk];
        }
        pending.splice(i, 1);
      }
    }

    // ----- port dispatch rounds
    if (DISPATCH_HOURS.has(h % 24)) {
      const order = DCS.map((d) => d.id)
        .filter((id) => !dcClosed(id, h))
        .map((id) => {
          let cover = Infinity;
          for (const s of SKU_IDS) {
            const dd = dcDailyDemand(id, s) + (levers.has('rebalance') ? extraDemandFrom(id, h) : 0);
            if (dd > 0) cover = Math.min(cover, (dcStock[id][s] + inTransit[id][s]) / dd);
          }
          return { id, cover };
        })
        .sort((a, b) => a.cover - b.cover);

      // in a sandstorm the police keep heavy trucks off the roads at night
      const nightBan = inWin(weather, h) && h % 24 !== 13;
      for (const port of [MAIN_PORT, ALT_PORT]) {
        if (port === MAIN_PORT && jaClosed) continue;
        if (nightBan) continue;
        if (total(portStock[port]) < 1) continue;
        for (const { id } of order) {
          const want = zero();
          for (const s of SKU_IDS) {
            const dd = dcDailyDemand(id, s) + (levers.has('rebalance') ? extraDemandFrom(id, h) * shareOf(id, s) : 0);
            const target = dd * DC_BY_ID[id].targetDays;
            const need = Math.max(0, target - dcStock[id][s] - inTransit[id][s]);
            want[s] = Math.min(need, Math.floor(portStock[port][s]));
          }
          if (total(want) >= 4) sendTrucks(port, id, h, want, port === ALT_PORT);
        }
      }
    }

    // ----- rebalancing between DCs (lever)
    if (levers.has('rebalance') && h >= actHour && (h === actHour || h % 24 === 4) && mainStart !== null) {
      const covers = DCS.filter((d) => !dcClosed(d.id, h)).map((d) => {
        let c = Infinity;
        for (const s of SKU_IDS) c = Math.min(c, dcStock[d.id][s] / Math.max(1, dcDailyDemand(d.id, s)));
        return { id: d.id, c };
      });
      covers.sort((a, b) => a.c - b.c);
      const low = covers[0];
      const high = covers[covers.length - 1];
      if (low && high && low.id !== high.id && high.c > low.c + 1) {
        const want = zero();
        for (const s of SKU_IDS) {
          const spare = dcStock[high.id][s] - dcDailyDemand(high.id, s) * 1.5;
          const gap = dcDailyDemand(low.id, s) * 2 - dcStock[low.id][s];
          want[s] = Math.max(0, Math.floor(Math.min(spare, gap)));
        }
        if (total(want) >= 6) {
          const sent = sendTrucks(high.id, low.id, h, want, true, true);
          if (sent && h === actHour) say(h, 'good', `Rebalancing: ${Math.round(sent)} pallets from ${DC_BY_ID[high.id].name} to ${DC_BY_ID[low.id].name}`, low.id);
        }
      }
    }

    // ----- air freight (lever): lands next to Dubai South DC
    if (levers.has('air_freight') && mainStart !== null && h >= actHour + 48 && h % 24 === 10 && h <= longestEnd + 12) {
      const q = COSTS.airPalletsPerDay * (noisy ? between(rand, 0.9, 1.05) : 1);
      const cargo = zero();
      cargo.ELEC = q;
      externalTrip('airport', 'dubai_south', h, 0.6, cargo);
      cost.air += q * COSTS.airPerPallet;
      co2 += q * COSTS.airCo2PerPallet;
      if (firstAirHour < 0) {
        firstAirHour = h;
        say(h, 'good', `First air cargo lands at Al Maktoum airport (${Math.round(q)} pallets of electronics)`, 'dubai_south');
      }
    }

    // ----- regional suppliers (lever): trucked in from Saudi Arabia and Oman
    if (levers.has('regional_buy') && mainStart !== null && h >= actHour + COSTS.regionalLeadHours && h % 24 === 7 && h <= longestEnd + 24) {
      const q = COSTS.regionalPalletsPerDay * (noisy ? between(rand, 0.9, 1.05) : 1);
      let allDemand = 0;
      for (const dc of DCS) allDemand += dcDailyDemand(dc.id, 'AUTO') + dcDailyDemand(dc.id, 'FMCG');
      for (const dc of DCS) {
        if (dcClosed(dc.id, h)) continue;
        const share = (dcDailyDemand(dc.id, 'AUTO') + dcDailyDemand(dc.id, 'FMCG')) / allDemand;
        const cargo = zero();
        cargo.AUTO = q * share * 0.35;
        cargo.FMCG = q * share * 0.65;
        externalTrip('regional', dc.id, h, 7 + (dc.id === 'sharjah' ? 1.5 : 0), cargo);
      }
      cost.rerouting += q * COSTS.regionalPremiumPerPallet;
      co2 += q * COSTS.regionalCo2PerPallet;
      if (firstRegionalHour < 0) {
        firstRegionalHour = h;
        say(h, 'good', `Regional suppliers start trucking in ${Math.round(q)} pallets a day`, 'regional');
      }
    }

    // ----- customers order once a day
    if (h % 24 === ORDER_HOUR) {
      for (const c of CUSTOMERS) {
        for (const s of SKU_IDS) {
          const qty = c.demand[s] * (noisy ? between(rand, 0.85, 1.15) : 1);
          if (qty <= 0) continue;
          backlog.push({ customer: c.id, sku: s, qty, hour: h });
          ordered += qty;
        }
      }
    }

    // ----- DCs serve open orders
    const prioritize = levers.has('priority') && h >= actHour;
    if (backlog.length) {
      // orders are already in time order; key accounts go first when prioritising
      for (let pass = prioritize ? 0 : 1; pass < 2; pass++) {
        for (const o of backlog) {
          if (o.qty < 0.01) continue;
          const cust = CUSTOMER_MAP[o.customer];
          if (prioritize && (pass === 0) !== cust.priority) continue;
          const dc = servingDc(cust.dc, h);
          if (dcClosed(dc, h)) continue;
          const have = dcStock[dc][o.sku];
          if (have <= 0.01) continue;
          const q = Math.min(have, o.qty);
          dcStock[dc][o.sku] -= q;
          o.qty -= q;
          const waited = h - o.hour;
          if (waited <= 24) onTime += q;
          else {
            late += q;
            const days = q * ((waited - 24) / 24);
            latePalletDays += days;
            latePenalty += days * SKU_BY_ID[o.sku].latePerDay * (cust.priority ? COSTS.priorityMultiplier : 1);
            if (cust.priority) priorityLate += q;
          }
        }
      }
      let w = 0;
      for (const o of backlog) if (o.qty >= 0.01) backlog[w++] = o;
      backlog.length = w;
    }

    // ----- watch for trouble
    let trouble = false;
    for (const dc of DCS) {
      let out = false;
      for (const s of SKU_IDS) {
        if (dcDailyDemand(dc.id, s) > 0 && dcStock[dc.id][s] < 1) {
          out = true;
          const key = `${dc.id}:${s}`;
          if (!ranOut.has(key) && mainStart !== null && h > 12) {
            ranOut.add(key);
            say(h, 'bad', `${dc.name} runs out of ${skuName(s)}`, dc.id);
          }
        }
      }
      if (out) stockoutHours++;
    }
    // the backlog is kept in time order, so the first open order is the oldest
    if (backlog.length && h - backlog[0].hour > 24) trouble = true;
    if (trouble) lastTroubleHour = h;

    if (record) {
      for (const p of PORTS) stockSeries[p.id][h] = total(portStock[p.id]);
      for (const dc of DCS) {
        stockSeries[dc.id][h] = total(dcStock[dc.id]);
        for (const s of SKU_IDS) skuSeries[dc.id][s][h] = dcStock[dc.id][s];
      }
      for (const c of CUSTOMERS) {
        let b = 0;
        for (const o of backlog) if (o.customer === c.id) b += o.qty;
        backlogSeries[c.id][h] = b;
      }
    }
  }

  // anything still open at the end counts as late (and unfilled)
  let unfilled = 0;
  for (const o of backlog) {
    unfilled += o.qty;
    const waited = H - o.hour;
    if (waited > 24) {
      const days = o.qty * ((waited - 24) / 24);
      const prio = CUSTOMER_MAP[o.customer].priority;
      latePalletDays += days;
      latePenalty += days * SKU_BY_ID[o.sku].latePerDay * (prio ? COSTS.priorityMultiplier : 1);
      if (prio) priorityLate += o.qty;
    }
  }

  cost.latePenalties = latePenalty;

  let recoveryHours: number | null = 0;
  if (mainStart !== null && lastTroubleHour >= 0) {
    recoveryHours = lastTroubleHour >= H - 6 ? null : Math.max(0, lastTroubleHour - mainStart);
  }
  if (mainStart !== null && recoveryHours !== null && lastTroubleHour >= 0) say(lastTroubleHour + 1, 'good', 'All customer orders back on time', MAIN_PORT);

  const metrics: Metrics = {
    orderedPallets: ordered,
    onTimePallets: onTime,
    latePallets: late + unfilled,
    unfilledPallets: unfilled,
    serviceLevel: ordered ? onTime / ordered : 1,
    latePalletDays,
    priorityLatePallets: priorityLate,
    stockoutHours,
    recoveryHours,
    costAed: Object.values(cost).reduce((a, b) => a + b, 0),
    co2Kg: co2,
    costBreakdown: cost,
  };

  events.sort((a, b) => a.hour - b.hour);
  return {
    options: opts,
    metrics,
    events,
    vessels: vessels.map(({ id, name, origin, port, plannedEta, eta, berthHour, doneHour, heldAt, rerouted }) => ({
      id, name, origin, port, plannedEta, eta, berthHour, doneHour, heldAt, rerouted,
    })),
    trips,
    stockSeries,
    skuSeries,
    backlogSeries,
    horizonHours: H,
  };

  // demand a DC picks up when it covers for a closed neighbour
  function extraDemandFrom(dcId: string, h: number): number {
    let n = 0;
    for (const d of DCS) {
      if (d.id !== dcId && BACKUP_DC[d.id] === dcId && dcClosed(d.id, h)) {
        for (const s of SKU_IDS) n += dcDailyDemand(d.id, s);
      }
    }
    return n;
  }
  function shareOf(dcId: string, s: SkuId): number {
    let all = 0;
    for (const x of SKU_IDS) all += dcDailyDemand(dcId, x);
    return all ? dcDailyDemand(dcId, s) / all : 0;
  }
}

const CUSTOMER_MAP = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c]));
const skuName = (s: SkuId) => ({ ELEC: 'electronics', AUTO: 'auto parts', FMCG: 'consumer goods' })[s];
