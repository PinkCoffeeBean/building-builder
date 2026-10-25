import * as THREE from 'three';
import {
  def,
  facadeLayer,
  isFacadeDef,
  type AnyDef,
  type ChimneyDef,
  type EnvDef,
  type FacadeDef,
} from '../catalog/catalog';
import {
  CellMap,
  DIR_RIGHT,
  DIR_ANGLE,
  DIR_VEC,
  FL,
  ROUND,
  cellBottom,
  cellCenterX,
  cellCenterZ,
  cellTop,
  faceOrigin,
} from '../core/grid';
import type { Cell, CladdingId, Design, Dir, FaceDir, FacadeItem } from '../core/types';
import { GeoBuckets, type Hole } from './blockGeometry';
import { buildChimney, buildEnvItem } from './builders/env';
import { buildFacadeItem, footprintRect, openingRect } from './builders/facade';
import { buildRoofs, roofExtra, topMatKey } from './builders/roof';
import { cladMat } from './materials';
import { disposeTree, rbox, mesh } from './shapes';

export const BASE_MARGIN = 0.7;
/** Rand van de sokkel rond de inhoud. */
export const BASE_PAD = 0.55;
export const BASE_HEIGHT = 0.24;

const SIDE_OF: Record<FaceDir, number> = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };
const FACE_DIRS: FaceDir[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export function wallKey(c: Cell, d: FaceDir): string {
  const f = c.faces?.[d];
  return `${f?.cladding ?? c.cladding}|${f?.color ?? c.color}`;
}

export function keyMaterial(k: string): THREE.Material {
  const [cl, color] = k.split('|');
  return cladMat(cl as CladdingId, color);
}

const groupKey = (c: Cell) => `${c.cladding}|${c.color}`;

/** Sleutel van een gevelvlak-vlak (richting + positie van het vlak). */
export function planeKey(dir: Dir, coord: number) {
  return `${dir}|${Math.round(coord * 1000)}`;
}

function cellPlaneCoord(design: Design, c: { x: number; z: number }, d: Dir) {
  if (d === 'px') return cellCenterX(c.x, design.plot.w) + 0.5;
  if (d === 'nx') return cellCenterX(c.x, design.plot.w) - 0.5;
  if (d === 'pz') return cellCenterZ(c.z, design.plot.d) + 0.5;
  return cellCenterZ(c.z, design.plot.d) - 0.5;
}

/** Lokale rechthoek van een gevelelement → gat in wereldcoördinaten op het vlak. */
export function localRectToHole(design: Design, item: FacadeItem, r: { x0: number; x1: number; y0: number; y1: number }): Hole {
  const o = faceOrigin(design, item.x, item.y, item.z, item.dir);
  const R = DIR_RIGHT[item.dir];
  const xNormal = item.dir === 'px' || item.dir === 'nx';
  const along = xNormal ? 2 : 0;
  const a0 = o[along] + R[along] * r.x0;
  const a1 = o[along] + R[along] * r.x1;
  return { a0: Math.min(a0, a1), a1: Math.max(a0, a1), b0: o[1] + r.y0, b1: o[1] + r.y1 };
}

export interface BuiltDesign {
  group: THREE.Group;
  dispose: () => void;
}

export function buildDesign(design: Design, opts: { base?: boolean } = {}): BuiltDesign {
  const group = new THREE.Group();
  group.name = 'design';
  const cm = new CellMap(design);
  const buckets = new GeoBuckets();
  const W = design.plot.w;
  const D = design.plot.d;

  // ---------------------------------------------------------------- gaten verzamelen
  const holes = new Map<string, Hole[]>();
  for (const it of design.facade) {
    const d = safeDef(it.type);
    if (!d || !isFacadeDef(d)) continue;
    if (facadeLayer(d) !== 'wall') continue;
    const op = openingRect(d, it);
    if (!op) continue;
    const h = localRectToHole(design, it, op);
    const pk = planeKey(it.dir, cellPlaneCoord(design, it, it.dir));
    if (!holes.has(pk)) holes.set(pk, []);
    holes.get(pk)!.push(h);
  }
  // onderbrekingen in plint/banden voor elementen buiten de gevel die tot op de sokkel gaan
  const stripGaps = new Map<string, Hole[]>();
  for (const it of design.facade) {
    const d = safeDef(it.type);
    if (!d || !isFacadeDef(d)) continue;
    const fp = facadeLayer(d) === 'wall' ? openingRect(d, it) : d.kind === 'canopy' && d.style === 'portal' ? footprintRect(d, it) : null;
    if (!fp) continue;
    const pk = planeKey(it.dir, cellPlaneCoord(design, it, it.dir));
    if (!stripGaps.has(pk)) stripGaps.set(pk, []);
    stripGaps.get(pk)!.push(localRectToHole(design, it, fp));
  }

  // ---------------------------------------------------------------- volumes
  for (const c of design.cells) {
    const cx = cellCenterX(c.x, W);
    const cz = cellCenterZ(c.z, D);
    const render: boolean[] = [];
    const round: boolean[] = [];
    const mat: string[] = [];
    const hs: (Hole[] | undefined)[] = [];
    const gk = groupKey(c);
    for (const fd of FACE_DIRS) {
      const s = SIDE_OF[fd];
      const n = cm.neighbor(c, fd);
      if (fd === 'ny' && c.y === 0) {
        render[s] = false;
        round[s] = false;
      } else {
        render[s] = !n;
        round[s] = !(n && groupKey(n) === gk);
      }
      mat[s] = fd === 'py' && !n ? topMatKey(c) : wallKey(c, fd);
      if (fd !== 'py' && fd !== 'ny') hs[s] = holes.get(planeKey(fd, cellPlaneCoord(design, c, fd)));
    }
    buckets.addBlock({
      min: [cx - 0.5, cellBottom(c.y), cz - 0.5],
      max: [cx + 0.5, cellTop(c.y), cz + 0.5],
      render,
      round,
      mat,
      holes: hs,
      r: ROUND,
      segs: 3,
    });

    // plint en gevelbanden
    for (const d of ['px', 'nx', 'pz', 'nz'] as Dir[]) {
      if (!cm.exposed(c.x, c.y, c.z, d)) continue;
      const gaps = stripGaps.get(planeKey(d, cellPlaneCoord(design, c, d))) ?? [];
      if (c.y === 0 && design.settings.plinth) {
        faceStrip(design, cm, buckets, c, d, 0, FL, 0.014, `stucco|${design.settings.plinth}`, gaps);
      }
      if (c.y > 0 && design.settings.bands && cm.exposed(c.x, c.y - 1, c.z, d)) {
        const yb = cellBottom(c.y);
        faceStrip(design, cm, buckets, c, d, yb - 0.022, yb + 0.022, 0.013, `stucco|${design.settings.bands}`, gaps);
      }
    }
  }

  // ---------------------------------------------------------------- daken
  const roofGroup = new THREE.Group();
  const roofBuckets = new GeoBuckets();
  buildRoofs(design, cm, roofBuckets, roofGroup);
  for (const m of roofBuckets.toMeshes(keyMaterial)) {
    m.userData.kind = 'roof';
    roofGroup.add(m);
  }
  roofGroup.traverse((o) => (o.userData.kind ??= 'roof'));
  group.add(roofGroup);

  const volMeshes = buckets.toMeshes(keyMaterial);
  for (const m of volMeshes) {
    m.userData.kind = 'volume';
    group.add(m);
  }

  // ---------------------------------------------------------------- gevelelementen
  for (const it of design.facade) {
    const d = safeDef(it.type);
    if (!d || !isFacadeDef(d)) continue;
    const anchor = cm.get(it.x, it.y, it.z);
    if (!anchor) continue;
    const g = placeFacade(design, d, it, keyMaterial(wallKey(anchor, it.dir)));
    g.userData = { kind: 'facade', id: it.id };
    group.add(g);
  }

  // ---------------------------------------------------------------- dakelementen
  for (const it of design.roofItems) {
    const d = safeDef(it.type) as ChimneyDef | undefined;
    const c = cm.get(it.x, it.y, it.z);
    if (!d || !c) continue;
    const g = buildChimney(d, it.color, roofExtra(c));
    g.position.set(cellCenterX(it.x, W) + it.ox, cellTop(it.y), cellCenterZ(it.z, D) + it.oz);
    g.userData = { kind: 'roofItem', id: it.id };
    group.add(g);
  }

  // ---------------------------------------------------------------- omgeving
  for (const it of design.env) {
    const d = safeDef(it.type);
    if (!d) continue;
    if (d.kind !== 'env') continue;
    const g = buildEnvItem(d as EnvDef, it);
    g.position.set(it.x, 0, it.z);
    g.rotation.y = (it.rot * Math.PI) / 2;
    g.userData = { kind: 'env', id: it.id };
    group.add(g);
  }

  // ---------------------------------------------------------------- sokkel
  if (opts.base !== false) group.add(buildBase(design));


  return {
    group,
    dispose: () => disposeTree(group),
  };
}

/** Omtrek van de sokkel: past om het gebouw en de omgeving heen (als een maquette-tegel). */
export function baseRect(design: Design) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of design.cells) {
    const cx = cellCenterX(c.x, design.plot.w);
    const cz = cellCenterZ(c.z, design.plot.d);
    x0 = Math.min(x0, cx - 0.5);
    x1 = Math.max(x1, cx + 0.5);
    z0 = Math.min(z0, cz - 0.5);
    z1 = Math.max(z1, cz + 0.5);
  }
  for (const e of design.env) {
    const d = safeDef(e.type) as EnvDef | undefined;
    const r = (d?.radius ?? 0.1) * 0.8;
    x0 = Math.min(x0, e.x - r);
    x1 = Math.max(x1, e.x + r);
    z0 = Math.min(z0, e.z - r);
    z1 = Math.max(z1, e.z + r);
  }
  if (!isFinite(x0)) {
    x0 = -1;
    x1 = 1;
    z0 = -1;
    z1 = 1;
  }
  const m = BASE_PAD;
  // minimaal 2×2 cellen
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = Math.max(2, x1 - x0) + m * 2;
  const d = Math.max(2, z1 - z0) + m * 2;
  return { cx, cz, w, d };
}

