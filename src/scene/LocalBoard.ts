// The local digital twin: Jebel Ali terminal, the road network, three DCs,
// customer groups, the airport and the Dubai skyline on a floating board.
// Everything that moves is a playback of the simulator's recorded run.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CUSTOMERS, DCS, SKU_IDS, dcDailyDemand } from '../core/network';
import type { SimRun, VesselTrack } from '../core/types';
import { model, modelParts } from './assets';
import { arcPoints, disposeTree, label, panel, ribbon, roundCorners, tube, type Label, type Panel } from './builders';
import {
  PALETTE,
  beamMaterial,
  flowMaterial,
  gridMaterial,
  ringMaterial,
  setTone,
  sharedTime,
  waterMaterial,
  windowTexture,
  type Tone,
} from './materials';
import { ROAD_EDGES, ROAD_NODES, along, pathBetween, type P } from './roads';
import type { Board, TwinState } from './types';

const QUAY_X = -40;
const BERTHS: P[] = [
  [-49.5, -14],
  [-49.5, 13],
];
const ANCHORAGE: P[] = [
  [-58, -34],
  [-60, 30],
  [-59, -44],
  [-60, 42],
  [-58, 0],
];
const WEST = -66;
// ships sail in at the north end of the water channel and out at the south end,
// so they never cross the edge of the board
const SEA_IN: P = [-56, -50];
const SEA_OUT: P = [-56, 50];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const bez = (a: P, c: P, b: P, t: number): P => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};
const bezHeading = (a: P, c: P, b: P, t: number) => {
  const dx = 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
  const dz = 2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
  return Math.atan2(dx, dz);
};
/** shortest signed turn from a to b */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const DC_POS: Record<string, { pos: P; rot: number; model: string }> = {
  dubai_south: { pos: [0, 33.5], rot: Math.PI, model: 'hub_south' },
  al_quoz: { pos: [32, -16.5], rot: 0, model: 'hub_central' },
  sharjah: { pos: [60, -30.5], rot: 0, model: 'hub_north' },
};

const CUSTOMER_POS: Record<string, P> = {
  ecommerce: [-28, 34],
  industrial: [-10, -31],
  abu_dhabi: [-14, 50],
  dubai_retail: [66, 30],
  northern: [80, -20],
};

const PORTALS: { id: string; node: string; title: string; sub: string; rot: number }[] = [
  { id: 'fujairah', node: 'FUJ', title: 'Fujairah Port', sub: 'East coast · outside Hormuz', rot: Math.PI / 2 },
  { id: 'regional', node: 'ADP', title: 'Abu Dhabi · Saudi road', sub: 'E11 to the south-west', rot: 0 },
  { id: 'north_portal', node: 'NP', title: 'Northern Emirates', sub: 'Sharjah · Ajman · RAK', rot: Math.PI / 2 },
];

interface ShipView {
  group: THREE.Group;
  bays: THREE.Object3D[];
  label: Label;
  /** own copies of the materials so each ship can fade on its own */
  mats: THREE.MeshStandardMaterial[];
  vesselId: string | null;
  x: number;
  z: number;
  heading: number;
}

interface ShipPose {
  p: P;
  heading: number;
  frac: number;
  opacity: number;
}

interface NodeView {
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  label: Label;
  panel?: Panel;
}

interface RouteView {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

const v3 = (p: P, y = 0) => new THREE.Vector3(p[0], y, p[1]);
const DOCK_OF: Record<string, string> = { dubai_south: 'DSD', al_quoz: 'AQD', sharjah: 'SHD' };
const PANEL_OFFSET: Record<string, P> = { dubai_south: [10, 2], al_quoz: [-8, -6], sharjah: [14, -4] };
const TRUCK_COLOR = new THREE.Color('#f28c38');
const SKU_SHORT: Record<string, string> = { ELEC: 'Electronics', AUTO: 'Auto parts', FMCG: 'Consumer' };
const SKU_COLOR: Record<string, string> = { ELEC: '#0284c7', AUTO: '#7c3aed', FMCG: '#16a34a' };

export class LocalBoard implements Board {
  readonly root = new THREE.Group();
  pickables: THREE.Object3D[] = [];

  private ships: ShipView[] = [];
  private truckParts: THREE.InstancedMesh[] = [];
  private truckTint: THREE.InstancedMesh | null = null;
  private yard!: THREE.InstancedMesh;
  private yardMax = 0;
  private nodes: Record<string, NodeView> = {};
  private routes: Record<string, RouteView> = {};
  private incident!: { ring: THREE.Mesh; mat: THREE.ShaderMaterial; beam: THREE.Mesh; beamMat: THREE.ShaderMaterial; label: Label };
  private dome!: THREE.Mesh;
  private dust!: THREE.Points;
  private barriers: THREE.Group[] = [];
  private craneLifts: { box: THREE.Mesh; berth: number }[] = [];
  private plane!: THREE.Group;
  private dcGroups: Record<string, THREE.Group> = {};
  private dcOff = new Map<THREE.Mesh, THREE.Material>();
  private beacons: THREE.Mesh[] = [];
  private labelTimer = 0;
  private dummy = new THREE.Object3D();
  private grid!: THREE.ShaderMaterial;

  constructor() {
    this.buildBoard();
    this.buildPort();
    this.buildRoads();
    this.buildBuildings();
    this.buildSkyline();
    this.buildAirport();
    this.buildPortals();
    this.buildTrees();
    this.buildRoutes();
    this.buildFleet();
    this.buildEffects();
  }

  // ---------------------------------------------------------------- build
  private buildBoard() {
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(86 - WEST + 4, 7, 116, 6, 2.2),
      new THREE.MeshStandardMaterial({ color: '#bfc3bb', roughness: 0.8, metalness: 0.05 }),
    );
    slab.position.set((86 + WEST) / 2, -4.6, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.root.add(slab);

    // land
    const land = new THREE.Mesh(
      new THREE.BoxGeometry(84 - QUAY_X, 1.2, 112),
      new THREE.MeshStandardMaterial({ color: '#dadcd5', roughness: 0.95, metalness: 0.0 }),
    );
    land.position.set((84 + QUAY_X) / 2, -0.6, 0);
    land.receiveShadow = true;
    this.root.add(land);

    // holographic grid on the land
    this.grid = gridMaterial();
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(84 - QUAY_X, 112), this.grid);
    grid.rotation.x = -Math.PI / 2;
    grid.position.set((84 + QUAY_X) / 2, 0.03, 0);
    this.root.add(grid);

