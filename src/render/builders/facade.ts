import * as THREE from 'three';
import type {
  BalconyDef,
  CanopyDef,
  DoorDef,
  FacadeDef,
  SignDef,
  StairDef,
  WindowDef,
} from '../../catalog/catalog';
import { FL } from '../../core/grid';
import type { FacadeItem } from '../../core/types';
import { clay, clearGlass, cladMat, curtain, emissive, glass, stripeMat, textTexture } from '../materials';
import { boxAt, cyl, mesh, quad, rboxAt, sphere } from '../shapes';

/* =====================================================================
 * Maatvoering: positie, opening (gat in de muur) en voetafdruk op de gevel
 * ===================================================================== */

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Breedte die het element op het gevelvlak inneemt. */
export function elementWidth(d: FacadeDef): number {
  switch (d.kind) {
    case 'window':
    case 'door':
    case 'balcony':
    case 'canopy':
    case 'stairs':
      return d.width + (d.kind === 'stairs' && d.style === 'side' ? d.steps * 0.075 : 0);
    case 'sign':
      return d.style === 'blade' ? 0.22 : 0.74;
  }
}

/** Middenpositie (lokale x) van het element binnen zijn span, afhankelijk van uitlijning. */
export function itemCenterX(d: FacadeDef, item: Pick<FacadeItem, 'align'>): number {
  const w = d.span[0];
  const ew = elementWidth(d);
  const margin = 0.1;
  if (item.align < 0) return Math.min(w / 2, margin + ew / 2);
  if (item.align > 0) return Math.max(w / 2, w - margin - ew / 2);
  return w / 2;
}

/** Het gat in de gevel (alleen voor wand-elementen). */
export function openingRect(d: FacadeDef, item: Pick<FacadeItem, 'align'>): Rect | null {
  const cx = itemCenterX(d, item);
  switch (d.kind) {
    case 'window':
      return { x0: cx - d.width / 2, x1: cx + d.width / 2, y0: d.sill, y1: d.sill + d.height };
    case 'door':
      return { x0: cx - d.width / 2, x1: cx + d.width / 2, y0: d.bottom, y1: d.bottom + d.height };
    case 'balcony':
      if (d.style === 'loggia') return { x0: cx - d.width / 2, x1: cx + d.width / 2, y0: 0, y1: 0.86 };
      if (d.style === 'french') return { x0: cx - d.width / 2, x1: cx + d.width / 2, y0: 0, y1: 0.74 };
      return null;
    default:
      return null;
  }
}

/** Ruimte die het element op het gevelvlak bezet (voor overlapcontrole). */
export function footprintRect(d: FacadeDef, item: Pick<FacadeItem, 'align'>): Rect {
  const cx = itemCenterX(d, item);
  const op = openingRect(d, item);
  if (op) {
    const extra = d.kind === 'window' && d.sillPlate ? 0.03 : 0.02;
    return { x0: op.x0 - 0.02, x1: op.x1 + 0.02, y0: op.y0 - extra, y1: op.y1 + 0.02 };
  }
  const hw = elementWidth(d) / 2;
  switch (d.kind) {
    case 'balcony':
      return { x0: cx - hw, x1: cx + hw, y0: -d.slab, y1: d.railHeight };
    case 'canopy':
      if (d.style === 'awning') return { x0: cx - hw, x1: cx + hw, y0: d.height - 0.2, y1: d.height + 0.02 };
      if (d.style === 'portal') return { x0: cx - hw, x1: cx + hw, y0: -FL, y1: d.height + d.thickness };
      return { x0: cx - hw, x1: cx + hw, y0: d.height, y1: d.height + d.thickness };
    case 'sign':
      if (d.style === 'blade') return { x0: cx - hw, x1: cx + hw, y0: 0.2, y1: d.span[1] - 0.15 };
      return { x0: cx - hw, x1: cx + hw, y0: 0.86, y1: 1.0 };
    case 'stairs':
      return { x0: cx - hw, x1: cx + hw, y0: -FL, y1: 0 };
    default:
      return { x0: cx - hw, x1: cx + hw, y0: 0, y1: 1 };
  }
}

/* =====================================================================
 * Bouwstenen
 * ===================================================================== */

type V3 = [number, number, number];

