// Small geometry helpers shared by both boards.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { P } from './roads';

/** Round the corners of a polyline so curves look like real road bends. */
export function roundCorners(path: P[], r = 2.5): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = new THREE.Vector3(path[i][0], 0, path[i][1]);
    if (i === 0 || i === path.length - 1) {
      out.push(p);
      continue;
    }
    const a = new THREE.Vector3(path[i - 1][0], 0, path[i - 1][1]);
    const b = new THREE.Vector3(path[i + 1][0], 0, path[i + 1][1]);
    const da = a.clone().sub(p);
    const db = b.clone().sub(p);
    const ra = Math.min(r, da.length() / 2);
    const rb = Math.min(r, db.length() / 2);
    const pa = p.clone().add(da.normalize().multiplyScalar(ra));
    const pb = p.clone().add(db.normalize().multiplyScalar(rb));
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      // quadratic bezier through the corner
      const q = pa.clone().multiplyScalar((1 - t) ** 2).add(p.clone().multiplyScalar(2 * (1 - t) * t)).add(pb.clone().multiplyScalar(t * t));
      out.push(q);
    }
  }
  return out;
}

/** A flat glowing strip along a path; uv.x runs along it, uv.y across it. */
export function ribbon(points: THREE.Vector3[], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let total = 0;
  const lens = [0];
  for (let i = 1; i < points.length; i++) {
    total += points[i].distanceTo(points[i - 1]);
    lens.push(total);
  }
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dir = next.clone().sub(prev).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    const p = points[i];
    pos.push(p.x + side.x, y + p.y, p.z + side.z, p.x - side.x, y + p.y, p.z - side.z);
    const u = total ? lens[i] / total : 0;
    uv.push(u, 0, u, 1);
    if (i < points.length - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An arc lifted off the ground between two points (sea lanes, flight paths). */
export function arcPoints(a: THREE.Vector3, b: THREE.Vector3, height: number, steps = 48): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = a.clone().lerp(b, t);
    p.y += Math.sin(Math.PI * t) * height;
    out.push(p);
  }
  return out;
}

export function tube(points: THREE.Vector3[], radius: number, material: THREE.Material, segments = 120): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 8, false), material);
}

export interface Label {
  obj: CSS2DObject;
  el: HTMLDivElement;
  set(title: string, sub?: string, tone?: string): void;
  show(v: boolean): void;
}

/** A small glass chip label that floats over a node. */
export function label(title: string, sub = '', kind = 'node'): Label {
  const el = document.createElement('div');
  el.className = `tl tl-${kind}`;
  el.innerHTML = `<span class="tl-dot"></span><span class="tl-text"><b></b><i></i></span>`;
  const b = el.querySelector('b')!;
  const i = el.querySelector('i')!;
  const obj = new CSS2DObject(el);
  let last = '';
  const set = (t: string, s = '', tone = 'normal') => {
    const key = `${t}|${s}|${tone}`;
    if (key === last) return;
    last = key;
    b.textContent = t;
    i.textContent = s;
    i.style.display = s ? '' : 'none';
    el.dataset.tone = tone;
  };
  set(title, sub);
  return {
    obj,
    el,
    set,
    show(v: boolean) {
      // the label renderer honours the object's visibility, not the element's style
      obj.visible = v;
    },
  };
}

export interface Panel extends Label {
  setBars(values: { label: string; value: number; text: string; color: string }[]): void;
}

/**
 * A compact chip over a building (name + lowest days of stock) that opens into
 * a small bar chart when you hover the chip or the building itself.
 */
export function panel(title: string, sub = ''): Panel {
  const el = document.createElement('div');
  el.className = 'tp';
  el.innerHTML = `<div class="tp-head"><span class="tl-dot"></span><b></b><em class="tp-sum"></em></div><div class="tp-more"><div><i></i><div class="tp-bars"></div></div></div>`;
  const b = el.querySelector('b')!;
  const i = el.querySelector('i')!;
  const sum = el.querySelector('.tp-sum') as HTMLElement;
  const bars = el.querySelector('.tp-bars') as HTMLDivElement;
  const obj = new CSS2DObject(el);
  // anchor the bottom edge so the chart opens upwards, away from the building
  obj.center.set(0.5, 1);
  let last = '';
  let lastBars = '';
  const set = (t: string, s = '', tone = 'normal') => {
    const key = `${t}|${s}|${tone}`;
    if (key === last) return;
    last = key;
    b.textContent = t;
    i.textContent = s;
    i.style.display = s ? '' : 'none';
    el.dataset.tone = tone;
  };
  set(title, sub);
  return {
    obj,
    el,
    set,
    show(v: boolean) {
      obj.visible = v;
    },
    setBars(values) {
      const key = values.map((v) => `${v.label}${v.text}${v.value.toFixed(2)}`).join('|');
      if (key === lastBars) return;
      lastBars = key;
      // the chip shows the product closest to running out
      const low = values.reduce((a, v) => (v.value < a.value ? v : a), values[0]);
      sum.textContent = low ? low.text : '';
      sum.title = low ? `Lowest: ${low.label}` : '';
      bars.innerHTML = values
        .map(
          (v) =>
            `<div class="tp-row"><span>${v.label}</span><span class="tp-track"><span style="width:${Math.round(Math.min(1, Math.max(0.02, v.value)) * 100)}%;background:${v.color}"></span></span><em>${v.text}</em></div>`,
        )
        .join('');
    },
  };
}

export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    }
    if (o instanceof CSS2DObject) o.element.remove();
  });
}
