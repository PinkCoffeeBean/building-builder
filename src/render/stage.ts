import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BASE_HEIGHT } from './buildDesign';

export type ViewMode = 'iso' | 'front' | 'free';

/**
 * Scène, licht en camera. Orthografische camera in isometrisch perspectief die in stappen
 * van 90° draait, plus een vlakke vooraanzicht-modus. Rendert alleen als er iets verandert.
 */
export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  composer: EffectComposer;
  gtao: GTAOPass;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  shadowCatcher: THREE.Mesh;
  content = new THREE.Group();
  /** Ghosts en markeringen: aparte scène, bovenop getekend (niet in AO/schaduw). */
  overlayScene = new THREE.Scene();
  grid: THREE.Mesh;

  /** Camera-instellingen */
  azimuthStep = 0; // kwartslagen
  azimuth = Math.PI / 4; // huidige (geanimeerde) hoek
  elevation = Math.atan(1 / Math.SQRT2); // echte isometrie ≈ 35,26°
  targetElevation = this.elevation;
  freeAzimuth: number | null = null;
  mode: ViewMode = 'iso';
  target = new THREE.Vector3(0, 1.2, 0);
  viewHeight = 9; // wereldeenheden zichtbaar in de hoogte bij zoom 1
  zoom = 1;
  aoEnabled = true;

  private needsRender = true;
  private anim: { from: number; to: number; fromEl: number; toEl: number; t0: number; dur: number } | null = null;
  private onFrame: (() => void)[] = [];

  constructor(public container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    // omgevingslicht voor zachte reflecties
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#e9e5df');

    this.hemi = new THREE.HemisphereLight('#ffffff', '#d8cfc4', 1.25);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff6ea', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.radius = 4;
    this.sun.shadow.blurSamples = 16;
    const sc = this.sun.shadow.camera;
    sc.left = -9;
    sc.right = 9;
    sc.top = 9;
    sc.bottom = -9;
    sc.near = 0.5;
    sc.far = 60;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // zachte slagschaduw van de sokkel op de "vloer" eronder
    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ color: '#000000', opacity: 0.12 }),
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = -BASE_HEIGHT - 0.6;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);

    this.scene.add(this.content);
    this.overlayScene.add(new THREE.HemisphereLight('#ffffff', '#c8c0b8', 2.2));
    const od = new THREE.DirectionalLight('#ffffff', 1.2);
    od.position.set(-3, 6, 5);
    this.overlayScene.add(od);
    this.grid = makeGrid(8, 8);
    this.scene.add(this.grid);

    // nabewerking: ambient occlusion
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.updateCamera();
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  setBackground(color: string) {
    (this.scene.background as THREE.Color).set(color);
    // bij donkere achtergrond iets meer contrast in de slagschaduw
    const l = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l;
    (this.shadowCatcher.material as THREE.ShadowMaterial).opacity = l < 0.4 ? 0.28 : 0.12;
    this.invalidate();
  }

  addFrameListener(fn: () => void) {
    this.onFrame.push(fn);
  }

  invalidate() {
    this.needsRender = true;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.updateCamera();
  }

  /* ------------------------------------------------------------ camera */

  rotate(step: number) {
    if (this.mode === 'free') this.mode = 'iso';
    this.azimuthStep += step;
    this.animateTo(this.baseAzimuth(), this.mode === 'front' ? 0 : Math.atan(1 / Math.SQRT2));
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.freeAzimuth = null;
    this.animateTo(this.baseAzimuth(), mode === 'front' ? 0.0 : Math.atan(1 / Math.SQRT2));
  }

  /** Vrije hoek voor de fotomodus. */
  setFree(azimuthDeg: number, elevationDeg: number) {
    this.mode = 'free';
    this.anim = null;
    this.azimuth = (azimuthDeg * Math.PI) / 180;
    this.elevation = (elevationDeg * Math.PI) / 180;
    this.updateCamera();
  }

  private baseAzimuth() {
    // iso: hoeken tussen de assen; vooraanzicht: recht op een gevel
    const off = this.mode === 'front' ? 0 : Math.PI / 4;
    return off + this.azimuthStep * (Math.PI / 2);
  }

  /** Richting waar de kijker naar kijkt, als gevelrichting (welke gevel is "voor"). */
  frontDir(): 'px' | 'nx' | 'pz' | 'nz' {
    const a = this.azimuth;
    const x = Math.sin(a);
    const z = Math.cos(a);
    if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'px' : 'nx';
    return z > 0 ? 'pz' : 'nz';
  }

  private animateTo(az: number, el: number) {
    this.anim = { from: this.azimuth, to: az, fromEl: this.elevation, toEl: el, t0: performance.now(), dur: 420 };
    this.invalidate();
  }

  setZoom(z: number) {
    this.zoom = Math.min(4, Math.max(0.35, z));
    this.updateCamera();
  }

  pan(dxPx: number, dyPx: number) {
    const h = this.container.clientHeight || 1;
    const units = this.viewHeight / this.zoom / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dxPx * units).addScaledVector(up, dyPx * units);
    this.target.y = Math.max(-1, Math.min(8, this.target.y));
    this.target.x = Math.max(-8, Math.min(8, this.target.x));
    this.target.z = Math.max(-8, Math.min(8, this.target.z));
    this.updateCamera();
  }

  /** Zoom en doel passend maken op een kader. */
  frame(box: THREE.Box3, padding = 1.25) {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    this.target.copy(c);
    this.updateCamera();
    // projecteer hoekpunten op camera-assen
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    let w = 0;
    let h = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      w = Math.max(w, Math.abs(p.dot(right)));
      h = Math.max(h, Math.abs(p.dot(up)));
    }
    const aspect = (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
    const needH = Math.max(h * 2, (w * 2) / aspect) * padding;
    this.zoom = Math.min(4, Math.max(0.35, this.viewHeight / needH));
    this.updateCamera();
  }

  updateCamera() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const aspect = w / h;
    const vh = this.viewHeight / this.zoom;
    this.camera.left = (-vh * aspect) / 2;
    this.camera.right = (vh * aspect) / 2;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    const dist = 50;
    const el = this.elevation;
    const dir = new THREE.Vector3(Math.sin(this.azimuth) * Math.cos(el), Math.sin(el), Math.cos(this.azimuth) * Math.cos(el));
    this.camera.position.copy(this.target).addScaledVector(dir, dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.near = 0.1;
    this.camera.far = 120;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // zon draait mee: altijd van linksvoor-boven t.o.v. de kijker
    const sunAz = this.azimuth - 0.75;
    const sunEl = 0.95;
    const sd = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(sunAz) * Math.cos(sunEl));
    this.sun.position.set(0, 1, 0).addScaledVector(sd, 25);
    this.sun.target.position.set(0, 1, 0);
    this.sun.target.updateMatrixWorld();
    this.invalidate();
  }

  private tick() {
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.azimuth = this.anim.from + (this.anim.to - this.anim.from) * e;
      this.elevation = this.anim.fromEl + (this.anim.toEl - this.anim.fromEl) * e;
      if (t >= 1) this.anim = null;
      this.updateCamera();
    }
    for (const fn of this.onFrame) fn();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.render();
  }

  render(overlay = true) {
    if (this.aoEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (overlay && this.overlayScene.children.length > 2) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.overlayScene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  setGrid(w: number, d: number, visible: boolean) {
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = makeGrid(w, d);
    this.grid.visible = visible;
    this.scene.add(this.grid);
    this.invalidate();
  }

  get animating() {
    return !!this.anim;
  }

  /**
   * Render naar een PNG-dataURL in een gegeven resolutie (fotomodus / thumbnails).
   * Gebruikt dezelfde camera; de beeldverhouding volgt width/height.
   */
  snapshot(width: number, height: number): string {
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevPR = this.renderer.getPixelRatio();
    const gridVisible = this.grid.visible;
    this.grid.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
    // camera tijdelijk op nieuwe beeldverhouding: grootste uitsnede van het scherm
    const vh = this.viewHeight / this.zoom;
    const aspect = width / height;
    const screenAspect = (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
    let fh = vh;
    if (aspect > screenAspect) fh = (vh * screenAspect) / aspect;
    this.camera.left = (-fh * aspect) / 2;
    this.camera.right = (fh * aspect) / 2;
    this.camera.top = fh / 2;
    this.camera.bottom = -fh / 2;
    this.camera.updateProjectionMatrix();
    this.render(false);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.grid.visible = gridVisible;
    this.renderer.setPixelRatio(prevPR);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.composer.setPixelRatio(prevPR);
    this.composer.setSize(prevSize.x, prevSize.y);
    this.updateCamera();
    this.render();
    return url;
  }
}

/** Raster van de kavel: dunne lijnen op sokkelhoogte, alleen zichtbaar tijdens het bouwen. */
function makeGrid(w: number, d: number) {
  const px = 64;
  const c = document.createElement('canvas');
  c.width = w * px;
  c.height = d * px;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(70,80,95,0.28)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= w; i++) {
    ctx.beginPath();
    ctx.moveTo(i * px, 0);
    ctx.lineTo(i * px, c.height);
    ctx.stroke();
  }
  for (let j = 0; j <= d; j++) {
    ctx.beginPath();
    ctx.moveTo(0, j * px);
    ctx.lineTo(c.width, j * px);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70,80,95,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  m.renderOrder = 1;
  m.name = 'grid';
  return m;
}
