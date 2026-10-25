import * as THREE from 'three';
import { def, type RoofDef } from '../../catalog/catalog';
import { CellMap, cellCenterX, cellCenterZ, cellTop, DIR_VEC, key } from '../../core/grid';
import type { Cell, Design, Dir, RoofStyle } from '../../core/types';
import { GeoBuckets, roundedBox } from '../blockGeometry';
import { clay } from '../materials';
import { bbox } from '../shapes';

export const DEFAULT_ROOF: RoofStyle = { type: 'roof-parapet', color: '#2d3036', accent: '#9a9a96' };

export function roofOf(c: Cell): { style: RoofStyle; def: RoofDef } {
  const style = c.roof ?? DEFAULT_ROOF;
  let d: RoofDef;
  try {
    d = def<RoofDef>(style.type);
  } catch {
    d = def<RoofDef>(DEFAULT_ROOF.type);
  }
  return { style, def: d };
}

/** Materiaalsleutel voor het bovenvlak van een dakcel. */
export function topMatKey(c: Cell): string {
  const { style, def: d } = roofOf(c);
  const acc = style.accent ?? d.accent;
  switch (d.style) {
    case 'parapet':
      return `stucco|${acc}`;
    case 'terrace':
      return `tiles|${acc}`;
    case 'none':
      return `stucco|${style.color}`;
    default:
      return `${c.cladding}|${c.color}`;
  }
}

/** Kan de dakhoogte (voor schoorstenen e.d.) op een dakcel opvragen. */
export function roofExtra(c: Cell): number {
  const { def: d } = roofOf(c);
  if (d.style === 'shed') return (d.rise ?? 0.3) + 0.06;
  if (d.style === 'overhang') return d.height;
  return 0;
}

const HDIRS: Dir[] = ['px', 'nx', 'pz', 'nz'];

interface Run {
  dir: Dir;
  y: number;
  line: number; // coördinaat van de rand (z voor pz/nz, x voor px/nx) in celindex
  a0: number;
  a1: number; // celindices langs de rand (inclusief)
  color: string;
  height: number;
  edge: number;
  terrace: boolean;
  railColor: string;
}

export function buildRoofs(design: Design, cm: CellMap, buckets: GeoBuckets, group: THREE.Group) {
  const W = design.plot.w;
  const D = design.plot.d;
  const tops = design.cells.filter((c) => cm.isTop(c));

  // ---------------------------------------------------------------- dakranden (parapet/terras)
  const edges = new Map<string, { cell: Cell; along: number }[]>();
  const runMeta = new Map<string, Omit<Run, 'a0' | 'a1'>>();
  for (const c of tops) {
    const { style, def: d } = roofOf(c);
    if (d.style !== 'parapet' && d.style !== 'terrace') continue;
    for (const dir of HDIRS) {
      if (cm.neighbor(c, dir)) continue;
      const alongX = dir === 'pz' || dir === 'nz';
      const line = alongX ? c.z : c.x;
      const k = `${dir}|${c.y}|${line}|${style.color}|${d.id}`;
      if (!edges.has(k)) {
        edges.set(k, []);
        runMeta.set(k, {
          dir,
          y: c.y,
          line,
          color: style.color,
          height: d.height,
          edge: d.edge,
          terrace: d.style === 'terrace',
          railColor: style.color,
        });
      }
      edges.get(k)!.push({ cell: c, along: alongX ? c.x : c.z });
    }
  }
  const railBars: THREE.Matrix4[] = [];
  const railMat = new Map<string, THREE.Matrix4[]>();
  for (const [k, list] of edges) {
    list.sort((a, b) => a.along - b.along);
    const meta = runMeta.get(k)!;
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      if (i === list.length || list[i].along !== list[i - 1].along + 1) {
        const run: Run = { ...meta, a0: list[start].along, a1: list[i - 1].along };
        buildCopingRun(run, cm, W, D, buckets, railBars);
        if (run.terrace) {
          const arr = railMat.get(run.railColor) ?? [];
          arr.push(...railBars.splice(0));
          railMat.set(run.railColor, arr);
        }
        railBars.length = 0;
        start = i;
      }
    }
  }
  for (const [color, mats] of railMat) {
    if (!mats.length) continue;
    const im = new THREE.InstancedMesh(bbox(1, 1, 1), clay(color, 0.5), mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.userData.kind = 'roof';
    group.add(im);
  }

  // ---------------------------------------------------------------- overstek
  for (const c of tops) {
    const { style, def: d } = roofOf(c);
    if (d.style !== 'overhang') continue;
    const cx = cellCenterX(c.x, W);
    const cz = cellCenterZ(c.z, D);
    const top = cellTop(c.y);
    const ov = d.edge;
    const ext = (dir: Dir) => (cm.neighbor(c, dir) ? 0 : ov);
    const min: [number, number, number] = [cx - 0.5 - ext('nx'), top, cz - 0.5 - ext('nz')];
    const max: [number, number, number] = [cx + 0.5 + ext('px'), top + d.height, cz + 0.5 + ext('pz')];
    const join = (dir: Dir) => !!cm.neighbor(c, dir);
    const fasciaKey = `${d.fascia ?? 'stucco'}|${style.accent ?? d.accent}`;
    const topKey = `stucco|${style.color}`;
    buckets.addBlock({
      min,
      max,
      render: [!join('px'), !join('nx'), true, true, !join('pz'), !join('nz')],
      round: [!join('px'), !join('nx'), true, true, !join('pz'), !join('nz')],
      mat: [fasciaKey, fasciaKey, topKey, fasciaKey, fasciaKey, fasciaKey],
      r: 0.014,
      segs: 2,
    });
  }

  // ---------------------------------------------------------------- lessenaarsdak
  const seen = new Set<string>();
  for (const c of tops) {
    const { def: d } = roofOf(c);
    if (d.style !== 'shed' || seen.has(key(c.x, c.y, c.z))) continue;
    // regio verzamelen (zelfde hoogte, aaneengesloten, ook lessenaarsdak)
    const region: Cell[] = [];
    const stack = [c];
    seen.add(key(c.x, c.y, c.z));
    while (stack.length) {
      const cur = stack.pop()!;
      region.push(cur);
      for (const dir of HDIRS) {
        const n = cm.neighbor(cur, dir);
        if (!n || !cm.isTop(n) || seen.has(key(n.x, n.y, n.z))) continue;
        if (roofOf(n).def.style !== 'shed') continue;
        seen.add(key(n.x, n.y, n.z));
        stack.push(n);
      }
    }
    buildShedRegion(region, cm, W, D, buckets, group);
  }
}

