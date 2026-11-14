// Loads the low-poly model kit (public/models/kit.glb) and repaints it in the
// BlackRoute daylight look: a white architectural model with coloured cranes, ships and trucks. Each model is baked into one merged mesh per
// material so a clone costs a handful of draw calls.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Look = { color: string; rough?: number; metal?: number; emissive?: string; glow?: number };

const WALL: Look = { color: '#e9eae6', rough: 0.85 };
const ROOF: Look = { color: '#c9ccc6', rough: 0.8 };
const WARM_GLASS: Look = { color: '#9fb6c6', rough: 0.2, metal: 0.3 };
const COOL_GLASS: Look = { color: '#a7c2d2', rough: 0.15, metal: 0.4 };

/** Daylight palette: pale concrete and walls, glass in soft blue-grey, colour kept for the working parts. */
const LOOKS: Record<string, Look> = {
  Concrete: { color: '#d3d6cf', rough: 0.95 },
  Wall: WALL,
  HubCWall: WALL,
  ColdWall: { color: '#eef1f2', rough: 0.8 },
  SouthWall: { color: '#eceee9', rough: 0.85 },
  WallSand: { color: '#ece6da', rough: 0.85 },
  OfficeWall: WALL,
  HubCRib: { color: '#d3d7d2', rough: 0.6, metal: 0.2 },
  PanelLine: { color: '#c9cdc7', rough: 0.7 },
  SlateBand: { color: '#2b2f34' },
  Roof: ROOF,
  RoofFlat: ROOF,
  RoofSilver: { color: '#d5d9dc', rough: 0.45, metal: 0.4 },
  RoofSage: ROOF,
  RoofSand: ROOF,
  RoofLight: ROOF,
  TintRoof: ROOF,
  Solar: { color: '#3b5878', rough: 0.25, metal: 0.4 },
  SolarFrame: { color: '#c3c8cc', metal: 0.4 },
  Hvac: { color: '#c9cdd1', metal: 0.3 },
  Condenser: { color: '#c9cdd1', metal: 0.3 },
  Glass: WARM_GLASS,
  GlassWarm: WARM_GLASS,
  GlassBlue: COOL_GLASS,
  GlassTeal: COOL_GLASS,
  GlassSky: COOL_GLASS,
  GlassViolet: COOL_GLASS,
  GlassCab: COOL_GLASS,
  GlassDark: { color: '#5b6b78', rough: 0.2, metal: 0.4 },
  Door: { color: '#8a9096' },
  DoorLight: { color: '#9aa0a6' },
  Lamp: { color: '#f5f2ea' },
  Lantern: { color: '#f5f2ea' },
  Beacon: { color: '#ef4444', emissive: '#ef4444', glow: 0.6 },
  Brand: { color: '#1d4ed8' },
  Teal: { color: '#0f766e' },
  Canopy: { color: '#cfd3d6', metal: 0.3 },
  Bumper: { color: '#f59e0b' },
  Seal: { color: '#4b5157' },
  Dark: { color: '#5a6067', rough: 0.8 },
  Metal: { color: '#8a94a1', rough: 0.4, metal: 0.8 },
  White: { color: '#cfd6df', rough: 0.6 },
  Chimney: { color: '#7b8592', metal: 0.5 },
  // port and ship
  CraneBlue: { color: '#2f7cf6', rough: 0.4, metal: 0.35 },
  CraneWhite: { color: '#e8eef6', rough: 0.5, metal: 0.2 },
  PortBlue: { color: '#2563eb' },
  Radar: { color: '#cbd5e1', metal: 0.7 },
  Navy: { color: '#2b3a4f' },
  HullLow: { color: '#b4232f', rough: 0.6 },
  HullTop: { color: '#1f3b63', rough: 0.5, metal: 0.25 },
  Deck: { color: '#a3aab0' },
  Funnel: { color: '#d7dde5' },
  Bow: { color: '#1f3b63' },
  Box0: { color: '#e8793a', rough: 0.6 },
  Box3: { color: '#5aa3d8', rough: 0.6 },
  Box4: { color: '#3fb2a5', rough: 0.6 },
  Box5: { color: '#dfe7ef', rough: 0.6 },
  TintContainer: { color: '#ffffff', rough: 0.6 },
  TintCrate: { color: '#a07a44' },
  Pallet: { color: '#8b6b3e' },
  // vehicles
  TruckBody: { color: '#e5e9ef', rough: 0.5, metal: 0.2 },
  TruckCab: { color: '#f1f4f8', rough: 0.4, metal: 0.2 },
  TintTruck: { color: '#ffffff', rough: 0.4, metal: 0.2 },
  Tire: { color: '#1a1d22' },
  Hub: { color: '#8a94a1', metal: 0.7 },
  Hazard: { color: '#f59e0b' },
  Cone: { color: '#f97316' },
  // greenery
  Trunk: { color: '#6b5440' },
  Leaf: { color: '#4d7c5a', rough: 0.9 },
  LeafDark: { color: '#3f6b4c', rough: 0.9 },
};