/** Vierhoek met gewenste normaal (volgorde wordt zo nodig omgedraaid). */
function face(mat: THREE.Material, pts: V3[], nrm: V3) {
  const a = new THREE.Vector3(...pts[0]);
  const n = new THREE.Vector3(...pts[1]).sub(a).cross(new THREE.Vector3(...pts[3]).sub(a));
  if (n.dot(new THREE.Vector3(...nrm)) < 0) pts = [...pts].reverse();
  return quad(mat, pts);
}

/** Dagkanten: de binnenzijden van een rechthoekig gat, diepte dp. */
function reveals(g: THREE.Group, r: Rect, dp: number, mat: THREE.Material, top = true, bottom = true) {
  const { x0, x1, y0, y1 } = r;
  g.add(face(mat, [[x0, y0, 0], [x0, y0, -dp], [x0, y1, -dp], [x0, y1, 0]], [1, 0, 0]));
  g.add(face(mat, [[x1, y0, 0], [x1, y0, -dp], [x1, y1, -dp], [x1, y1, 0]], [-1, 0, 0]));
  if (bottom) g.add(face(mat, [[x0, y0, 0], [x1, y0, 0], [x1, y0, -dp], [x0, y0, -dp]], [0, 1, 0]));
  if (top) g.add(face(mat, [[x0, y1, 0], [x1, y1, 0], [x1, y1, -dp], [x0, y1, -dp]], [0, -1, 0]));
}

