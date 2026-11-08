// The global corridor: the real sea lanes from Europe and Asia into the UAE,
// the chokepoints they squeeze through, and every ship of the simulator run
// moving along them (held at a closed strait, or rerouted round Africa).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import { CAPE_LANE, CHOKEPOINTS, CHOKEPOINT_BY_ID, ORIGINS, ORIGIN_BY_ID } from '../core/network';
import type { GeoPoint, SimRun, VesselTrack } from '../core/types';
import { disposeTree, label, tube, type Label } from './builders';
import { PALETTE, beamMaterial, flowMaterial, ringMaterial, setTone, waterMaterial, type Tone } from './materials';
import type { Board, TwinState } from './types';

const LON0 = -22;
const LON1 = 128;
const LAT0 = -40;
const LAT1 = 58;
const W = 176;
const H = (W * (LAT1 - LAT0)) / (LON1 - LON0);

export function project(g: GeoPoint, y = 0): THREE.Vector3 {
  const x = ((g.lon - LON0) / (LON1 - LON0) - 0.5) * W;
  const z = (0.5 - (g.lat - LAT0) / (LAT1 - LAT0)) * H;
  return new THREE.Vector3(x, y, z);
}

interface LaneView {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  curve: THREE.CatmullRomCurve3;
}

const FUJAIRAH: GeoPoint = { lat: 25.17, lon: 56.36 };
const CHOKE_LABEL_OFFSET: Record<string, [number, number]> = { hormuz: [-2, -6], malacca: [-4, -4], suez: [-3, -3], bab_el_mandeb: [-3, 2] };
const ORIGIN_LABEL_OFFSET: Record<string, [number, number]> = { singapore: [5, 5], mundra: [4, -2], shanghai: [0, -3], rotterdam: [0, -3] };

export class GlobalBoard implements Board {
  readonly root = new THREE.Group();
  pickables: THREE.Object3D[] = [];
  private lanes: Record<string, LaneView> = {};
  private cape!: LaneView;
  private choke: Record<string, { ring: THREE.Mesh; ringMat: THREE.ShaderMaterial; label: Label; pin: THREE.Mesh; beam: THREE.Mesh; beamMat: THREE.ShaderMaterial }> = {};
  private ships!: THREE.InstancedMesh;
  private shipTops!: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private originLabels: Label[] = [];
  private uae!: Label;
  private capeLabel!: Label;
  private labelTimer = 0;

  constructor() {
    this.buildBoard();
    this.buildLanes();
    this.buildMarkers();
    this.buildShips();
  }

