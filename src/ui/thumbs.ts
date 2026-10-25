import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { isFacadeDef, type AnyDef } from '../catalog/catalog';
import { emptyDesign } from '../core/store';
import type { Design } from '../core/types';
import { buildDesign } from '../render/buildDesign';

/** Kleine offscreen renderer voor pictogrammen van catalogus-elementen en galerij-thumbnails. */
export class ThumbRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  sun: THREE.DirectionalLight;
  private cache = new Map<string, string>();

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#d8cfc4', 1.3));
    this.sun = new THREE.DirectionalLight('#fff6ea', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.01;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    this.scene.add(this.sun, this.sun.target);
  }

  /** Render een object passend in beeld vanuit (az, el). */
  private shoot(obj: THREE.Object3D, w: number, h: number, az: number, el: number, fitBox?: THREE.Box3, bg?: string, pad = 1.12) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.scene.background = bg ? new THREE.Color(bg) : null;
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = fitBox ?? new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.camera.position.copy(c).addScaledVector(dir, 30);
    this.camera.lookAt(c);
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    let hw = 0.01;
    let hh = 0.01;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      hw = Math.max(hw, Math.abs(p.dot(right)));
      hh = Math.max(hh, Math.abs(p.dot(up)));
    }
    const aspect = w / h;
    const half = Math.max(hh, hw / aspect) * pad;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.near = 0.1;
    this.camera.far = 80;
    this.camera.updateProjectionMatrix();
    const sunAz = az - 0.75;
    this.sun.position.copy(c).add(new THREE.Vector3(Math.sin(sunAz) * 0.6, 0.85, Math.cos(sunAz) * 0.6).multiplyScalar(20));
    this.sun.target.position.copy(c);
    this.sun.target.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(obj);
    return url;
  }

  /** Thumbnail van een heel ontwerp (galerij). */
  design(d: Design, size = 320, bg?: string): string {
    const built = buildDesign(d);
    const box = new THREE.Box3();
    built.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
    });
    const url = this.shoot(built.group, size, Math.round(size * 0.8), Math.PI / 4, Math.atan(1 / Math.SQRT2), box, bg ?? d.settings.background, 1.08);
    built.dispose();
    return url;
  }

  /** Pictogram van een catalogus-element. */
  item(def: AnyDef, color?: string, accent?: string): string {
    const k = `${def.id}|${color}|${accent}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const d = emptyDesign();
    d.settings.plinth = null;
    const wall = '#ebe7e0';
    const c = color ?? def.color;
    const a = accent ?? def.accent;
    let az = 0.55;
    let el = 0.32;
    let focus: ((g: THREE.Group) => THREE.Box3) | null = null;
    if (def.kind === 'volume') {
      d.plot = { w: 1, d: 1, floors: 6 };
      d.cells.push({ x: 0, y: 0, z: 0, color: c, cladding: def.cladding });
      az = Math.PI / 4;
      el = 0.55;
    } else if (isFacadeDef(def)) {
      const [sw, sh] = def.span;
      d.plot = { w: sw, d: 1, floors: 6 };
      const y0 = def.notGround ? 1 : 0;
      for (let x = 0; x < sw; x++)
        for (let y = 0; y < y0 + sh + 1; y++) d.cells.push({ x, y, z: 0, color: wall, cladding: 'stucco', roof: { type: 'roof-none', color: wall } });
      d.facade.push({ id: 't', type: def.id, x: 0, y: y0, z: 0, dir: 'pz', align: 0, color: c, accent: a });
      focus = (g) => {
        const box = new THREE.Box3();
        g.traverse((o) => {
          if (o.userData.kind === 'facade') box.expandByObject(o);
        });
        box.expandByScalar(def.kind === 'window' && def.width < 0.2 ? 0.12 : 0.06);
        return box;
      };
    } else if (def.kind === 'roof') {
      d.plot = { w: 1, d: 1, floors: 6 };
      d.cells.push({ x: 0, y: 0, z: 0, color: wall, cladding: 'stucco', roof: { type: def.id, color: c, accent: a } });
      az = Math.PI / 4;
      el = 0.6;
    } else if (def.kind === 'chimney') {
      d.plot = { w: 1, d: 1, floors: 6 };
      d.cells.push({ x: 0, y: 0, z: 0, color: wall, cladding: 'stucco' });
      d.roofItems.push({ id: 't', type: def.id, x: 0, y: 0, z: 0, ox: 0, oz: 0, color: c });
      az = Math.PI / 4;
      el = 0.5;
    } else if (def.kind === 'env') {
      d.plot = { w: 1, d: 1, floors: 6 };
      d.env.push({ id: 't', type: def.id, x: 0, z: 0, rot: 0, color: c, accent: a });
      az = Math.PI / 4;
      el = 0.45;
    } else {
      return '';
    }
    const built = buildDesign(d, { base: false });
    const box = focus ? focus(built.group) : undefined;
    const url = this.shoot(built.group, 112, 112, az, el, box, undefined, 1.06);
    built.dispose();
    this.cache.set(k, url);
    return url;
  }
}
