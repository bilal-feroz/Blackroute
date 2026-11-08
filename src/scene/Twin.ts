// The 3D view: renderer, bloom, labels, camera and the two boards
// (local digital twin of Dubai and the global shipping corridor).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { sharedTime } from './materials';
import { loadKit } from './assets';
import { LocalBoard } from './LocalBoard';
import { GlobalBoard } from './GlobalBoard';
import { EMPTY_STATE, type Board, type TwinState, type TwinView } from './types';

interface CameraPreset {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const PRESETS: Record<TwinView, CameraPreset> = {
  local: { position: new THREE.Vector3(-52, 112, 150), target: new THREE.Vector3(8, -6, 6) },
  global: { position: new THREE.Vector3(0, 150, 105), target: new THREE.Vector3(0, -4, 6) },
};

export class Twin {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private boards: Partial<Record<TwinView, Board>> = {};
  private state: TwinState = EMPTY_STATE;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private fly: { from: CameraPreset; to: CameraPreset; t: number } | null = null;
  private currentView: TwinView = 'local';
  private fade = 1;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private fitted = false;
  onPick: ((id: string | null) => void) | null = null;

  constructor(private container: HTMLElement) {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'twin-canvas';
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(w, h);
    this.labels.domElement.className = 'twin-labels';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(30, w / h, 1, 3000);
    this.camera.position.copy(PRESETS.local.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(PRESETS.local.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = 1.2;
    this.controls.minDistance = 70;
    this.controls.maxDistance = 360;
    this.controls.screenSpacePanning = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;

    // the page behind the canvas carries the slate-blue gradient
    this.scene.background = null;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    // soft dusk light: cool sky, warm key light, blue fill
    const hemi = new THREE.HemisphereLight('#dfe9ff', '#3c4554', 1.05);
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight('#8fb3ff', 0.55);
    fill.position.set(90, 60, -70);
    this.scene.add(fill);
    const moon = new THREE.DirectionalLight('#fff1dc', 2.0);
    moon.position.set(-60, 120, 70);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -100;
    sc.right = 100;
    sc.top = 80;
    sc.bottom = -80;
    sc.near = 10;
    sc.far = 320;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.4;
    this.scene.add(moon);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.4, 0.96);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointer);
    this.renderer.domElement.addEventListener('pointerdown', this.handleDown);
  }

  async init(onProgress?: (f: number) => void) {
    await loadKit(onProgress);
    if (this.disposed) return;
    this.boards.local = new LocalBoard();
    this.boards.global = new GlobalBoard();
    this.scene.add(this.boards.local.root);
    this.scene.add(this.boards.global.root);
    this.boards.global.root.visible = false;
    this.loop();
  }

  setState(next: TwinState) {
    if (next.view !== this.state.view) this.goTo(next.view);
    this.state = next;
  }

  private goTo(view: TwinView) {
    const from = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.fly = { from, to: this.presetFor(view), t: 0 };
    this.currentView = view;
  }

  /** Smoothly fly back to the default camera. */
  resetCamera() {
    this.goTo(this.currentView);
  }

  private downAt = { x: 0, y: 0 };
  private handleDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private handlePointer = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) return; // it was a drag
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const board = this.boards[this.currentView];
    if (!board) return;
    const hit = this.raycaster.intersectObjects(board.pickables, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.nodeId) o = o.parent;
    this.onPick?.((o?.userData.nodeId as string) ?? null);
  };

  /** Distance at which the board (about 180 x 120 units) fills the view. */
  private fitDistance(): number {
    const aspect = this.camera.aspect || 1.6;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const needW = 178 / 2 / Math.tan(hfov / 2);
    const needH = 150 / 2 / Math.tan(vfov / 2);
    return Math.max(needW, needH) * 0.88;
  }

  private presetFor(view: TwinView): CameraPreset {
    const p = PRESETS[view];
    const dir = p.position.clone().sub(p.target).normalize();
    return { position: p.target.clone().add(dir.multiplyScalar(this.fitDistance())), target: p.target.clone() };
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.fov = 30;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = this.fitDistance() * 1.6;
    if (!this.fitted) {
      this.fitted = true;
      const p = this.presetFor(this.currentView);
      this.camera.position.copy(p.position);
      this.controls.target.copy(p.target);
    }
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    sharedTime.value += dt;

    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 1.4);
      const k = this.fly.t < 0.5 ? 4 * this.fly.t ** 3 : 1 - (-2 * this.fly.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(this.fly.from.position, this.fly.to.position, k);
      this.controls.target.lerpVectors(this.fly.from.target, this.fly.to.target, k);
      // swap boards at the middle of the flight
      const showLocal = this.currentView === 'local' ? k > 0.5 : k < 0.5;
      if (this.boards.local) this.boards.local.root.visible = showLocal;
      if (this.boards.global) this.boards.global.root.visible = !showLocal;
      this.fade = Math.abs(k - 0.5) * 2;
      if (this.fly.t >= 1) this.fly = null;
    }
    this.renderer.toneMappingExposure = 0.45 + 0.55 * this.fade;

    for (const b of Object.values(this.boards)) if (b && b.root.visible) b.update(this.state, dt);
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointer);
    this.renderer.domElement.removeEventListener('pointerdown', this.handleDown);
    for (const b of Object.values(this.boards)) b?.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