  private buildBoard() {
    const slab = new THREE.Mesh(new RoundedBoxGeometry(W + 6, 7, H + 6, 6, 2.2), new THREE.MeshStandardMaterial({ color: '#717b88', roughness: 0.7, metalness: 0.25 }));
    slab.position.y = -4.6;
    slab.castShadow = true;
    this.root.add(slab);

    const water = waterMaterial();
    water.uniforms.uQuayX.value = 999; // no quay glow on the open ocean
    water.uniforms.uTrace.value = 0.45;
    water.uniforms.uTraceScale.value = 2.6;
    water.uniforms.uDeep.value = new THREE.Color('#0d4650');
    water.uniforms.uShallow.value = new THREE.Color('#0f5f62');
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(W, H), water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.9;
    this.root.add(sea);

    // land from Natural Earth (via world-atlas), drawn into a texture
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = Math.round((2048 * H) / W);
    const g = canvas.getContext('2d')!;
    const land = feature(landTopo as unknown as Topology, (landTopo as unknown as Topology).objects.land) as unknown as GeoJSON.FeatureCollection;
    const px = (lon: number) => ((lon - LON0) / (LON1 - LON0)) * canvas.width;
    const py = (lat: number) => (1 - (lat - LAT0) / (LAT1 - LAT0)) * canvas.height;
    g.fillStyle = '#4b5460';
    g.strokeStyle = '#8a95a3';
    g.lineWidth = 2.2;
    const drawRing = (raw: number[][]) => {
      // unwrap longitudes so shapes crossing the date line (Fiji, Russia's far east)
      // stay in one piece instead of streaking across the map
      const ring: number[][] = [];
      let shift = 0;
      raw.forEach(([lon, lat], k) => {
        if (k) {
          const d = lon + shift - ring[k - 1][0];
          if (d > 180) shift -= 360;
          else if (d < -180) shift += 360;
        }
        ring.push([lon + shift, lat]);
      });
      // re-centre the whole shape so most of it lands in -180..180
      const lons = ring.map(([lon]) => lon).sort((x, y) => x - y);
      const centre = -360 * Math.round(lons[Math.floor(lons.length / 2)] / 360);
      if (centre) for (const pt of ring) pt[0] += centre;
      if (ring.every(([lon]) => lon < LON0 - 15) || ring.every(([lon]) => lon > LON1 + 15)) return false;
      g.beginPath();
      ring.forEach(([lon, lat], i) => (i ? g.lineTo(px(lon), py(lat)) : g.moveTo(px(lon), py(lat))));
      g.closePath();
      return true;
    };
    for (const f of land.features) {
      const geom = f.geometry;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
      for (const poly of polys) {
        for (const ring of poly) {
          if (!drawRing(ring as number[][])) continue;
          g.fill();
          g.stroke();
        }
      }
    }
    // fine grid on land, like the local board
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(200,212,226,0.10)';
    g.lineWidth = 1;
    for (let lon = -20; lon <= 130; lon += 5) {
      g.beginPath();
      g.moveTo(px(lon), 0);
      g.lineTo(px(lon), canvas.height);
      g.stroke();
    }
    for (let lat = -40; lat <= 60; lat += 5) {
      g.beginPath();
      g.moveTo(0, py(lat));
      g.lineTo(canvas.width, py(lat));
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const landMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.9 }),
    );
    landMesh.rotation.x = -Math.PI / 2;
    landMesh.position.y = 0.02;
    landMesh.receiveShadow = true;
    this.root.add(landMesh);
    // a thin solid layer under the land texture gives the continents a little thickness
    const under = landMesh.clone();
    under.material = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, color: '#2c333d' });
    under.position.y = -0.5;
    this.root.add(under);
  }

  private laneCurve(points: GeoPoint[]): THREE.CatmullRomCurve3 {
    return new THREE.CatmullRomCurve3(points.map((p) => project(p, 0.5)), false, 'centripetal', 0.3);
  }

  private buildLanes() {
    for (const o of ORIGINS) {
      const curve = this.laneCurve(o.lane);
      const mat = flowMaterial('normal', { speed: 0.25, dashes: Math.round(curve.getLength() / 10) });
      mat.uniforms.uIntensity.value = 1.3;
      const mesh = tube(curve.getPoints(200), 0.32, mat, 240);
      this.root.add(mesh);
      this.lanes[o.id] = { mesh, mat, curve };
    }
    const capeCurve = this.laneCurve(CAPE_LANE);
    const capeMat = flowMaterial('recovery', { speed: 0.25, dashes: 18 });
    const capeMesh = tube(capeCurve.getPoints(200), 0.3, capeMat, 240);
    capeMesh.visible = false;
    this.root.add(capeMesh);
    this.cape = { mesh: capeMesh, mat: capeMat, curve: capeCurve };
  }

  private buildMarkers() {
    for (const c of CHOKEPOINTS) {
      const p = project(c.geo);
      const ringMat = ringMaterial('normal');
      ringMat.uniforms.uPulse.value = 0.3;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.6, p.z);
      this.root.add(ring);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4, 8), new THREE.MeshStandardMaterial({ color: '#e2e8f0', emissive: '#5eead4', emissiveIntensity: 0.6 }));
      pin.position.set(p.x, 2, p.z);
      pin.userData.nodeId = c.id;
      this.root.add(pin);
      this.pickables.push(pin);
      const beamMat = beamMaterial('down');
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 26, 20, 1, true), beamMat);
      beam.geometry.translate(0, 13, 0);
      beam.position.set(p.x, 0, p.z);
      beam.visible = false;
      this.root.add(beam);
      const l = label(c.name, '', 'chokepoint');
      const off = CHOKE_LABEL_OFFSET[c.id] ?? [0, 0];
      l.obj.position.set(p.x + off[0], 6, p.z + off[1]);
      this.root.add(l.obj);
      this.choke[c.id] = { ring, ringMat, label: l, pin, beam, beamMat };
    }
    for (const o of ORIGINS) {
      const p = project(o.geo);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshStandardMaterial({ color: '#f1f5f9', emissive: '#5eead4', emissiveIntensity: 0.5 }));
      dot.position.set(p.x, 0.8, p.z);
      this.root.add(dot);
      const l = label(o.name, o.country, 'portal');
      const off = ORIGIN_LABEL_OFFSET[o.id] ?? [0, 0];
      l.obj.position.set(p.x + off[0], 4, p.z + off[1]);
      this.root.add(l.obj);
      this.originLabels.push(l);
    }
    // the UAE: destination
    const uae = project({ lat: 25.1, lon: 55.6 });
    const home = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1, 24), new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 0.9 }));
    home.position.set(uae.x, 0.6, uae.z);
    this.root.add(home);
    const homeRing = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), ringMaterial('risk'));
    (homeRing.material as THREE.ShaderMaterial).uniforms.uPulse.value = 0.6;
    homeRing.rotation.x = -Math.PI / 2;
    homeRing.position.set(uae.x, 0.65, uae.z);
    this.root.add(homeRing);
    this.uae = label('UAE · Jebel Ali', 'Falcon Distribution', 'node');
    this.uae.obj.position.set(uae.x + 3, 5, uae.z + 7);
    this.root.add(this.uae.obj);
    const cape = project({ lat: -34.36, lon: 18.47 });
    this.capeLabel = label('Cape of Good Hope', 'the long way round', 'portal');
    this.capeLabel.obj.position.set(cape.x, 4, cape.z);
    this.capeLabel.show(false);
    this.root.add(this.capeLabel.obj);
  }

  private buildShips() {
    // a tiny low-poly freighter: hull + bridge, instanced
    const hull = new THREE.BoxGeometry(5.2, 1.0, 1.8);
    hull.translate(0, 0.5, 0);
    const top = new THREE.BoxGeometry(1.1, 1.2, 1.5);
    top.translate(-1.6, 1.6, 0);
    const MAX = 40;
    this.ships = new THREE.InstancedMesh(hull, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), MAX);
    this.shipTops = new THREE.InstancedMesh(top, new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.6 }), MAX);
    for (let i = 0; i < MAX; i++) this.ships.setColorAt(i, PALETTE.white);
    this.ships.count = 0;
    this.shipTops.count = 0;
    this.ships.castShadow = true;
    this.root.add(this.ships, this.shipTops);
  }

  /** Where a ship is at hour h, following the simulator's timeline. */
  private shipPose(v: VesselTrack, h: number): { p: THREE.Vector3; dir: THREE.Vector3; tone: 'ok' | 'held' | 'rerouted' } | null {
    const o = ORIGIN_BY_ID[v.origin];
    if (!o) return null;
    const transit = o.transitHours;
    const depart = v.plannedEta - transit;
    const delay = v.eta - v.plannedEta;
    if (h < depart || h > v.eta) return null;
    let progress: number;
    let tone: 'ok' | 'held' | 'rerouted' = 'ok';
    let curve = this.lanes[o.id].curve;
    if (v.rerouted && v.rerouted !== 'Fujairah' && o.id === 'rotterdam') {
      curve = this.cape.curve;
      progress = (h - depart) / Math.max(1, v.eta - depart);
      tone = 'rerouted';
    } else if (v.heldAt && CHOKEPOINT_BY_ID[v.heldAt]) {
      const leg = o.route.find((r) => r.chokepoint === v.heldAt);
      const holdStart = v.plannedEta - (leg?.hoursBeforeEta ?? 12);
      const holdEnd = holdStart + delay;
      const at = 1 - (leg?.hoursBeforeEta ?? 12) / transit;
      if (h < holdStart) progress = (h - depart) / transit;
      else if (h < holdEnd) {
        progress = at;
        tone = 'held';
      } else progress = (h - delay - depart) / transit;
    } else if (v.heldAt && ORIGIN_BY_ID[v.heldAt]) {
      // stuck in port at the origin
      if (h < depart + delay) {
        progress = 0;
        tone = 'held';
      } else progress = (h - depart - delay) / transit;
    } else {
      progress = (h - depart) / Math.max(1, v.eta - depart);
      if (v.rerouted === 'Fujairah') tone = 'rerouted';
    }
    progress = Math.min(1, Math.max(0, progress));
    const p = curve.getPointAt(progress);
    if (v.rerouted === 'Fujairah' && progress > 0.97) p.lerp(project(FUJAIRAH, 0.5), (progress - 0.97) / 0.03);
    const dir = curve.getTangentAt(Math.min(0.999, progress));
    return { p, dir, tone };
  }

  update(state: TwinState, dt: number) {
    const run = state.run;
    const h = state.hour;
    const sc = state.scenario;
    const d = run?.options.disruption ?? null;
    const factor = run?.options.durationFactor ?? 1;
    const active = !!d && h >= d.startHour && h < d.startHour + d.durationHours * factor;
    const levers = new Set(run?.options.levers ?? []);

    if (run) this.updateShips(run, h);

    // lanes: red if they pass a closed chokepoint, violet if they cross a top black route
    const black = new Set(state.phase === 'watch' ? state.blackRoutes.slice(0, 3).map((b) => b.scenario.target) : []);
    for (const o of ORIGINS) {
      const lane = this.lanes[o.id];
      let tone: Tone = 'normal';
      const passes = (id: string) => o.route.some((r) => r.chokepoint === id);
      if (active && sc?.kind === 'chokepoint' && passes(sc.target)) tone = 'down';
      if (active && sc?.kind === 'supplier' && sc.target === o.id) tone = 'down';
      if (state.phase === 'watch' && o.route.some((r) => black.has(r.chokepoint))) tone = 'radar';
      if (tone === 'down' && levers.has('divert_fujairah') && sc?.target === 'hormuz') tone = 'risk';
      setTone(lane.mat, tone);
    }
    this.cape.mesh.visible = levers.has('long_route') && !!run?.vessels.some((v) => v.rerouted === 'Cape of Good Hope');
    this.capeLabel.show(this.cape.mesh.visible);

    this.labelTimer -= dt;
    if (this.labelTimer > 0) return;
    this.labelTimer = 0.2;
    for (const c of CHOKEPOINTS) {
      const k = this.choke[c.id];
      const closed = active && sc?.kind === 'chokepoint' && sc.target === c.id;
      const radar = state.phase === 'watch' && black.has(c.id);
      const held = run ? run.vessels.filter((v) => v.heldAt === c.id && this.isHeldNow(v, h)).length : 0;
      const tone: Tone = closed ? 'down' : radar ? 'radar' : held ? 'risk' : 'normal';
      setTone(k.ringMat, tone);
      k.ringMat.uniforms.uPulse.value = tone === 'normal' ? 0.25 : 1;
      k.beam.visible = closed;
      const sub = closed ? `closed · ${held} ship${held === 1 ? '' : 's'} held` : radar ? 'black route' : held ? `${held} held` : '';
      k.label.set(c.name, sub, tone);
    }
    const sailing = run ? run.vessels.filter((v) => h >= v.plannedEta - (ORIGIN_BY_ID[v.origin]?.transitHours ?? 0) && h <= v.eta).length : 0;
    this.uae.set('UAE · Jebel Ali', `${sailing} ships inbound`, active && sc?.place === 'global' ? 'risk' : 'normal');
  }

  private isHeldNow(v: VesselTrack, h: number): boolean {
    const o = ORIGIN_BY_ID[v.origin];
    const leg = o?.route.find((r) => r.chokepoint === v.heldAt);
    if (!o || !leg) return false;
    const holdStart = v.plannedEta - leg.hoursBeforeEta;
    return h >= holdStart && h < holdStart + (v.eta - v.plannedEta);
  }

  private updateShips(run: SimRun, h: number) {
    let n = 0;
    const max = this.ships.instanceMatrix.count;
    const red = new THREE.Color('#f43f5e');
    const green = new THREE.Color('#4ade80');
    const white = new THREE.Color('#3d6fb8');
    for (const v of run.vessels) {
      if (n >= max) break;
      const pose = this.shipPose(v, h);
      if (!pose) continue;
      this.dummy.position.copy(pose.p);
      this.dummy.position.y = 0.2;
      if (pose.tone === 'held') {
        // fan held ships out around the strait so they read as a queue
        this.dummy.position.x += Math.sin(n * 2.4) * 2.2;
        this.dummy.position.z += Math.cos(n * 2.4) * 2.2;
      }
      this.dummy.rotation.set(0, Math.atan2(-pose.dir.z, pose.dir.x), 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.ships.setMatrixAt(n, this.dummy.matrix);
      this.shipTops.setMatrixAt(n, this.dummy.matrix);
      this.ships.setColorAt(n, pose.tone === 'held' ? red : pose.tone === 'rerouted' ? green : white);
      n++;
    }
    this.ships.count = n;
    this.shipTops.count = n;
    this.ships.instanceMatrix.needsUpdate = true;
    this.shipTops.instanceMatrix.needsUpdate = true;
    if (this.ships.instanceColor) this.ships.instanceColor.needsUpdate = true;
  }

  dispose() {
    disposeTree(this.root);
  }
}