/** Boog: vulstukken in de gevel + gebogen dagkant. Gat is rechthoekig uitgespaard tot y1. */
function archParts(g: THREE.Group, r: Rect, dp: number, wallMat: THREE.Material) {
  const R = (r.x1 - r.x0) / 2;
  const cx = (r.x0 + r.x1) / 2;
  const ys = r.y1 - R;
  // vulstukken (links en rechts boven de boog)
  const shape = new THREE.Shape();
  shape.moveTo(r.x1, ys);
  shape.lineTo(r.x1, r.y1);
  shape.lineTo(r.x0, r.y1);
  shape.lineTo(r.x0, ys);
  shape.absarc(cx, ys, R, Math.PI, 0, true);
  const sg = new THREE.ShapeGeometry(shape, 24);
  // planaire UV's in wereldmaat zijn hier niet nodig (stuc is fijnmazig)
  const sm = new THREE.Mesh(sg, wallMat);
  sm.position.z = 0.0004;
  sm.receiveShadow = true;
  g.add(sm);
  // gebogen dagkant
  const N = 24;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * Math.PI;
    const px = cx + Math.cos(t) * R;
    const py = ys + Math.sin(t) * R;
    pos.push(px, py, 0, px, py, -dp);
    nor.push(-Math.cos(t), -Math.sin(t), 0, -Math.cos(t), -Math.sin(t), 0);
    if (k < N) {
      const b = k * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ag.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  ag.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  ag.setIndex(idx);
  const am = new THREE.Mesh(ag, wallMat);
  am.receiveShadow = true;
  g.add(am);
  // rechte dagkanten onder de boog
  reveals(g, { x0: r.x0, x1: r.x1, y0: r.y0, y1: ys }, dp, wallMat, false, true);
}

/** Vorm: rechthoek met halfronde bovenkant. */
function archShape(x0: number, x1: number, y0: number, y1: number) {
  const R = (x1 - x0) / 2;
  const s = new THREE.Shape();
  s.moveTo(x0, y0);
  s.lineTo(x1, y0);
  s.lineTo(x1, y1 - R);
  s.absarc((x0 + x1) / 2, y1 - R, R, 0, Math.PI, false);
  s.lineTo(x0, y0);
  return s;
}

/** Kozijn: vier balkjes rond een rechthoek. */
function frameRect(g: THREE.Group, r: Rect, t: number, z0: number, z1: number, mat: THREE.Material, bottom = true) {
  g.add(rboxAt(mat, r.x0, r.y0, z0, r.x0 + t, r.y1, z1, 0.004));
  g.add(rboxAt(mat, r.x1 - t, r.y0, z0, r.x1, r.y1, z1, 0.004));
  g.add(rboxAt(mat, r.x0 + t, r.y1 - t, z0, r.x1 - t, r.y1, z1, 0.004));
  if (bottom) g.add(rboxAt(mat, r.x0 + t, r.y0, z0, r.x1 - t, r.y0 + t, z1, 0.004));
}

/** Glasvlak (vlak). */
function glassPane(g: THREE.Group, r: Rect, z: number, mat: THREE.Material = glass()) {
  const m = face(mat, [[r.x0, r.y0, z], [r.x1, r.y0, z], [r.x1, r.y1, z], [r.x0, r.y1, z]], [0, 0, 1]);
  m.castShadow = false;
  g.add(m);
}

function railing(
  g: THREE.Group,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  h: number,
  mat: THREE.Material,
  sides = true,
) {
  const t = 0.012; // leuning
  const b = 0.0065; // spijl
  const gap = 0.034;
  // bovenregel voor
  g.add(rboxAt(mat, x0, y + h - t, z1 - t, x1, y + h, z1, 0.003));
  g.add(boxAt(mat, x0, y + 0.02, z1 - t * 0.8, x1, y + 0.03, z1 - t * 0.2));
  const n = Math.max(2, Math.round((x1 - x0) / gap));
  for (let i = 0; i <= n; i++) {
    const x = x0 + t / 2 + ((x1 - x0 - t) * i) / n;
    g.add(boxAt(mat, x - b / 2, y, z1 - t * 0.75, x + b / 2, y + h - t, z1 - t * 0.25));
  }
  if (sides) {
    for (const sx of [x0, x1 - t]) {
      g.add(rboxAt(mat, sx, y + h - t, z0, sx + t, y + h, z1, 0.003));
      g.add(boxAt(mat, sx + t * 0.2, y + 0.02, z0, sx + t * 0.8, y + 0.03, z1));
      const m = Math.max(1, Math.round((z1 - z0) / gap));
      for (let i = 0; i < m; i++) {
        const z = z0 + 0.01 + ((z1 - z0 - t) * i) / m;
        g.add(boxAt(mat, sx + t * 0.25, y, z - b / 2, sx + t * 0.75, y + h - t, z + b / 2));
      }
    }
  }
}

/* =====================================================================
 * Ramen
 * ===================================================================== */

function buildWindow(d: WindowDef, item: FacadeItem, wallMat: THREE.Material) {
  const g = new THREE.Group();
  const cx = itemCenterX(d, item);
  const r: Rect = { x0: cx - d.width / 2, x1: cx + d.width / 2, y0: d.sill, y1: d.sill + d.height };
  const dp = d.depth;
  const fmat = clay(item.color, 0.55);
  const ft = d.frame;
  const fz0 = -dp;
  const fz1 = -dp + 0.028;

  if (d.arch) {
    archParts(g, r, dp, wallMat);
    const R = d.width / 2;
    const ys = r.y1 - R;
    // glas
    const gs = new THREE.Mesh(new THREE.ShapeGeometry(archShape(r.x0, r.x1, r.y0, r.y1), 24), glass());
    gs.position.z = -dp + 0.01;
    g.add(gs);
    // kozijn: rechte stijlen + boog
    g.add(rboxAt(fmat, r.x0, r.y0, fz0, r.x0 + ft, ys, fz1, 0.004));
    g.add(rboxAt(fmat, r.x1 - ft, r.y0, fz0, r.x1, ys, fz1, 0.004));
    g.add(rboxAt(fmat, r.x0 + ft, r.y0, fz0, r.x1 - ft, r.y0 + ft, fz1, 0.004));
    const tor = new THREE.Mesh(new THREE.TorusGeometry(R - ft / 2, ft / 2, 8, 28, Math.PI), fmat);
    tor.scale.z = (fz1 - fz0) / ft;
    tor.position.set(cx, ys, (fz0 + fz1) / 2);
    tor.castShadow = true;
    g.add(tor);
    // roeden
    const mt = ft * 0.55;
    g.add(boxAt(fmat, cx - mt / 2, r.y0, fz0 + 0.004, cx + mt / 2, r.y1 - ft, fz1 - 0.006));
    for (let i = 1; i < d.rows; i++) {
      const y = r.y0 + ((ys - r.y0) * i) / (d.rows - 1 || 1);
      if (y >= ys - 0.001) continue;
      g.add(boxAt(fmat, r.x0, y - mt / 2, fz0 + 0.004, r.x1, y + mt / 2, fz1 - 0.006));
    }
    g.add(boxAt(fmat, r.x0, ys - mt / 2, fz0 + 0.004, r.x1, ys + mt / 2, fz1 - 0.006));
  } else {
    reveals(g, r, dp, wallMat);
    frameRect(g, r, ft, fz0, fz1, fmat);
    const inner: Rect = { x0: r.x0 + ft, x1: r.x1 - ft, y0: r.y0 + ft, y1: r.y1 - ft };
    if (d.curtains) {
      glassPane(g, inner, -dp + 0.004, curtain());
      const cg = face(clearGlass(), [[inner.x0, inner.y0, -dp + 0.014], [inner.x1, inner.y0, -dp + 0.014], [inner.x1, inner.y1, -dp + 0.014], [inner.x0, inner.y1, -dp + 0.014]], [0, 0, 1]);
      cg.castShadow = false;
      g.add(cg);
    } else glassPane(g, inner, -dp + 0.01);
    const mt = ft * 0.6;
    for (let i = 1; i < d.cols; i++) {
      const x = inner.x0 + ((inner.x1 - inner.x0) * i) / d.cols;
      g.add(boxAt(fmat, x - mt / 2, inner.y0, fz0 + 0.004, x + mt / 2, inner.y1, fz1 - 0.004));
    }
    for (let i = 1; i < d.rows; i++) {
      const y = inner.y0 + ((inner.y1 - inner.y0) * i) / d.rows;
      g.add(boxAt(fmat, inner.x0, y - mt / 2, fz0 + 0.004, inner.x1, y + mt / 2, fz1 - 0.004));
    }
  }
  if (d.sillPlate) {
    const sm = clay(item.accent, 0.8);
    g.add(rboxAt(sm, r.x0 - 0.025, r.y0 - 0.022, -dp + 0.01, r.x1 + 0.025, r.y0 + 0.002, 0.045, 0.006));
  }
  return g;
}

/* =====================================================================
 * Deuren
 * ===================================================================== */

function handle(g: THREE.Group, x: number, y: number, z: number, long = true) {
  const m = clay('#c9ccd1', 0.35);
  if (long) g.add(rboxAt(m, x - 0.006, y, z, x + 0.006, y + 0.16, z + 0.018, 0.004));
  else g.add(mesh(sphere(0.012, 12, 8), m, x, y, z + 0.01));
}

function buildDoor(d: DoorDef, item: FacadeItem, wallMat: THREE.Material) {
  const g = new THREE.Group();
  const cx = itemCenterX(d, item);
  const r: Rect = { x0: cx - d.width / 2, x1: cx + d.width / 2, y0: d.bottom, y1: d.bottom + d.height };
  const dp = d.depth;
  const main = clay(item.color, 0.7);
  const acc = clay(item.accent, 0.6);
  const ft = 0.022;
  const fz0 = -dp;
  const fz1 = -dp + 0.03;
  const lz0 = -dp + 0.004;
  const lz1 = -dp + 0.024;

  if (d.style === 'arch') {
    archParts(g, r, dp, wallMat);
    const sh = archShape(r.x0 + 0.004, r.x1 - 0.004, r.y0, r.y1 - 0.002);
    const lg = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 28 });
    const leaf = new THREE.Mesh(lg, main);
    leaf.position.z = -dp;
    leaf.castShadow = leaf.receiveShadow = true;
    g.add(leaf);
    // paneellijnen + knop
    const groove = clay(shade(item.color, -0.18), 0.8);
    g.add(boxAt(groove, cx - 0.002, r.y0 + 0.03, -dp + 0.026, cx + 0.002, r.y1 - (r.x1 - r.x0) / 2, -dp + 0.03));
    handle(g, r.x1 - 0.05, r.y0 + 0.36, -dp + 0.026, false);
    return g;
  }

  reveals(g, r, dp, wallMat, true, true);
  frameRect(g, r, ft, fz0, fz1, acc, false);
  const inner: Rect = { x0: r.x0 + ft, x1: r.x1 - ft, y0: r.y0, y1: r.y1 - ft };

  switch (d.style) {
    case 'panel': {
      g.add(rboxAt(main, inner.x0 + 0.002, inner.y0, lz0, inner.x1 - 0.002, inner.y1 - 0.002, lz1, 0.004));
      const gm = clay(shade(item.color, -0.2), 0.7);
      g.add(boxAt(gm, inner.x0 + 0.04, inner.y0 + 0.06, lz1, inner.x1 - 0.04, inner.y0 + 0.064, lz1 + 0.003));
      handle(g, inner.x1 - 0.04, r.y0 + 0.28, lz1);
      break;
    }
    case 'double': {
      const split = d.transom ? inner.y1 - 0.13 : inner.y1;
      if (d.transom) {
        g.add(rboxAt(acc, inner.x0, split - ft / 2, fz0, inner.x1, split + ft / 2, fz1, 0.003));
        glassPane(g, { x0: inner.x0, x1: inner.x1, y0: split + ft / 2, y1: inner.y1 }, -dp + 0.01);
        const mx = (inner.x0 + inner.x1) / 2;
        g.add(boxAt(acc, mx - 0.006, split, fz0 + 0.004, mx + 0.006, inner.y1, fz1 - 0.004));
      }
      const mid = (inner.x0 + inner.x1) / 2;
      for (const [a, b] of [
        [inner.x0 + 0.002, mid - 0.003],
        [mid + 0.003, inner.x1 - 0.002],
      ]) {
        g.add(rboxAt(main, a, inner.y0, lz0, b, split - ft / 2 - 0.002, lz1, 0.004));
        // glas in de deur
        glassPane(g, { x0: a + 0.04, x1: b - 0.04, y0: inner.y0 + 0.3, y1: split - 0.08 }, lz1 + 0.001);
      }
      handle(g, mid - 0.025, r.y0 + 0.3, lz1);
      handle(g, mid + 0.025, r.y0 + 0.3, lz1);
      break;
    }
    case 'garage': {
      const back = clay(shade(item.color, -0.35), 0.8);
      glassPane(g, inner, lz0, back);
      const cols = 2;
      const rows = 5;
      const gap = 0.012;
      const pw = (inner.x1 - inner.x0 - gap * (cols + 1)) / cols;
      const ph = (inner.y1 - inner.y0 - gap * (rows + 1)) / rows;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const x = inner.x0 + gap + i * (pw + gap);
          const y = inner.y0 + gap + j * (ph + gap);
          g.add(rboxAt(main, x, y, lz0, x + pw, y + ph, lz1, 0.006));
        }
      break;
    }
    case 'slats': {
      const back = clay('#1d1f22', 0.8);
      glassPane(g, inner, lz0, back);
      const n = Math.max(5, Math.round((inner.x1 - inner.x0) / 0.03));
      const sw = (inner.x1 - inner.x0) / n;
      const wood = cladMat('wood', item.color);
      for (let i = 0; i < n; i++) {
        const x = inner.x0 + i * sw;
        g.add(rboxAt(wood, x + 0.003, inner.y0 + 0.004, lz0, x + sw - 0.003, inner.y1 - 0.004, lz1, 0.004));
      }
      handle(g, inner.x1 - 0.035, r.y0 + 0.28, lz1, true);
      break;
    }
    case 'glass': {
      // pui: zijlichten + glazen deur + bovenlicht; hoofdkleur = kozijn
      const fm = clay(item.color, 0.55);
      frameRect(g, r, ft, fz0, fz1, fm, false);
      const split = inner.y1 - 0.12;
      const sideW = d.sideLight ? (inner.x1 - inner.x0) * 0.26 : 0;
      g.add(rboxAt(fm, inner.x0, split - ft / 2, fz0, inner.x1, split + ft / 2, fz1, 0.003));
      glassPane(g, { x0: inner.x0, x1: inner.x1, y0: split, y1: inner.y1 }, -dp + 0.01);
      const dx0 = inner.x0 + sideW;
      const dx1 = inner.x1 - sideW;
      for (const x of [dx0, dx1]) if (sideW) g.add(rboxAt(fm, x - ft / 2, inner.y0, fz0, x + ft / 2, split, fz1, 0.003));
      if (sideW) {
        glassPane(g, { x0: inner.x0, x1: dx0 - ft / 2, y0: inner.y0, y1: split }, -dp + 0.01);
        glassPane(g, { x0: dx1 + ft / 2, x1: inner.x1, y0: inner.y0, y1: split }, -dp + 0.01);
        g.add(rboxAt(fm, inner.x0, inner.y0, fz0, dx0, inner.y0 + 0.05, fz1, 0.003));
        g.add(rboxAt(fm, dx1, inner.y0, fz0, inner.x1, inner.y0 + 0.05, fz1, 0.003));
      }
      // deurvleugel
      const dm = clay(item.accent, 0.55);
      const lx0 = dx0 + ft / 2 + 0.002;
      const lx1 = dx1 - ft / 2 - 0.002;
      frameRect(g, { x0: lx0, x1: lx1, y0: inner.y0, y1: split - ft / 2 - 0.002 }, 0.02, lz0, lz1 + 0.004, dm);
      glassPane(g, { x0: lx0 + 0.02, x1: lx1 - 0.02, y0: inner.y0 + 0.02, y1: split - 0.03 }, lz0 + 0.008);
      handle(g, lx1 - 0.03, r.y0 + 0.28, lz1 + 0.004);
      break;
    }
  }
  // dorpel
  if (d.bottom >= 0) g.add(rboxAt(clay('#c9c6bf', 0.85), r.x0, r.y0 - 0.006, -dp, r.x1, r.y0 + 0.006, 0.02, 0.004));
  return g;
}

