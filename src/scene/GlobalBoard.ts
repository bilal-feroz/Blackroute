// Global shipping corridor view (filled in next).
import * as THREE from 'three';
import type { Board, TwinState } from './types';

export class GlobalBoard implements Board {
  readonly root = new THREE.Group();
  pickables: THREE.Object3D[] = [];
  update(_state: TwinState, _dt: number) {}
  dispose() {}
}