export function buildBase(design: Design): THREE.Mesh {
  const r = baseRect(design);
  const m = mesh(rbox(r.w, BASE_HEIGHT, r.d, 0.05, 4), cladMat('stucco', design.settings.base), r.cx, -BASE_HEIGHT / 2, r.cz);
  m.userData = { kind: 'ground' };
  m.name = 'base';
  return m;
}

/** Plaatst een gevelelement in wereldcoördinaten. */
export function placeFacade(design: Design, d: FacadeDef, it: FacadeItem, wallMat: THREE.Material) {
  const inner = buildFacadeItem(d, it, wallMat);
  const g = new THREE.Group();
  g.add(inner);
  const o = faceOrigin(design, it.x, it.y, it.z, it.dir);
  g.position.set(o[0], o[1], o[2]);
  g.rotation.y = DIR_ANGLE[it.dir];
  return g;
}

export function safeDef(id: string): AnyDef | undefined {
  try {
    return def(id);
  } catch {
    return undefined;
  }
}

/**
 * Strook (plint of gevelband) langs één gevelvlak van een cel, met onderbrekingen voor
 * deuren e.d. Strookjes lopen naadloos door naar buurcellen en grijpen om bolle hoeken.
 */
function faceStrip(
  design: Design,
  cm: CellMap,
  buckets: GeoBuckets,
  c: Cell,
  d: Dir,
  y0: number,
  y1: number,
  prot: number,
  key: string,
  gaps: Hole[],
) {
  const R = DIR_RIGHT[d];
  const N = DIR_VEC[d];
  const o = faceOrigin(design, c.x, c.y, c.z, d);
  const xNormal = d === 'px' || d === 'nx';
  const along = xNormal ? 2 : 0;
  const nAxis = xNormal ? 0 : 2;
  // uiteinden: buur langs het vlak?
  const endInfo = (step: number) => {
    const nx = c.x + R[0] * step;
    const nz = c.z + R[2] * step;
    if (!cm.has(nx, c.y, nz)) return { ext: prot, round: true }; // bolle hoek
    if (cm.exposed(nx, c.y, nz, d)) return { ext: 0, round: false }; // loopt door
    return { ext: 0, round: true }; // holle hoek
  };
  const L = endInfo(-1);
  const Rt = endInfo(1);
  // u-intervallen (0..1 langs het vlak) minus gaten
  let segs: [number, number, boolean, boolean][] = [[-L.ext, 1 + Rt.ext, L.round, Rt.round]];
  for (const g of gaps) {
    if (g.b0 >= y1 || g.b1 <= y0) continue;
    const ua = (g.a0 - o[along]) * R[along];
    const ub = (g.a1 - o[along]) * R[along];
    const u0 = Math.min(ua, ub);
    const u1 = Math.max(ua, ub);
    const next: typeof segs = [];
    for (const s of segs) {
      if (u1 <= s[0] || u0 >= s[1]) {
        next.push(s);
        continue;
      }
      if (u0 > s[0]) next.push([s[0], u0, s[2], true]);
      if (u1 < s[1]) next.push([u1, s[1], true, s[3]]);
    }
    segs = next;
  }
  for (const [u0, u1, r0, r1] of segs) {
    if (u1 - u0 < 0.01) continue;
    const pA = o[along] + R[along] * u0;
    const pB = o[along] + R[along] * u1;
    const face = o[nAxis];
    const n0 = face - N[nAxis] * 0.01;
    const n1 = face + N[nAxis] * prot;
    const min: [number, number, number] = [0, y0, 0];
    const max: [number, number, number] = [0, y1, 0];
    min[along] = Math.min(pA, pB);
    max[along] = Math.max(pA, pB);
    min[nAxis] = Math.min(n0, n1);
    max[nAxis] = Math.max(n0, n1);
    // afronding per wereldzijde
    const round = [true, true, true, y0 > 0.001, true, true];
    const render = [true, true, true, y0 > 0.001, true, true];
    const sideIdx = (axis: number, sign: number) => axis * 2 + (sign < 0 ? 1 : 0);
    const startSide = sideIdx(along, -R[along]);
    const endSide = sideIdx(along, R[along]);
    round[startSide] = r0;
    round[endSide] = r1;
    render[startSide] = r0;
    render[endSide] = r1;
    const back = sideIdx(nAxis, -N[nAxis]);
    render[back] = false;
    round[back] = false;
    buckets.addBlock({ min, max, render, round, mat: [key, key, key, key, key, key], r: 0.008, segs: 2 });
  }
}

export { cellTop };