/* =====================================================================
 * Balkons
 * ===================================================================== */

function buildBalcony(d: BalconyDef, item: FacadeItem, wallMat: THREE.Material) {
  const g = new THREE.Group();
  const cx = itemCenterX(d, item);
  const x0 = cx - d.width / 2;
  const x1 = cx + d.width / 2;
  const main = clay(item.color, 0.88);
  const acc = clay(item.accent, 0.5);

  if (d.style === 'cantilever') {
    g.add(rboxAt(main, x0, -d.slab, 0, x1, 0, d.depth, 0.014));
    if (d.rail === 'bars') railing(g, x0 + 0.01, x1 - 0.01, 0.005, d.depth - 0.01, 0, d.railHeight, acc);
    else if (d.rail === 'solid') {
      const t = 0.028;
      g.add(rboxAt(main, x0, 0, d.depth - t, x1, d.railHeight, d.depth, 0.01));
      g.add(rboxAt(main, x0, 0, 0, x0 + t, d.railHeight, d.depth - t + 0.001, 0.01));
      g.add(rboxAt(main, x1 - t, 0, 0, x1, d.railHeight, d.depth - t + 0.001, 0.01));
    } else {
      const gm = clearGlass();
      const z = d.depth - 0.02;
      const pane = (pts: V3[], n: V3) => {
        const m = face(gm, pts, n);
        m.castShadow = false;
        g.add(m);
        const back = face(gm, [...pts].reverse(), [-n[0], -n[1], -n[2]]);
        back.castShadow = false;
        g.add(back);
      };
      pane([[x0 + 0.01, 0.01, z], [x1 - 0.01, 0.01, z], [x1 - 0.01, d.railHeight - 0.01, z], [x0 + 0.01, d.railHeight - 0.01, z]], [0, 0, 1]);
      pane([[x0 + 0.015, 0.01, 0.01], [x0 + 0.015, 0.01, z], [x0 + 0.015, d.railHeight - 0.01, z], [x0 + 0.015, d.railHeight - 0.01, 0.01]], [-1, 0, 0]);
      pane([[x1 - 0.015, 0.01, 0.01], [x1 - 0.015, 0.01, z], [x1 - 0.015, d.railHeight - 0.01, z], [x1 - 0.015, d.railHeight - 0.01, 0.01]], [1, 0, 0]);
      g.add(rboxAt(acc, x0, d.railHeight - 0.012, z - 0.012, x1, d.railHeight, z + 0.012, 0.004));
      g.add(rboxAt(acc, x0, d.railHeight - 0.012, 0, x0 + 0.024, d.railHeight, z, 0.004));
      g.add(rboxAt(acc, x1 - 0.024, d.railHeight - 0.012, 0, x1, d.railHeight, z, 0.004));
    }
    return g;
  }

  if (d.style === 'loggia') {
    const r: Rect = { x0, x1, y0: 0, y1: 0.86 };
    const dp = d.depth;
    const inner = cladMat('stucco', item.color);
    reveals(g, r, dp, inner, true, false);
    // vloer
    g.add(face(clay('#b8b4ac', 0.9), [[x0, 0, 0], [x1, 0, 0], [x1, 0, -dp], [x0, 0, -dp]], [0, 1, 0]));
    // achterwand met deur en raam
    const back = face(inner, [[x0, 0, -dp], [x1, 0, -dp], [x1, r.y1, -dp], [x0, r.y1, -dp]], [0, 0, 1]);
    g.add(back);
    const fm = clay('#2a2e35', 0.55);
    const dx0 = x0 + 0.08;
    const dx1 = dx0 + 0.28;
    frameRect(g, { x0: dx0, x1: dx1, y0: 0, y1: 0.7 }, 0.02, -dp, -dp + 0.025, fm, true);
    glassPane(g, { x0: dx0 + 0.02, x1: dx1 - 0.02, y0: 0.02, y1: 0.68 }, -dp + 0.006);
    const wx0 = dx1 + 0.06;
    const wx1 = x1 - 0.08;
    if (wx1 - wx0 > 0.12) {
      frameRect(g, { x0: wx0, x1: wx1, y0: 0.3, y1: 0.7 }, 0.02, -dp, -dp + 0.025, fm, true);
      glassPane(g, { x0: wx0 + 0.02, x1: wx1 - 0.02, y0: 0.32, y1: 0.68 }, -dp + 0.006);
    }
    railing(g, x0 + 0.004, x1 - 0.004, -0.04, 0.0, 0, d.railHeight, acc, false);
    return g;
  }

  // Frans balkon: glazen deur in de gevel + hekje vlak ervoor
  const r: Rect = { x0, x1, y0: 0, y1: 0.74 };
  const dp = 0.06;
  reveals(g, r, dp, wallMat);
  frameRect(g, r, 0.022, -dp, -dp + 0.03, main, false);
  const mid = cx;
  g.add(rboxAt(main, mid - 0.01, 0, -dp, mid + 0.01, r.y1, -dp + 0.03, 0.003));
  glassPane(g, { x0: x0 + 0.022, x1: x1 - 0.022, y0: 0.02, y1: r.y1 - 0.022 }, -dp + 0.008);
  g.add(rboxAt(clay('#c9c6bf'), x0, -0.006, -dp, x1, 0.006, 0.02, 0.004));
  railing(g, x0 - 0.02, x1 + 0.02, 0.0, 0.035, 0.05, d.railHeight, acc, false);
  return g;
}

