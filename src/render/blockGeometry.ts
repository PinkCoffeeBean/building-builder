import * as THREE from 'three';

/**
 * Afgeronde blokgeometrie met selectieve afronding.
 *
 * Elk blok is een doos; per zijde bepalen we of hij getekend wordt (render) en of de rand
 * aan die kant afgerond wordt (round). Vertices op een vlak worden op een "binnendoos"
 * geprojecteerd en met straal r naar buiten geduwd: zo ontstaan ronde randen en hoeken
 * (zoals RoundedBoxGeometry), maar alleen waar het blok echt een buitenrand heeft.
 * Twee aangrenzende blokken van dezelfde kleur ronden naar elkaar toe dus niet af en
 * vormen één naadloos volume. Rechthoekige gaten (ramen/deuren) worden in het raster
 * uitgespaard.
 *
 * Zijde-index: as * 2 + (negatief ? 1 : 0)  →  0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
 */

export interface Hole {
  /** in wereldcoördinaten op de twee raakassen van het vlak */
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

export interface BlockSpec {
  min: [number, number, number];
  max: [number, number, number];
  render: boolean[];
  round: boolean[];
  mat: string[];
  holes?: (Hole[] | undefined)[];
  r: number;
  segs?: number;
}

interface Bucket {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

/** Raakassen per normaal-as: [ta, tb]. */
const TANGENTS: [number, number][] = [
  [2, 1],
  [0, 2],
  [0, 1],
];

const EPS = 1e-6;

export class GeoBuckets {
  buckets = new Map<string, Bucket>();

