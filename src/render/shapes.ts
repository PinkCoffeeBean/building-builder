import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Hulpfuncties om kleine onderdelen te maken. Geometrieën worden hergebruikt. */

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(k: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(k);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(k, g);
  }
  return g;
}

const f = (n: number) => n.toFixed(4);

export function rbox(w: number, h: number, d: number, r = 0.01, segs = 2) {
  const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  return cached(`rb${f(w)}|${f(h)}|${f(d)}|${f(rr)}|${segs}`, () => new RoundedBoxGeometry(w, h, d, segs, rr));
}

export function bbox(w: number, h: number, d: number) {
  return cached(`b${f(w)}|${f(h)}|${f(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

export function cyl(rt: number, rb: number, h: number, seg = 16) {
  return cached(`c${f(rt)}|${f(rb)}|${f(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

export function sphere(r: number, ws = 24, hs = 16) {
  return cached(`s${f(r)}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

export function capsule(r: number, len: number) {
  return cached(`cap${f(r)}|${f(len)}`, () => new THREE.CapsuleGeometry(r, len, 8, 20));
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Box van min- tot max-hoek (afgerond). */
export function rboxAt(
  mat: THREE.Material,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  r = 0.008,
) {
  return mesh(rbox(x1 - x0, y1 - y0, z1 - z0, r), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Box van min- tot max-hoek (scherp; voor dunne staafjes). */
export function boxAt(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  return mesh(bbox(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Vlakke vierhoek door vier punten (tegen de klok in vanaf de voorkant). */
export function quad(mat: THREE.Material, pts: [number, number, number][]) {
  const g = new THREE.BufferGeometry();
  const p = pts.flat();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const a = new THREE.Vector3(...pts[0]);
  const b = new THREE.Vector3(...pts[1]);
  const d = new THREE.Vector3(...pts[3]);
  const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
  g.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
  // planaire UV's in wereldmaat
  const uv: number[] = [];
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  for (const q of pts) {
    if (ax > 0.5) uv.push(q[2], q[1]);
    else if (ay > 0.5) uv.push(q[0], q[2]);
    else uv.push(q[0], q[1]);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

/** Ruwe vrijgave van niet-gedeelde geometrieën in een boom. */
export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
  });
}