/* =====================================================================
 * Luifels
 * ===================================================================== */

function buildCanopy(d: CanopyDef, item: FacadeItem) {
  const g = new THREE.Group();
  const cx = itemCenterX(d, item);
  const x0 = cx - d.width / 2;
  const x1 = cx + d.width / 2;
  const main = clay(item.color, 0.88);
  if (d.style === 'slab') {
    g.add(rboxAt(main, x0, d.height, 0, x1, d.height + d.thickness, d.depth, 0.012));
    if (d.lamp) {
      g.add(mesh(cyl(0.035, 0.035, 0.01, 20), emissive(item.accent, 2.2), cx, d.height - 0.004, d.depth * 0.55, false));
    }
  } else if (d.style === 'portal') {
    const t = 0.07;
    const top = d.height + d.thickness;
    g.add(rboxAt(main, x0, d.height, 0, x1, top, d.depth, 0.012));
    g.add(rboxAt(main, x0, -FL, 0, x0 + t, d.height + 0.001, d.depth, 0.012));
    g.add(rboxAt(main, x1 - t, -FL, 0, x1, d.height + 0.001, d.depth, 0.012));
    // binnenkant iets lichter vlak tegen gevel (kleurvlak rond deur)
    const inner = clay(shade(item.color, 0.08), 0.9);
    g.add(face(inner, [[x0 + t, -FL, 0.002], [x1 - t, -FL, 0.002], [x1 - t, d.height, 0.002], [x0 + t, d.height, 0.002]], [0, 0, 1]));
    if (d.lamp) g.add(mesh(cyl(0.03, 0.03, 0.01, 20), emissive(item.accent, 2.2), cx, d.height - 0.004, d.depth * 0.5, false));
  } else {
    // gestreepte markies: schuin doek + geschulpte rand + armpjes
    const sm = stripeMat(item.color, item.accent);
    const yTop = d.height;
    const yLow = d.height - 0.14;
    const geo = new THREE.PlaneGeometry(d.width, Math.hypot(d.depth, yTop - yLow), 1, 1);
    const p = new THREE.Mesh(geo, sm);
    const ang = Math.atan2(yTop - yLow, d.depth);
    p.position.set(cx, (yTop + yLow) / 2, d.depth / 2);
    p.rotation.x = -Math.PI / 2 + ang;
    p.castShadow = p.receiveShadow = true;
    g.add(p);
    // geschulpte voorrand
    const n = 8;
    const sw = d.width / n;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(sw, 0);
      s.lineTo(sw, -0.03);
      s.absarc(sw / 2, -0.03, sw / 2, 0, Math.PI, true);
      s.lineTo(0, 0);
      const sg = new THREE.ShapeGeometry(s, 10);
      const m = new THREE.Mesh(sg, clay(i % 2 ? item.accent : item.color, 0.85));
      (m.material as THREE.Material).side = THREE.DoubleSide;
      m.position.set(x0 + i * sw, yLow, d.depth);
      m.castShadow = true;
      g.add(m);
    }
    const arm = clay('#2a2e35', 0.5);
    for (const x of [x0 + 0.02, x1 - 0.02]) {
      const a = boxAt(arm, x - 0.004, -0.004, 0, x + 0.004, 0.004, Math.hypot(d.depth, 0.2));
      a.position.set(x, yTop - 0.2, 0);
      a.rotation.x = -Math.atan2(0.06, d.depth);
      const holder = new THREE.Group();
      holder.add(a);
      g.add(holder);
    }
    g.add(rboxAt(clay(item.color, 0.8), x0 - 0.01, yTop - 0.02, 0, x1 + 0.01, yTop + 0.02, 0.04, 0.012));
  }
  return g;
}