  get(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { pos: [], nor: [], uv: [], idx: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  addBlock(s: BlockSpec) {
    for (let side = 0; side < 6; side++) {
      if (!s.render[side]) continue;
      this.addFace(s, side);
    }
  }

  private addFace(s: BlockSpec, side: number) {
    const n = side >> 1;
    const sg = side & 1 ? -1 : 1;
    const [ta, tb] = TANGENTS[n];
    const r = s.r;
    const segs = s.segs ?? 3;
    const ownRound = s.round[side];
    // Alleen gaten die dit vlak overlappen
    const holes = (s.holes?.[side] ?? []).filter(
      (h) => h.a1 > s.min[ta] + EPS && h.a0 < s.max[ta] - EPS && h.b1 > s.min[tb] + EPS && h.b0 < s.max[tb] - EPS,
    );

    const lo = [0, 1, 2].map((i) => s.min[i] + (ownRound && s.round[i * 2 + 1] ? r : 0));
    const hi = [0, 1, 2].map((i) => s.max[i] - (ownRound && s.round[i * 2] ? r : 0));
    if (ownRound) {
      // eigen normaalas altijd afronden (vlak is zichtbaar)
      if (sg > 0) hi[n] = s.max[n] - r;
      else lo[n] = s.min[n] + r;
    }

    const lines = (axis: number) => {
      const out: number[] = [s.min[axis], s.max[axis]];
      if (ownRound) {
        for (let k = 0; k <= segs; k++) {
          const e = r * Math.tan(((k / segs) * Math.PI) / 4);
          if (s.round[axis * 2 + 1]) out.push(lo[axis] - e);
          if (s.round[axis * 2]) out.push(hi[axis] + e);
        }
      }
      for (const h of holes) {
        if (axis === ta) out.push(h.a0, h.a1);
        else out.push(h.b0, h.b1);
      }
      const mn = s.min[axis];
      const mx = s.max[axis];
      const sorted = out.filter((v) => v >= mn - EPS && v <= mx + EPS).map((v) => Math.min(mx, Math.max(mn, v)));
      sorted.sort((a, b) => a - b);
      const uniq: number[] = [];
      for (const v of sorted) if (!uniq.length || v - uniq[uniq.length - 1] > 1e-5) uniq.push(v);
      return uniq;
    };

    const A = lines(ta);
    const B = lines(tb);

    const bucket = this.get(s.mat[side]);
    const base = bucket.pos.length / 3;
    const p = [0, 0, 0];
    const fn = [0, 0, 0];
    fn[n] = sg;

    for (let j = 0; j < B.length; j++) {
      for (let i = 0; i < A.length; i++) {
        p[n] = sg > 0 ? s.max[n] : s.min[n];
        p[ta] = A[i];
        p[tb] = B[j];
        let vx = p[0];
        let vy = p[1];
        let vz = p[2];
        let nx = fn[0];
        let ny = fn[1];
        let nz = fn[2];
        if (ownRound) {
          const cx = Math.min(hi[0], Math.max(lo[0], p[0]));
          const cy = Math.min(hi[1], Math.max(lo[1], p[1]));
          const cz = Math.min(hi[2], Math.max(lo[2], p[2]));
          const dx = p[0] - cx;
          const dy = p[1] - cy;
          const dz = p[2] - cz;
          const len = Math.hypot(dx, dy, dz);
          if (len > 1e-9) {
            nx = dx / len;
            ny = dy / len;
            nz = dz / len;
            vx = cx + nx * r;
            vy = cy + ny * r;
            vz = cz + nz * r;
          }
        }
        bucket.pos.push(vx, vy, vz);
        bucket.nor.push(nx, ny, nz);
        // wereld-planaire UV's zodat texturen doorlopen
        if (n === 0) bucket.uv.push(p[2] * sg * -1, p[1]);
        else if (n === 1) bucket.uv.push(p[0], p[2]);
        else bucket.uv.push(p[0] * sg, p[1]);
      }
    }

    const W = A.length;
    const paramSign = n === 2 ? 1 : -1;
    const flip = paramSign * sg < 0;
    for (let j = 0; j < B.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const am = (A[i] + A[i + 1]) / 2;
        const bm = (B[j] + B[j + 1]) / 2;
        let inHole = false;
        for (const h of holes) {
          if (am > h.a0 && am < h.a1 && bm > h.b0 && bm < h.b1) {
            inHole = true;
            break;
          }
        }
        if (inHole) continue;
        const v00 = base + j * W + i;
        const v10 = v00 + 1;
        const v01 = v00 + W;
        const v11 = v01 + 1;
        if (!flip) bucket.idx.push(v00, v10, v11, v00, v11, v01);
        else bucket.idx.push(v00, v11, v10, v00, v01, v11);
      }
    }
  }

  /** Losse vlakke vierhoek (p0..p3 tegen de klok in gezien van de voorkant). */
  addQuad(key: string, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
    const b = this.get(key);
    const base = b.pos.length / 3;
    const nrm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
    const ax = Math.abs(nrm.x);
    const ay = Math.abs(nrm.y);
    const az = Math.abs(nrm.z);
    for (const p of [p0, p1, p2, p3]) {
      b.pos.push(p.x, p.y, p.z);
      b.nor.push(nrm.x, nrm.y, nrm.z);
      if (ax >= ay && ax >= az) b.uv.push(p.z, p.y);
      else if (ay >= az) b.uv.push(p.x, p.z);
      else b.uv.push(p.x, p.y);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  toMeshes(material: (key: string) => THREE.Material): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, b] of this.buckets) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.idx);
      const m = new THREE.Mesh(g, material(k));
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = k;
      out.push(m);
    }
    return out;
  }
}

/** Eenvoudig afgerond blok (alle zijden zichtbaar en afgerond). */
export function roundedBox(
  buckets: GeoBuckets,
  key: string,
  min: [number, number, number],
  max: [number, number, number],
  r: number,
  opts: { render?: boolean[]; round?: boolean[]; segs?: number } = {},
) {
  const rr = Math.min(r, (max[0] - min[0]) / 2 - 1e-4, (max[1] - min[1]) / 2 - 1e-4, (max[2] - min[2]) / 2 - 1e-4);
  buckets.addBlock({
    min,
    max,
    render: opts.render ?? [true, true, true, true, true, true],
    round: opts.round ?? [true, true, true, true, true, true],
    mat: [key, key, key, key, key, key],
    r: Math.max(rr, 0.0005),
    segs: opts.segs ?? 2,
  });
}