function buildCopingRun(r: Run, cm: CellMap, W: number, D: number, buckets: GeoBuckets, bars: THREE.Matrix4[]) {
  const alongX = r.dir === 'pz' || r.dir === 'nz';
  const n = DIR_VEC[r.dir];
  const over = 0.014;
  const top = cellTop(r.y);
  // uiteinden: bolle hoek → oversteken; holle hoek → doorlopen tot over de andere rand
  const endExt = (along: number, step: number) => {
    const x = alongX ? along + step : r.line;
    const z = alongX ? r.line : along + step;
    return cm.has(x, r.y, z) ? r.edge : over;
  };
  const e0 = endExt(r.a0, -1);
  const e1 = endExt(r.a1, 1);
  const k = `stucco|${r.color}`;
  const sgn = alongX ? n[2] : n[0];
  const lineCenter = alongX ? cellCenterZ(r.line, D) : cellCenterX(r.line, W);
  const face = lineCenter + sgn * 0.5; // gevelvlak
  const inner = face - sgn * r.edge;
  const outer = face + sgn * over;
  const c0 = Math.min(inner, outer);
  const c1 = Math.max(inner, outer);
  const a0 = (alongX ? cellCenterX(r.a0, W) : cellCenterZ(r.a0, D)) - 0.5 - e0;
  const a1 = (alongX ? cellCenterX(r.a1, W) : cellCenterZ(r.a1, D)) + 0.5 + e1;
  const y0 = top - 0.045;
  const y1 = top + r.height;
  if (alongX) roundedBox(buckets, k, [a0, y0, c0], [a1, y1, c1], 0.012);
  else roundedBox(buckets, k, [c0, y0, a0], [c1, y1, a1], 0.012);

  if (!r.terrace) return;
  // hek op de dakrand
  const mid = (c0 + c1) / 2;
  const h = 0.3;
  const t = 0.012;
  const add = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    bars.push(m);
  };
  const ra0 = a0 + 0.02;
  const ra1 = a1 - 0.02;
  const len = ra1 - ra0;
  const along = (a: number, c: number, y: number, la: number, lc: number, ly: number) =>
    alongX ? add(a, y, c, la, ly, lc) : add(c, y, a, lc, ly, la);
  along((ra0 + ra1) / 2, mid, y1 + h, len, t, t);
  along((ra0 + ra1) / 2, mid, y1 + 0.03, len, t * 0.6, t * 0.6);
  const nb = Math.max(2, Math.round(len / 0.034));
  for (let i = 0; i <= nb; i++) {
    const a = ra0 + (len * i) / nb;
    along(a, mid, y1 + h / 2, 0.0065, 0.0065, h);
  }
}