/* =====================================================================
 * Gevelborden
 * ===================================================================== */

function buildSign(d: SignDef, item: FacadeItem) {
  const g = new THREE.Group();
  const cx = itemCenterX(d, item);
  const text = (item.text ?? d.defaultText).toUpperCase().slice(0, 14) || ' ';
  const main = clay(item.color, 0.8);
  const fp = footprintRect(d, item);
  const tex = textTexture(text, d.style === 'blade', item.accent);
  const letters = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, alphaTest: 0.2 });
  const t = 0.05;
  g.add(rboxAt(main, fp.x0, fp.y0, 0, fp.x1, fp.y1, t, 0.014));
  // letters (licht verhoogd, met schaduw-effect via tweede laag)
  const shadowLetters = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: '#000000', opacity: 0.18, alphaTest: 0.2 });
  const w = fp.x1 - fp.x0;
  const h = fp.y1 - fp.y0;
  const aspect = tex.image.width / tex.image.height;
  let lw = w * 0.86;
  let lh = lw / aspect;
  if (lh > h * 0.84) {
    lh = h * 0.84;
    lw = lh * aspect;
  }
  const lg = new THREE.PlaneGeometry(lw, lh);
  const lm = new THREE.Mesh(lg, letters);
  lm.position.set(cx, (fp.y0 + fp.y1) / 2, t + 0.004);
  g.add(lm);
  const ls = new THREE.Mesh(lg, shadowLetters);
  ls.position.set(cx + 0.004, (fp.y0 + fp.y1) / 2 - 0.004, t + 0.002);
  g.add(ls);
  return g;
}