/** Parts that are recoloured per copy at runtime and must stay their own mesh. */
const TINTED = new Set(['TintTruck', 'TintContainer']);

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function nightMaterial(src: THREE.Material): THREE.MeshStandardMaterial {
  const name = src.name || 'unnamed';
  const cached = materialCache.get(name);
  if (cached) return cached;
  let look = LOOKS[name];
  if (!look) {
    // anything we did not plan for: keep its hue, lift it towards white for daylight
    const c = (src as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color('#bbb');
    c.lerp(new THREE.Color('#ffffff'), 0.35);
    look = { color: `#${c.getHexString()}` };
  }
  const m = new THREE.MeshStandardMaterial({
    name,
    color: new THREE.Color(look.color),
    roughness: look.rough ?? 0.75,
    metalness: look.metal ?? 0.05,
  });
  if (look.emissive) {
    m.emissive = new THREE.Color(look.emissive);
    m.emissiveIntensity = look.glow ?? 1;
  }
  materialCache.set(name, m);
  return m;
}

let library: Record<string, THREE.Object3D> | null = null;
const baked = new Map<string, THREE.Group>();

export async function loadKit(onProgress?: (f: number) => void): Promise<void> {
  if (library) return;
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/kit.glb`, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  gltf.scene.updateMatrixWorld(true);
  library = {};
  for (const child of gltf.scene.children) library[child.name] = child;
}

function bakeNode(root: THREE.Object3D, name: string): THREE.Group {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    let g = mesh.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (g.index) g = g.toNonIndexed();
    const mat = nightMaterial(src);
    const key = mat.name;
    if (!buckets.has(key)) buckets.set(key, { material: mat, geos: [] });
    buckets.get(key)!.geos.push(g);
  });
  const group = new THREE.Group();
  group.name = name;
  for (const [key, { material, geos }] of buckets) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, TINTED.has(key) ? (material as THREE.MeshStandardMaterial).clone() : material);
    mesh.name = `${name}__${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function bakedModel(name: string): THREE.Group {
  if (!library) throw new Error('Model kit not loaded');
  const hit = baked.get(name);
  if (hit) return hit;
  const src = library[name];
  if (!src) throw new Error(`Missing model "${name}"`);
  let out: THREE.Group;
  if (name === 'ship') {
    // keep each cargo bay separate so bays can empty while unloading
    out = new THREE.Group();
    out.name = 'ship';
    for (const child of src.children) out.add(bakeNode(child, child.name));
  } else {
    out = bakeNode(src, name);
  }
  baked.set(name, out);
  return out;
}

/** A copy of a model. Tinted parts get their own material so each copy can be recoloured. */
export function model(name: string): THREE.Group {
  const obj = bakedModel(name).clone(true);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && TINTED.has((m.material as THREE.Material).name)) m.material = (m.material as THREE.Material).clone();
  });
  return obj;
}

/** Geometry and material of every part of a model, for instancing many copies. */
export function modelParts(name: string): { geometry: THREE.BufferGeometry; material: THREE.Material; tinted: boolean }[] {
  const g = bakedModel(name);
  const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; tinted: boolean }[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) parts.push({ geometry: m.geometry, material: m.material as THREE.Material, tinted: TINTED.has((m.material as THREE.Material).name) });
  });
  return parts;
}

export function tint(obj: THREE.Object3D, color: THREE.ColorRepresentation, glow = 0) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && TINTED.has((m.material as THREE.Material).name)) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.set(color);
      mat.emissive.set(color);
      mat.emissiveIntensity = glow;
    }
  });
}
