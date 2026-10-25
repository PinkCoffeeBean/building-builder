import type { Cell, Design, Dir, FaceDir } from './types';

/** Hoogte van de begane-grondvloer boven de sokkel (ruimte voor plint en traptreden). */
export const FL = 0.16;
/** Afronding van de buitenranden van volumes. */
export const ROUND = 0.035;

export const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Normaal per richting. */
export const DIR_VEC: Record<FaceDir, [number, number, number]> = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
  py: [0, 1, 0],
  ny: [0, -1, 0],
};

/** "Rechts" zoals gezien door iemand die van buitenaf naar het gevelvlak kijkt. */
export const DIR_RIGHT: Record<Dir, [number, number, number]> = {
  px: [0, 0, -1],
  nx: [0, 0, 1],
  pz: [1, 0, 0],
  nz: [-1, 0, 0],
};

/** Rotatie (rond y) waarmee lokale +z naar de gevelnormaal wijst. */
export const DIR_ANGLE: Record<Dir, number> = {
  pz: 0,
  px: Math.PI / 2,
  nz: Math.PI,
  nx: -Math.PI / 2,
};

/** Onderkant van een cel in wereldhoogte. De begane grond loopt door tot op de sokkel. */
export const cellBottom = (y: number) => (y === 0 ? 0 : FL + y);
export const cellTop = (y: number) => FL + y + 1;
/** Vloerpeil van een verdieping (waar deuren beginnen). */
export const floorLevel = (y: number) => FL + y;

export function cellCenterX(x: number, w: number) {
  return x - w / 2 + 0.5;
}
export function cellCenterZ(z: number, d: number) {
  return z - d / 2 + 0.5;
}

/** Snelle opzoektabel voor cellen. */
export class CellMap {
  map = new Map<string, Cell>();
  constructor(public design: Design) {
    for (const c of design.cells) this.map.set(key(c.x, c.y, c.z), c);
  }
  get(x: number, y: number, z: number) {
    return this.map.get(key(x, y, z));
  }
  has(x: number, y: number, z: number) {
    return this.map.has(key(x, y, z));
  }
  neighbor(c: { x: number; y: number; z: number }, d: FaceDir) {
    const v = DIR_VEC[d];
    return this.get(c.x + v[0], c.y + v[1], c.z + v[2]);
  }
  /** Gevelvlak is zichtbaar (geen buurblok ervoor). */
  exposed(x: number, y: number, z: number, d: FaceDir) {
    if (!this.has(x, y, z)) return false;
    const v = DIR_VEC[d];
    return !this.has(x + v[0], y + v[1], z + v[2]);
  }
  isTop(c: { x: number; y: number; z: number }) {
    return !this.has(c.x, c.y + 1, c.z);
  }
}

/** Wereldpositie van de linkeronderhoek (op vloerpeil) van een gevelvlak van cel (x,y,z). */
export function faceOrigin(design: Design, x: number, y: number, z: number, d: Dir): [number, number, number] {
  const cx = cellCenterX(x, design.plot.w);
  const cz = cellCenterZ(z, design.plot.d);
  const n = DIR_VEC[d];
  const r = DIR_RIGHT[d];
  return [cx + n[0] * 0.5 - r[0] * 0.5, floorLevel(y), cz + n[2] * 0.5 - r[2] * 0.5];
}

/** Cel die `steps` stappen naar rechts ligt op hetzelfde gevelvlak. */
export function stepRight(x: number, z: number, d: Dir, steps: number) {
  const r = DIR_RIGHT[d];
  return { x: x + r[0] * steps, z: z + r[2] * steps };
}

let idCounter = 0;
export function uid(prefix = 'i') {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