/* =====================================================================
 * Trappen
 * ===================================================================== */

function buildStairs(d: StairDef, item: FacadeItem) {
  const g = new THREE.Group();
  const cx = itemCenterX(d, item);
  const m = clay(item.color, 0.85);
  const n = d.steps;
  const sh = FL / n;
  if (d.style === 'side') {
    // trap evenwijdig aan de gevel: bordes links (bij de deur), treden dalen naar rechts
    const td = 0.075;
    const depth = 0.22;
    const total = n * td + d.width;
    const left = cx - total / 2;
    g.add(rboxAt(m, left, -FL, 0, left + d.width, 0, depth, 0.008));
    for (let i = 0; i < n; i++) {
      const xa = left + d.width + i * td;
      g.add(rboxAt(m, xa + 0.002, -FL, 0, xa + td, -FL + ((n - i) * FL) / (n + 1), depth, 0.006));
    }
    return g;
  }
  const td = d.style === 'wide' ? 0.1 : 0.085;
  const hw = d.width / 2;
  for (let i = 0; i < n; i++) {
    const y1 = -FL + (i + 1) * sh;
    const z1 = (n - i) * td;
    g.add(rboxAt(m, cx - hw - (n - i) * 0.006, -FL + i * sh, 0, cx + hw + (n - i) * 0.006, y1, z1, 0.008));
  }
  return g;
}

/* =====================================================================
 * Verdeler
 * ===================================================================== */

export function buildFacadeItem(d: FacadeDef, item: FacadeItem, wallMat: THREE.Material): THREE.Group {
  switch (d.kind) {
    case 'window':
      return buildWindow(d, item, wallMat);
    case 'door':
      return buildDoor(d, item, wallMat);
    case 'balcony':
      return buildBalcony(d, item, wallMat);
    case 'canopy':
      return buildCanopy(d, item);
    case 'sign':
      return buildSign(d, item);
    case 'stairs':
      return buildStairs(d, item);
  }
}

/** Kleur lichter (+) of donkerder (-) maken. */
export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.l = Math.max(0, Math.min(1, hsl.l + amt));
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}