function buildShedRegion(region: Cell[], cm: CellMap, W: number, D: number, buckets: GeoBuckets, group: THREE.Group) {
  const { style, def: d } = roofOf(region[0]);
  const rot = ((style.rot ?? 0) % 4 + 4) % 4;
  // stijgrichting
  const sdir: [number, number] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ][rot] as [number, number];
  const xs = region.map((c) => cellCenterX(c.x, W));
  const zs = region.map((c) => cellCenterZ(c.z, D));
  const minX = Math.min(...xs) - 0.5;
  const maxX = Math.max(...xs) + 0.5;
  const minZ = Math.min(...zs) - 0.5;
  const maxZ = Math.max(...zs) + 0.5;
  const rise = d.rise ?? 0.3;
  const y0 = cellTop(region[0].y);
  const base = 0.03;
  // t in [0,1] langs de stijgrichting over de hele regio
  const tAt = (x: number, z: number) => {
    if (sdir[0] !== 0) return sdir[0] > 0 ? (x - minX) / (maxX - minX) : (maxX - x) / (maxX - minX);
    return sdir[1] > 0 ? (z - minZ) / (maxZ - minZ) : (maxZ - z) / (maxZ - minZ);
  };
  const hAt = (x: number, z: number) => y0 + base + rise * tAt(x, z);
  const inRegion = new Set(region.map((c) => key(c.x, c.y, c.z)));
  const sheetMat = clay(style.color, 0.55);
  sheetMat.side = THREE.DoubleSide;
  const beamMat = clay(style.accent ?? d.accent, 0.85);
  const ov = d.edge;

  for (const c of region) {
    const cx = cellCenterX(c.x, W);
    const cz = cellCenterZ(c.z, D);
    const wallKey = `${c.cladding}|${c.color}`;
    // wig (opvulling onder het schuine dak)
    const corners: [number, number][] = [
      [cx - 0.5, cz - 0.5],
      [cx + 0.5, cz - 0.5],
      [cx + 0.5, cz + 0.5],
      [cx - 0.5, cz + 0.5],
    ];
    const sides: [Dir, number, number][] = [
      ['nz', 0, 1],
      ['px', 1, 2],
      ['pz', 2, 3],
      ['nx', 3, 0],
    ];
    for (const [dir, i, j] of sides) {
      const nb = cm.neighbor(c, dir);
      if (nb && inRegion.has(key(nb.x, nb.y, nb.z))) continue;
      if (nb && !cm.isTop(nb)) continue;
      const [ax, az] = corners[i];
      const [bx, bz] = corners[j];
      const p0 = new THREE.Vector3(bx, y0, bz);
      const p1 = new THREE.Vector3(ax, y0, az);
      const p2 = new THREE.Vector3(ax, hAt(ax, az), az);
      const p3 = new THREE.Vector3(bx, hAt(bx, bz), bz);
      // volgorde zo dat de normaal naar buiten wijst
      const nrm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0));
      const out = DIR_VEC[dir];
      if (nrm.x * out[0] + nrm.z * out[2] < 0) buckets.addQuad(wallKey, p0, p1, p2, p3);
      else buckets.addQuad(wallKey, p1, p0, p3, p2);
    }
    // golfplaat-stuk
    const ext = (dir: Dir) => {
      const nb = cm.neighbor(c, dir);
      return nb && inRegion.has(key(nb.x, nb.y, nb.z)) ? 0 : ov;
    };
    const x0 = cx - 0.5 - ext('nx');
    const x1 = cx + 0.5 + ext('px');
    const z0 = cz - 0.5 - ext('nz');
    const z1 = cz + 0.5 + ext('pz');
    group.add(corrugated(x0, x1, z0, z1, sdir, hAt, sheetMat));
    // balkkoppen onder de overstek aan de lage en hoge kant
    for (const dir of ['px', 'nx', 'pz', 'nz'] as Dir[]) {
      const v = DIR_VEC[dir];
      const along = v[0] === sdir[0] && v[2] === sdir[1];
      const against = v[0] === -sdir[0] && v[2] === -sdir[1];
      if (!(along || against) || ext(dir) === 0) continue;
      for (let i = 0; i < 4; i++) {
        const f = (i + 0.5) / 4 - 0.5;
        const len = ov + 0.08;
        const bx = v[0] !== 0 ? cx + v[0] * (0.5 + ov / 2 - 0.04) : cx + f;
        const bz = v[2] !== 0 ? cz + v[2] * (0.5 + ov / 2 - 0.04) : cz + f;
        const hy = hAt(bx, bz) - 0.03;
        const m = new THREE.Mesh(bbox(v[0] !== 0 ? len : 0.03, 0.04, v[2] !== 0 ? len : 0.03), beamMat);
        m.position.set(bx, hy, bz);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
    }
  }
}

/** Golfplaat: rasterpatch met sinusprofiel loodrecht op de afschotrichting. */
function corrugated(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  sdir: [number, number],
  hAt: (x: number, z: number) => number,
  mat: THREE.Material,
) {
  const period = 0.05;
  const amp = 0.008;
  const ridgeAlongX = sdir[0] === 0; // golven lopen in de stijgrichting, profiel over de andere as
  const nx = ridgeAlongX ? Math.max(2, Math.round(((x1 - x0) / period) * 6)) : 4;
  const nz = ridgeAlongX ? 4 : Math.max(2, Math.round(((z1 - z0) / period) * 6));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx;
      const z = z0 + ((z1 - z0) * j) / nz;
      const ph = ridgeAlongX ? x : z;
      pos.push(x, hAt(x, z) + 0.012 + amp * Math.sin((ph / period) * Math.PI * 2), z);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.kind = 'roof';
  return m;
}