    // sea
    const water = new THREE.Mesh(new THREE.PlaneGeometry(QUAY_X - WEST, 112), waterMaterial());
    water.rotation.x = -Math.PI / 2;
    water.position.set((WEST + QUAY_X) / 2, -0.9, 0);
    this.root.add(water);

    // quay apron with a lit edge
    const quay = new THREE.Mesh(new THREE.BoxGeometry(5, 1.3, 70), new THREE.MeshStandardMaterial({ color: '#cdd1ca', roughness: 0.8 }));
    quay.position.set(QUAY_X + 2.5, -0.6, 0);
    quay.receiveShadow = true;
    this.root.add(quay);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 70), new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.6 }));
    edge.position.set(QUAY_X + 0.2, 0.06, 0);
    this.root.add(edge);

    // soft shadow under the board so it seems to float above the page
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grad.addColorStop(0, 'rgba(8,12,20,0.55)');
    grad.addColorStop(0.6, 'rgba(8,12,20,0.25)');
    grad.addColorStop(1, 'rgba(8,12,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const shadowTex = new THREE.CanvasTexture(c);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(250, 190), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set((86 + WEST) / 2 + 6, -12, 8);
    this.root.add(pool);
  }

  private buildPort() {
    // two ship-to-shore cranes over the berths
    BERTHS.forEach(([, z], i) => {
      const crane = model('port_crane');
      crane.position.set(QUAY_X + 2.4, 0, z);
      crane.rotation.y = 0;
      this.root.add(crane);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.1), new THREE.MeshStandardMaterial({ color: '#d9480f', roughness: 0.6 }));
      box.castShadow = true;
      this.root.add(box);
      this.craneLifts.push({ box, berth: i });
    });

    // container yard: fills and empties with the port's stock
    const parts = modelParts('container');
    const geo = parts[0].geometry;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
    const cols = [-35.2, -33.8, -32.4, -31, -27.6, -26.2, -24.8];
    const rows: number[] = [];
    for (let z = -26; z <= 26; z += 2.7) if (Math.abs(z) > 2.6) rows.push(z);
    const palette = ['#e8793a', '#5aa3d8', '#3fb2a5', '#dfe7ef', '#9fb3c8', '#4f86c6', '#c95f4a', '#7cc4b8'].map((c) => new THREE.Color(c));
    const slots: { x: number; y: number; z: number }[] = [];
    for (let tier = 0; tier < 3; tier++) for (const z of rows) for (const x of cols) slots.push({ x, y: tier * 1.02, z });
    // fill order: bottom tier first, then upwards, shuffled within a tier
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ordered = [0, 1, 2].flatMap((t) => slots.filter((s) => Math.round(s.y / 1.02) === t).sort(() => rnd() - 0.5));
    this.yard = new THREE.InstancedMesh(geo, mat, ordered.length);
    ordered.forEach((s, i) => {
      this.dummy.position.set(s.x, s.y, s.z);
      this.dummy.rotation.set(0, Math.PI / 2, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.yard.setMatrixAt(i, this.dummy.matrix);
      this.yard.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
    });
    this.yard.castShadow = true;
    this.yard.receiveShadow = true;
    this.yardMax = ordered.length;
    this.yard.userData.nodeId = 'jebel_ali';
    this.root.add(this.yard);
    this.pickables.push(this.yard);

    const tower = model('port_tower');
    tower.position.set(-30, 0, -36);
    tower.userData.nodeId = 'jebel_ali';
    this.root.add(tower);
    this.pickables.push(tower);
    const light = model('lighthouse');
    light.position.set(QUAY_X + 1.5, 0, -44);
    this.root.add(light);

    // ships (pool)
    for (let i = 0; i < 6; i++) {
      const g = model('ship');
      g.rotation.y = Math.PI / 2;
      g.position.set(-200, -0.75, 0);
      g.visible = false;
      const bays = g.children.filter((c) => c.name.startsWith('ship_cargo'));
      const mats: THREE.MeshStandardMaterial[] = [];
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        mats.push(m.material as THREE.MeshStandardMaterial);
      });
      const l = label('', '', 'ship');
      l.obj.position.set(0, 11, 0);
      g.add(l.obj);
      this.root.add(g);
      this.ships.push({ group: g, bays, label: l, mats, vesselId: null, x: 0, z: 0, heading: Math.PI / 2 });
    }

    this.addNode('jebel_ali', [-30, 0], 10, 'Jebel Ali Port', 16);
  }

  private buildRoads() {
    const asphalt = new THREE.MeshStandardMaterial({ color: '#8f948d', roughness: 0.9, metalness: 0.0 });
    const lineMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
    const dashGeo = new THREE.PlaneGeometry(1.2, 0.16);
    const dashes: THREE.Matrix4[] = [];
    for (const [a, b] of ROAD_EDGES) {
      const pa = ROAD_NODES[a];
      const pb = ROAD_NODES[b];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const road = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, len + 3.6), asphalt);
      road.position.set((pa[0] + pb[0]) / 2, 0.06, (pa[1] + pb[1]) / 2);
      road.rotation.y = Math.atan2(pb[0] - pa[0], pb[1] - pa[1]);
      road.receiveShadow = true;
      this.root.add(road);
      for (let d = 2; d < len - 2; d += 3) {
        const t = d / len;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -road.rotation.y + Math.PI / 2, 'YXZ'));
        m.compose(new THREE.Vector3(pa[0] + (pb[0] - pa[0]) * t, 0.14, pa[1] + (pb[1] - pa[1]) * t), q, new THREE.Vector3(1, 1, 1));
        dashes.push(m);
      }
    }
    const inst = new THREE.InstancedMesh(dashGeo, lineMat, dashes.length);
    dashes.forEach((m, i) => inst.setMatrixAt(i, m));
    this.root.add(inst);
  }

  private buildBuildings() {
    for (const dc of DCS) {
      const spec = DC_POS[dc.id];
      const g = model(spec.model);
      g.position.set(spec.pos[0], 0, spec.pos[1]);
      g.rotation.y = spec.rot;
      g.userData.nodeId = dc.id;
      this.root.add(g);
      this.pickables.push(g);
      this.dcGroups[dc.id] = g;
      this.addNode(dc.id, spec.pos, 12.5, dc.name, 12);
      // floating glass panel with stock per product
      this.nodes[dc.id].label.show(false);
      const pnl = panel(dc.name, '');
      const off = PANEL_OFFSET[dc.id];
      pnl.obj.position.set(spec.pos[0] + off[0], 16, spec.pos[1] + off[1]);
      pnl.el.dataset.node = dc.id;
      this.root.add(pnl.obj);
      this.nodes[dc.id].panel = pnl;
    }

    // customer sites
    const jafza = model('factory');
    jafza.position.set(-10, 0, -31);
    jafza.userData.nodeId = 'industrial';
    this.root.add(jafza);
    this.pickables.push(jafza);
    const ecom = model('factory');
    ecom.position.set(-28, 0, 34);
    ecom.rotation.y = Math.PI / 2;
    ecom.scale.setScalar(0.85);
    ecom.userData.nodeId = 'ecommerce';
    this.root.add(ecom);
    this.pickables.push(ecom);

    for (const c of CUSTOMERS) {
      const p = CUSTOMER_POS[c.id];
      const r = c.id === 'dubai_retail' ? 14 : c.id === 'industrial' || c.id === 'ecommerce' ? 9 : 5;
      this.addNode(c.id, p, r, c.name, c.id === 'dubai_retail' ? 40 : 11, 'customer');
    }
  }

  private buildSkyline() {
    const towers: { x: number; z: number; w: number; d: number; h: number }[] = [
      { x: 52, z: 22, w: 4, d: 4, h: 12 },
      { x: 58, z: 22, w: 3.5, d: 3.5, h: 18 },
      { x: 64, z: 21, w: 4.5, d: 4, h: 24 },
      { x: 70, z: 22, w: 3.5, d: 3.5, h: 15 },
      { x: 76, z: 23, w: 4, d: 4, h: 21 },
      { x: 52, z: 30, w: 3.5, d: 3.5, h: 9 },
      { x: 58, z: 31, w: 4, d: 4, h: 28 },
      { x: 76, z: 31, w: 3.5, d: 3.5, h: 26 },
      { x: 52, z: 38, w: 4, d: 4, h: 14 },
      { x: 58, z: 40, w: 3.5, d: 3.5, h: 20 },
      { x: 64, z: 41, w: 4, d: 4, h: 11 },
      { x: 70, z: 40, w: 4, d: 3.5, h: 30 },
      { x: 77, z: 40, w: 3.5, d: 4, h: 17 },
      { x: 64, z: 49, w: 5, d: 3.5, h: 8 },
      { x: 74, z: 49, w: 4, d: 3.5, h: 12 },
    ];
    const texWarm = windowTexture(5, true);
    const texCool = windowTexture(9, false);
    towers.forEach((t, i) => {
      const tex = (i % 3 === 0 ? texCool : texWarm).clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, t.w / 2.5), t.h / 6);
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: 0.6, metalness: 0.05 });
      const hgt = t.h * 0.62;
      tex.repeat.set(Math.max(1, t.w / 2.5), hgt / 6);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, hgt, t.d), mat);
      mesh.position.set(t.x, hgt / 2, t.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.nodeId = 'dubai_retail';
      this.root.add(mesh);
      this.pickables.push(mesh);
      if (t.h > 18) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3355').multiplyScalar(4) }));
        b.position.set(t.x, hgt + 0.3, t.z);
        this.root.add(b);
        this.beacons.push(b);
      }
    });
    // the tall spire that says "Dubai"
    const spire = new THREE.Group();
    const tex = windowTexture(13, true);
    tex.repeat.set(1, 10);
    const sm = new THREE.MeshStandardMaterial({ color: '#f4f6f8', map: tex, roughness: 0.3, metalness: 0.35 });
    const tiers = [
      [3, 9],
      [2.3, 8],
      [1.7, 7],
      [1.1, 6],
      [0.55, 4],
    ];
    let y = 0;
    for (const [r, h] of tiers) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 6), sm);
      m.position.y = y + h / 2;
      m.castShadow = true;
      spire.add(m);
      y += h;
    }
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.3, 7, 6), new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.8, roughness: 0.2 }));
    needle.position.y = y + 3.5;
    spire.add(needle);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3355').multiplyScalar(5) }));
    top.position.y = y + 7.2;
    spire.add(top);
    this.beacons.push(top);
    spire.position.set(66, 0, 31);
    spire.userData.nodeId = 'dubai_retail';
    this.root.add(spire);
    this.pickables.push(spire);
  }

  private buildAirport() {
    const runway = new THREE.Mesh(new THREE.BoxGeometry(44, 0.14, 4.6), new THREE.MeshStandardMaterial({ color: '#9ea39b', roughness: 0.9 }));
    runway.position.set(26, 0.07, 48.5);
    runway.receiveShadow = true;
    this.root.add(runway);
    const lightGeo = new THREE.BoxGeometry(0.35, 0.12, 0.35);
    const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fde68a').multiplyScalar(3) });
    const edges = new THREE.InstancedMesh(lightGeo, edgeMat, 46);
    let k = 0;
    for (let x = 5; x <= 47; x += 1.9) {
      for (const z of [46.4, 50.6]) {
        if (k >= 46) break;
        this.dummy.position.set(x, 0.18, z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        edges.setMatrixAt(k++, this.dummy.matrix);
      }
    }
    edges.count = k;
    this.root.add(edges);
    const terminal = new THREE.Mesh(
      new THREE.BoxGeometry(12, 3.4, 5),
      new THREE.MeshStandardMaterial({ color: '#e9ecee', roughness: 0.5, metalness: 0.2 }),
    );
    terminal.position.set(40, 1.7, 39);
    terminal.castShadow = true;
    this.root.add(terminal);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(12.1, 0.8, 5.1), new THREE.MeshStandardMaterial({ color: '#8fb5c9', roughness: 0.15, metalness: 0.4 }));
    glass.position.set(40, 2.4, 39);
    this.root.add(glass);

    // cargo plane (lands when air freight is used)
    this.plane = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 9, 10), new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.4, metalness: 0.3 }));
    body.rotation.z = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 10), new THREE.MeshStandardMaterial({ color: '#cbd5e1' }));
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.15), new THREE.MeshStandardMaterial({ color: '#0f8f80' }));
    tail.position.set(-4, 1, 0);
    const navL = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3355').multiplyScalar(5) }));
    navL.position.set(0, 0, -5);
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#34d399').multiplyScalar(5) }));
    navR.position.set(0, 0, 5);
    this.plane.add(body, wing, tail, navL, navR);
    this.plane.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.plane.visible = false;
    this.root.add(this.plane);

    this.addNode('airport', [30, 40], 7, 'Al Maktoum Airport', 6, 'portal');
  }

  private buildPortals() {
    for (const p of PORTALS) {
      const pos = ROAD_NODES[p.node];
      const gate = new THREE.Group();
      const pylonMat = new THREE.MeshStandardMaterial({ color: '#9aa09a', metalness: 0.3, roughness: 0.5 });
      const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#22d3ee').multiplyScalar(2.6) });
      for (const s of [-1, 1]) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6), pylonMat);
        pylon.position.set(s * 3, 2.5, 0);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.4, 0.62), glow);
        strip.position.set(s * 3, 2.5, 0);
        gate.add(pylon, strip);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.4, 0.6), glow);
      bar.position.y = 5;
      gate.add(bar);
      gate.position.set(pos[0], 0, pos[1]);
      gate.rotation.y = p.rot;
      this.root.add(gate);
      this.addNode(p.id, pos, 5, p.title, 7, 'portal', p.sub);
    }
  }

  private buildTrees() {
    const parts = modelParts('tree_round');
    const spots: P[] = [];
    for (let x = -16; x <= 80; x += 6) {
      if (Math.abs(x - 32) < 3 || Math.abs(x - 60) < 3 || Math.abs(x) < 3) continue;
      spots.push([x, 3.6]);
      if (x > 6 && x < 28) spots.push([x, -3.6]);
    }
    for (let z = -44; z <= 46; z += 7) {
      if (Math.abs(z) < 4 || Math.abs(z - 22) < 4 || Math.abs(z + 20) < 4) continue;
      spots.push([4, z]);
    }
    const ok = spots.filter(([x, z]) => !(x > 46 && z > 16) && !(x > 22 && x < 44 && z > -26 && z < -6) && !(x > -14 && x < 14 && z > 25 && z < 42) && !(z > 44));
    for (const p of parts) {
      const inst = new THREE.InstancedMesh(p.geometry, p.material, ok.length);
      ok.forEach(([x, z], i) => {
        this.dummy.position.set(x, 0, z);
        this.dummy.rotation.set(0, (x * 13 + z * 7) % 6, 0);
        this.dummy.scale.setScalar(0.75 + ((x * 3 + z) % 5) * 0.06);
        this.dummy.updateMatrix();
        inst.setMatrixAt(i, this.dummy.matrix);
      });
      inst.castShadow = true;
      this.root.add(inst);
    }
  }

  private routeRibbon(id: string, path: P[], tone: Tone, width = 1.1, y = 0.22) {
    const mat = flowMaterial(tone, { speed: 0.4, dashes: Math.max(3, Math.round(this.lengthOf(path) / 9)) });
    const mesh = new THREE.Mesh(ribbon(roundCorners(path, 2.4), width, y), mat);
    mesh.renderOrder = 2;
    this.root.add(mesh);
    this.routes[id] = { mesh, mat };
  }

  private lengthOf(path: P[]) {
    let n = 0;
    for (let i = 1; i < path.length; i++) n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    return n;
  }

  private buildRoutes() {
    for (const dc of DCS) {
      const dock = ROAD_NODES[DOCK_OF[dc.id]];
      const start = new THREE.Vector3(-37, 0.5, dc.id === 'dubai_south' ? 8 : dc.id === 'al_quoz' ? -3 : -10);
      const end = new THREE.Vector3(dock[0], 2, dock[1]);
      const height = 10 + start.distanceTo(end) * 0.12;
      const pts = arcPoints(start, end, height, 64);
      const mat = flowMaterial('normal', { speed: 0.5, dashes: 5 });
      mat.uniforms.uIntensity.value = 1.5;
      const core = tube(pts, 0.42, mat, 160);
      const haloMat = flowMaterial('normal', { speed: 0.5, dashes: 5, opacity: 0.35 });
      haloMat.uniforms.uIntensity.value = 0.5;
      const halo = tube(pts, 1.6, haloMat, 160);
      core.add(halo);
      core.renderOrder = 4;
      this.root.add(core);
      this.routes[`port>${dc.id}`] = { mesh: core, mat };
      this.routes[`halo>${dc.id}`] = { mesh: halo, mat: haloMat };
      this.routeRibbon(`fuj>${dc.id}`, pathBetween('fujairah', dc.id), 'recovery', 0.8, 0.3);
      this.routeRibbon(`reg>${dc.id}`, pathBetween('regional', dc.id), 'recovery', 0.8, 0.34);
    }
    this.routeRibbon('air>dubai_south', pathBetween('airport', 'dubai_south'), 'recovery', 0.8, 0.3);
    this.routeRibbon('reb>al_quoz>dubai_south', pathBetween('al_quoz', 'dubai_south'), 'recovery', 0.7, 0.38);
    this.routeRibbon('reb>al_quoz>sharjah', pathBetween('al_quoz', 'sharjah'), 'recovery', 0.7, 0.38);
    for (const c of CUSTOMERS) {
      const mat = flowMaterial('normal', { speed: 0.25, dashes: 4, opacity: 0.45 });
      mat.uniforms.uIntensity.value = 0.9;
      const path = pathBetween(c.dc, c.id);
      const mesh = new THREE.Mesh(ribbon(roundCorners(path, 2), 0.5, 0.18), mat);
      this.root.add(mesh);
      this.routes[`cust>${c.id}`] = { mesh, mat };
    }
    // inbound sea lane: ships arrive from the open sea
    const laneMat = flowMaterial('normal', { speed: 0.3, dashes: 6 });
    const lanePts = Array.from({ length: 40 }, (_, i) => v3(bez(SEA_IN, [-62, 0], [-52, 0], i / 39), 0.1));
    const lane = tube(lanePts, 0.16, laneMat);
    this.root.add(lane);
    this.routes.sea = { mesh: lane, mat: laneMat };
  }

  private buildFleet() {
    const parts = modelParts('truck');
    const MAX = 140;
    for (const p of parts) {
      const mat = p.tinted ? (p.material as THREE.MeshStandardMaterial).clone() : p.material;
      const inst = new THREE.InstancedMesh(p.geometry, mat, MAX);
      inst.count = 0;
      inst.castShadow = true;
      inst.frustumCulled = false;
      if (p.tinted) {
        (mat as THREE.MeshStandardMaterial).color.set('#ffffff');
        (mat as THREE.MeshStandardMaterial).emissive.set('#ffffff');
        (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.0;
        for (let i = 0; i < MAX; i++) inst.setColorAt(i, TRUCK_COLOR);
        this.truckTint = inst;
      }
      this.root.add(inst);
      this.truckParts.push(inst);
    }
  }

  private buildEffects() {
    const mat = ringMaterial('down');
    mat.uniforms.uIntensity.value = 2.6;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    ring.visible = false;
    ring.renderOrder = 3;
    this.root.add(ring);
    const beamMat = beamMaterial('down');
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 36, 24, 1, true), beamMat);
    beam.geometry.translate(0, 18, 0);
    beam.visible = false;
    this.root.add(beam);
    const l = label('', '', 'incident');
    this.root.add(l.obj);
    l.show(false);
    this.incident = { ring, mat, beam, beamMat, label: l };

    // red shield over a shut port
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(22, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#dc2626'), transparent: true, opacity: 0.22, depthWrite: false, wireframe: true }),
    );
    this.dome.position.set(-38, 0, 0);
    this.dome.visible = false;
    this.root.add(this.dome);

    // dust for the sandstorm
    const n = 2600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = WEST + Math.random() * (86 - WEST);
      pos[i * 3 + 1] = Math.random() * 22;
      pos[i * 3 + 2] = -56 + Math.random() * 112;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: new THREE.Color('#c79a5c'), size: 0.55, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.dust.visible = false;
    this.root.add(this.dust);
  }

  private addNode(id: string, pos: P, radius: number, title: string, labelY: number, kind = 'node', sub = '') {
    const ringMat = ringMaterial('normal');
    ringMat.uniforms.uPulse.value = 0;
    ringMat.uniforms.uIntensity.value = 1.2;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), ringMat);
    ring.visible = false;
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos[0], 0.12, pos[1]);
    ring.renderOrder = 1;
    this.root.add(ring);
    const l = label(title, sub, kind);
    l.obj.position.set(pos[0], labelY, pos[1]);
    l.el.dataset.node = id;
    this.root.add(l.obj);
    this.nodes[id] = { ring, ringMat, label: l };
  }

  // ---------------------------------------------------------------- update
  update(state: TwinState, dt: number) {
    const run = state.run;
    const h = state.hour;
    const t = sharedTime.value;
    for (const b of this.beacons) (b.material as THREE.MeshBasicMaterial).color.setScalar(Math.sin(t * 2.4) > 0.2 ? 4 : 0.2).multiply(new THREE.Color('#ff3355'));

    const disruption = run?.options.disruption ?? null;
    const factor = run?.options.durationFactor ?? 1;
    const active = !!disruption && h >= disruption.startHour && h < disruption.startHour + disruption.durationHours * factor;
    const levers = new Set(run?.options.levers ?? []);
    const acting = levers.size > 0 && h >= (run?.options.actHour ?? disruption?.startHour ?? 0);

    if (run) {
      this.updateShips(run, h, dt);
      this.updateTrucks(run, h);
      this.updateYard(run, h);
      this.updateCranes(run, h, t);
      this.updatePlane(run, h, levers.has('air_freight'));
    }

    this.updateRoutes(state, active, acting, levers);
    this.updateEffects(state, active, t, dt);

    this.labelTimer -= dt;
    if (this.labelTimer <= 0) {
      this.labelTimer = 0.2;
      this.updateNodes(state, run, h, active);
    }
  }

  /** Where a ship is at hour h: sailing in along a curve, at anchor, at the berth or sailing out. */
  private vesselPose(v: VesselTrack, h: number, queueIndex: number): ShipPose | null {
    if (v.port !== 'jebel_ali') return null;
    const approach = 14;
    const berthIdx = v.berthHour !== null ? (Number(v.id.split('-').pop()) + v.origin.length) % 2 : 0;
    const berth = BERTHS[berthIdx];
    const anchor = ANCHORAGE[queueIndex % ANCHORAGE.length];
    if (h < v.eta - approach) return null;
    if (h < v.eta) {
      // ease out: slow down as it nears the berth or anchorage
      const f = (h - (v.eta - approach)) / approach;
      const e = 1 - (1 - f) ** 2;
      const toBerth = v.berthHour !== null && v.berthHour <= v.eta + 1;
      const target = toBerth ? berth : anchor;
      // berths are approached side-on from the channel, anchorages straight down it
      const ctrl: P = toBerth ? [-61, target[1]] : [(SEA_IN[0] + target[0]) / 2, (SEA_IN[1] + target[1]) / 2];
      return { p: bez(SEA_IN, ctrl, target, e), heading: bezHeading(SEA_IN, ctrl, target, Math.min(e, 0.98)), frac: 0, opacity: Math.min(1, f / 0.12) };
    }
    if (v.berthHour === null || h < v.berthHour) return { p: anchor, heading: Math.PI / 2 + 0.3 * Math.sin(queueIndex), frac: 0, opacity: 1 };
    const done = v.doneHour ?? v.berthHour + 10;
    if (h < done) return { p: berth, heading: Math.PI / 2, frac: (h - v.berthHour) / Math.max(1, done - v.berthHour), opacity: 1 };
    if (h < done + 12) {
      // ease in: pull away gently, then pick up speed down the channel
      const f = (h - done) / 12;
      const e = f * f;
      const ctrl: P = [-62, berth[1] + 10];
      return { p: bez(berth, ctrl, SEA_OUT, e), heading: bezHeading(berth, ctrl, SEA_OUT, Math.max(e, 0.02)), frac: 1, opacity: Math.min(1, (1 - f) / 0.15) };
    }
    return null;
  }

  private updateShips(run: SimRun, h: number, dt: number) {
    const seen = new Set<string>();
    let q = 0;
    for (const v of run.vessels) {
      const waiting = v.port === 'jebel_ali' && h >= v.eta && (v.berthHour === null || h < v.berthHour);
      const pose = this.vesselPose(v, h, q);
      if (waiting) q++;
      if (!pose) continue;
      // each vessel keeps the same ship model while it is on the board
      let ship = this.ships.find((x) => x.vesselId === v.id);
      const fresh = !ship;
      if (!ship) ship = this.ships.find((x) => !x.vesselId);
      if (!ship) continue;
      ship.vesselId = v.id;
      seen.add(v.id);

      // glide towards the pose so a change of plan (anchor to berth) looks like sailing;
      // a big jump (scrubbing the timeline) snaps
      const dx = pose.p[0] - ship.x;
      const dz = pose.p[1] - ship.z;
      const far = Math.hypot(dx, dz);
      if (fresh || far > 40) {
        ship.x = pose.p[0];
        ship.z = pose.p[1];
        ship.heading = pose.heading;
      } else {
        const k = 1 - Math.exp(-dt * 4);
        ship.x = lerp(ship.x, pose.p[0], k);
        ship.z = lerp(ship.z, pose.p[1], k);
        // point the bow where it is going while it moves, then settle on the pose heading
        const want = far > 1.5 ? Math.atan2(dx, dz) : pose.heading;
        ship.heading += turn(ship.heading, want) * (1 - Math.exp(-dt * 3));
      }
      const g = ship.group;
      g.visible = true;
      g.position.set(ship.x, -0.75 + Math.sin(sharedTime.value * 0.8 + v.eta) * 0.08, ship.z);
      g.rotation.y = ship.heading;
      const fade = pose.opacity < 0.999;
      for (const m of ship.mats) {
        if (m.transparent !== fade) {
          m.transparent = fade;
          m.depthWrite = !fade;
          m.needsUpdate = true;
        }
        m.opacity = pose.opacity;
      }
      ship.label.el.style.opacity = String(pose.opacity);
      // cargo bays empty out as the cranes work
      const left = Math.ceil((1 - pose.frac) * ship.bays.length);
      ship.bays.forEach((bay, i) => (bay.visible = i < left));
      const status = waiting ? (h - v.eta > 24 ? 'waiting ' + Math.round((h - v.eta) / 24) + 'd at anchor' : 'at anchor') : pose.frac > 0 && pose.frac < 1 ? 'unloading' : pose.frac >= 1 ? 'leaving' : 'arriving';
      ship.label.set(v.name, status, waiting && h - v.eta > 24 ? 'risk' : 'normal');
    }
    for (const x of this.ships) {
      if (x.vesselId && seen.has(x.vesselId)) continue;
      x.vesselId = null;
      x.group.visible = false;
    }
  }

  private updateTrucks(run: SimRun, h: number) {
    let n = 0;
    const max = this.truckParts[0]?.instanceMatrix.count ?? 0;
    for (const trip of run.trips) {
      if (n >= max) break;
      if (h < trip.depart || h >= trip.arrive) continue;
      const path = pathBetween(trip.from, trip.to);
      const f = (h - trip.depart) / Math.max(0.1, trip.arrive - trip.depart);
      const p = along(path, f);
      // drive on the right-hand side of the road
      const side = 0.8;
      this.dummy.position.set(p.x + Math.cos(p.angle) * side, 0.12, p.z - Math.sin(p.angle) * side);
      this.dummy.rotation.set(0, p.angle - Math.PI / 2, 0);
      this.dummy.scale.setScalar(0.9);
      this.dummy.updateMatrix();
      for (const inst of this.truckParts) inst.setMatrixAt(n, this.dummy.matrix);
      this.truckTint?.setColorAt(n, trip.recovery ? PALETTE.green : TRUCK_COLOR);
      n++;
    }
    for (const inst of this.truckParts) {
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  }

  private updateYard(run: SimRun, h: number) {
    const s = run.stockSeries.jebel_ali;
    if (!s) return;
    const i = Math.min(s.length - 1, Math.max(0, Math.floor(h)));
    let daily = 0;
    for (const dc of DCS) for (const k of SKU_IDS) daily += dcDailyDemand(dc.id, k);
    const fill = Math.min(1, s[i] / (daily * 1.6));
    this.yard.count = Math.round(this.yardMax * (0.18 + 0.82 * fill));
  }

  private updateCranes(run: SimRun, h: number, t: number) {
    const busy = [false, false];
    for (const v of run.vessels) {
      if (v.port !== 'jebel_ali' || v.berthHour === null) continue;
      const done = v.doneHour ?? v.berthHour + 10;
      if (h >= v.berthHour && h < done) busy[(Number(v.id.split('-').pop()) + v.origin.length) % 2] = true;
    }
    this.craneLifts.forEach(({ box, berth }) => {
      box.visible = busy[berth];
      if (!busy[berth]) return;
      const cycle = (t * 0.35 + berth * 0.5) % 1;
      const z = BERTHS[berth][1] + (berth ? -1.5 : 1.5);
      // ship -> up -> along the boom -> down onto the quay
      let x: number;
      let y: number;
      if (cycle < 0.25) {
        x = -49.5;
        y = 2 + (cycle / 0.25) * 9;
      } else if (cycle < 0.6) {
        x = -49.5 + ((cycle - 0.25) / 0.35) * 12;
        y = 11;
      } else if (cycle < 0.85) {
        x = -37.5;
        y = 11 - ((cycle - 0.6) / 0.25) * 10;
      } else {
        x = -37.5;
        y = 1;
      }
      box.position.set(x, y, z);
    });
  }

  private updatePlane(run: SimRun, h: number, on: boolean) {
    const landing = on && run.trips.find((tr) => tr.from === 'airport' && h >= tr.depart - 3 && h < tr.depart + 0.5);
    this.plane.visible = !!landing;
    if (!landing) return;
    const f = Math.min(1, (h - (landing.depart - 3)) / 3);
    // glide in from the east and roll down the runway
    const x = 70 - f * 52;
    const y = Math.max(0.9, 14 * (1 - f) ** 1.6);
    this.plane.position.set(x, y, 48.5);
    this.plane.rotation.set(0, Math.PI, f < 0.8 ? 0.06 : 0);
  }

  private updateRoutes(state: TwinState, active: boolean, acting: boolean, levers: Set<string>) {
    const sc = state.scenario;
    const run = state.run;
    const h = state.hour;
    const black = new Set(state.phase === 'watch' ? state.blackRoutes.slice(0, 3).map((b) => b.scenario.id) : []);
    const show = (id: string, v: boolean) => {
      const r = this.routes[id];
      if (r) r.mesh.visible = v;
    };
    const tone = (id: string, t: Tone, opacity = 1) => {
      const r = this.routes[id];
      if (!r) return;
      setTone(r.mat, t);
      r.mat.uniforms.uOpacity.value = opacity;
    };

    const portDown = active && sc && (sc.kind === 'port_closure' || sc.kind === 'port_congestion');
    const seaDown = active && sc && (sc.kind === 'chokepoint' || sc.kind === 'supplier');
    tone('sea', seaDown ? 'down' : black.has('hormuz_closure') || black.has('red_sea') ? 'radar' : portDown ? 'risk' : 'normal');

    for (const dc of DCS) {
      let t: Tone = 'normal';
      if (portDown && sc?.kind === 'port_closure') t = 'down';
      else if (portDown) t = 'risk';
      if (active && sc?.kind === 'road_closure' && ((sc.target === 'e311' && dc.id === 'sharjah') || (sc.target === 'e11' && dc.id === 'al_quoz') || (sc.target === 'e77' && dc.id === 'dubai_south'))) t = 'down';
      if (active && sc?.kind === 'weather') t = 'risk';
      if (active && sc?.kind === 'dc_outage' && sc.target === dc.id) t = 'down';
      if (state.phase === 'watch' && black.has('jebel_ali_congestion')) t = 'radar';
      tone(`port>${dc.id}`, t);
      tone(`halo>${dc.id}`, t, 0.35);

      const fuj = levers.has('divert_fujairah') && acting && !!run?.trips.some((tr) => tr.from === 'fujairah' && tr.to === dc.id && h >= tr.depart - 6 && h < tr.arrive + 6);
      show(`fuj>${dc.id}`, fuj);
      const reg = levers.has('regional_buy') && acting && !!run?.trips.some((tr) => tr.from === 'regional' && tr.to === dc.id && h >= tr.depart - 6 && h < tr.arrive + 6);
      show(`reg>${dc.id}`, reg);
    }
    show('air>dubai_south', levers.has('air_freight') && acting && !!run?.trips.some((tr) => tr.from === 'airport' && h >= tr.depart - 4 && h < tr.arrive + 4));
    show('reb>al_quoz>dubai_south', levers.has('rebalance') && acting && !!run?.trips.some((tr) => tr.from === 'al_quoz' && tr.to === 'dubai_south' && h >= tr.depart - 3 && h < tr.arrive + 3));
    show('reb>al_quoz>sharjah', levers.has('rebalance') && acting && !!run?.trips.some((tr) => tr.from === 'al_quoz' && tr.to === 'sharjah' && h >= tr.depart - 3 && h < tr.arrive + 3));

    for (const c of CUSTOMERS) {
      const b = run?.backlogSeries[c.id];
      const open = b ? b[Math.min(b.length - 1, Math.max(0, Math.floor(h)))] : 0;
      const demand = c.demand.ELEC + c.demand.AUTO + c.demand.FMCG;
      tone(`cust>${c.id}`, open > demand * 1.2 ? 'down' : open > demand * 0.35 ? 'risk' : 'normal', 0.45);
    }
  }

  private incidentSpot(state: TwinState): { p: P; r: number; text: string; sub: string } | null {
    const sc = state.scenario;
    if (!sc) return null;
    switch (sc.kind) {
      case 'chokepoint':
      case 'supplier':
        return { p: [-56, -6], r: 14, text: sc.title, sub: 'Ships on this lane are held at sea' };
      case 'port_closure':
      case 'port_congestion':
        return { p: [-34, 0], r: 26, text: sc.title, sub: sc.summary };
      case 'dc_outage': {
        const d = DC_POS[sc.target];
        return d ? { p: d.pos, r: 18, text: sc.title, sub: 'No stock in or out' } : null;
      }
      case 'road_closure':
        return { p: [60, -10], r: 12, text: sc.title, sub: 'Trucks take a long detour' };
      case 'weather':
        return { p: [10, 0], r: 60, text: sc.title, sub: sc.summary };
    }
  }

  private updateEffects(state: TwinState, active: boolean, t: number, dt: number) {
    const sc = state.scenario;
    const spot = active ? this.incidentSpot(state) : null;
    const { ring, beam, label: l } = this.incident;
    ring.visible = !!spot;
    beam.visible = !!spot && sc?.kind !== 'weather';
    l.show(!!spot);
    if (spot) {
      ring.position.set(spot.p[0], 0.45, spot.p[1]);
      ring.scale.setScalar(spot.r * 2);
      beam.position.set(spot.p[0], 0, spot.p[1]);
      l.obj.position.set(spot.p[0], sc?.kind === 'weather' ? 26 : 30, spot.p[1]);
      l.set(spot.text, spot.sub, 'down');
    }
    this.dome.visible = active && sc?.kind === 'port_closure';
    if (this.dome.visible) this.dome.rotation.y += dt * 0.15;

    const storm = active && sc?.kind === 'weather';
    this.dust.visible = storm;
    if (storm) {
      const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + dt * (9 + (i % 7));
        if (x > 86) x = WEST;
        pos.setX(i, x);
        pos.setY(i, (pos.getY(i) + Math.sin(t + i) * dt * 0.6 + 22) % 22);
      }
      pos.needsUpdate = true;
    }
    (this.grid.uniforms.uColor.value as THREE.Color).set(storm ? '#b7791f' : '#6b7268');

    // road closure barriers on the E311
    const roadShut = active && sc?.kind === 'road_closure';
    if (roadShut && !this.barriers.length) {
      for (const z of [-6, -10]) {
        const b = model('barrier');
        b.position.set(60, 0, z);
        b.rotation.y = 0;
        b.scale.setScalar(0.8);
        this.root.add(b);
        this.barriers.push(b);
      }
    }
    for (const b of this.barriers) b.visible = roadShut;

    // power cut at a DC: its windows go dark
    for (const [id, g] of Object.entries(this.dcGroups)) {
      const off = active && sc?.kind === 'dc_outage' && sc.target === id;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (off && mat.emissiveIntensity > 0 && !this.dcOff.has(m)) {
          this.dcOff.set(m, mat);
          const dark = mat.clone();
          dark.emissiveIntensity = 0.02;
          m.material = dark;
        } else if (!off && this.dcOff.has(m)) {
          (m.material as THREE.Material).dispose();
          m.material = this.dcOff.get(m)!;
          this.dcOff.delete(m);
        }
      });
    }
  }

  /** Rings only appear when a node needs attention (or is selected). */
  private ringTone(n: NodeView, tone: Tone) {
    n.ring.visible = tone !== 'normal' && tone !== 'muted';
    setTone(n.ringMat, tone);
    n.ringMat.uniforms.uPulse.value = tone === 'radar' ? 0.4 : 1;
  }

  private updateNodes(state: TwinState, run: SimRun | null, h: number, active: boolean) {
    const hi = Math.max(0, Math.floor(h));
    const focus = state.focus;
    for (const dc of DCS) {
      const n = this.nodes[dc.id];
      let minCover = Infinity;
      const bars = SKU_IDS.map((s) => {
        const series = run?.skuSeries[dc.id]?.[s];
        const stock = series ? series[Math.min(series.length - 1, hi)] : dcDailyDemand(dc.id, s) * 2.5;
        const days = stock / Math.max(1, dcDailyDemand(dc.id, s));
        minCover = Math.min(minCover, days);
        return { label: SKU_SHORT[s], value: days / 4, text: `${days.toFixed(1)}d`, color: SKU_COLOR[s], days };
      });
      // a normal dip between deliveries is not an alert; only flag it when customers feel it
      const late = CUSTOMERS.some((c) => {
        if (c.dc !== dc.id) return false;
        const b = run?.backlogSeries[c.id];
        const open = b ? b[Math.min(b.length - 1, hi)] : 0;
        return open > (c.demand.ELEC + c.demand.AUTO + c.demand.FMCG) * 0.35;
      });
      const out = active && state.scenario?.kind === 'dc_outage' && state.scenario.target === dc.id;
      const tone: Tone = out || (late && minCover < 0.15) ? 'down' : (active || late) && minCover < 0.6 ? 'risk' : 'normal';
      for (const b of bars) if (tone !== 'normal' && b.days < 0.6) b.color = b.days < 0.15 ? '#dc2626' : '#d97706';
      this.ringTone(n, focus === dc.id ? 'radar' : tone);
      n.panel?.set(dc.name, out ? 'offline · no stock in or out' : tone === 'down' ? 'out of stock' : tone === 'risk' ? 'running low' : 'days of stock', tone);
      n.panel?.setBars(bars);
    }

    // port
    const port = this.nodes.jebel_ali;
    if (run) {
      const waiting = run.vessels.filter((v) => v.port === 'jebel_ali' && h >= v.eta && (v.berthHour === null || h < v.berthHour)).length;
      const unloading = run.vessels.filter((v) => v.port === 'jebel_ali' && v.berthHour !== null && h >= v.berthHour && h < (v.doneHour ?? v.berthHour + 10)).length;
      const sc = state.scenario;
      const shut = active && sc?.kind === 'port_closure';
      const jam = active && sc?.kind === 'port_congestion';
      const tone: Tone = shut ? 'down' : jam || waiting > 1 ? 'risk' : 'normal';
      port.label.set('Jebel Ali Port', shut ? 'terminal shut' : `${unloading} unloading · ${waiting} waiting`, tone);
      this.ringTone(port, focus === 'jebel_ali' ? 'radar' : tone);
    }

    for (const c of CUSTOMERS) {
      const n = this.nodes[c.id];
      const b = run?.backlogSeries[c.id];
      const open = b ? b[Math.min(b.length - 1, hi)] : 0;
      const demand = c.demand.ELEC + c.demand.AUTO + c.demand.FMCG;
      const tone: Tone = open > demand * 1.2 ? 'down' : open > demand * 0.35 ? 'risk' : 'normal';
      n.label.set(c.name, tone === 'normal' ? '' : `${Math.round(open)} pallets waiting`, tone);
      // edge customers only speak up when something is wrong
      if (c.id === 'northern' || c.id === 'abu_dhabi') n.label.show(tone !== 'normal' || focus === c.id);
      this.ringTone(n, focus === c.id ? 'radar' : tone);
    }

    // portals light up when a recovery route uses them
    const levers = new Set(run?.options.levers ?? []);
    const usedFuj = levers.has('divert_fujairah') && !!run?.vessels.some((v) => v.port === 'fujairah');
    this.nodes.fujairah.label.set('Fujairah Port', usedFuj ? 'ships diverted here' : 'East coast · outside Hormuz', usedFuj ? 'recovery' : 'muted');
    this.nodes.fujairah.label.show(usedFuj);
    this.ringTone(this.nodes.fujairah, usedFuj ? 'recovery' : 'muted');
    const usedReg = levers.has('regional_buy');
    this.nodes.regional.label.set('Abu Dhabi · Saudi road', usedReg ? 'regional suppliers' : 'E11 to the south-west', usedReg ? 'recovery' : 'muted');
    this.nodes.regional.label.show(usedReg);
    this.ringTone(this.nodes.regional, usedReg ? 'recovery' : 'muted');
    const usedAir = levers.has('air_freight');
    this.nodes.airport.label.set('Al Maktoum Airport', usedAir ? 'air cargo landing' : 'cargo terminal', usedAir ? 'recovery' : 'muted');
    this.nodes.airport.label.show(usedAir || state.phase === 'watch');
    this.ringTone(this.nodes.airport, usedAir ? 'recovery' : 'muted');
    this.nodes.north_portal.label.show(false);
    this.ringTone(this.nodes.north_portal, 'muted');
  }

  dispose() {
    disposeTree(this.root);
  }
}

export const LOCAL_FOCUS_POINTS: Record<string, P> = {
  jebel_ali: [-30, 0],
  ...Object.fromEntries(Object.entries(DC_POS).map(([k, v]) => [k, v.pos])),
  ...CUSTOMER_POS,
};
