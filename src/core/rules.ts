import { def, facadeLayer, isFacadeDef, type EnvDef, type FacadeDef } from '../catalog/catalog';
import { footprintRect } from '../render/builders/facade';
import { localRectToHole, safeDef, BASE_MARGIN } from '../render/buildDesign';
import { CellMap, DIR_RIGHT, cellCenterX, cellCenterZ } from './grid';
import type { Design, EnvItem, FacadeItem, RoofItem } from './types';

/** Laag waarin een gevelelement ruimte inneemt: overlap binnen dezelfde laag is verboden. */
export function layerOf(d: FacadeDef): 'wall' | 'outside' | 'ground' {
  if (d.kind === 'stairs') return 'ground';
  return facadeLayer(d);
}

/** Alle cellen die een gevelelement bedekt. */
export function coveredCells(d: FacadeDef, it: Pick<FacadeItem, 'x' | 'y' | 'z' | 'dir'>) {
  const out: { x: number; y: number; z: number }[] = [];
  const r = DIR_RIGHT[it.dir];
  for (let i = 0; i < d.span[0]; i++)
    for (let j = 0; j < d.span[1]; j++) out.push({ x: it.x + r[0] * i, y: it.y + j, z: it.z + r[2] * i });
  return out;
}

/** Reden waarom een gevelelement hier niet kan, of null als het kan. */
export function checkFacade(design: Design, cm: CellMap, d: FacadeDef, it: FacadeItem, ignoreId?: string): string | null {
  for (const c of coveredCells(d, it)) {
    if (!cm.has(c.x, c.y, c.z)) return d.span[0] > 1 || d.span[1] > 1 ? `Past niet: dit element is ${d.span[0]}×${d.span[1]} cellen` : 'Geen gevel';
    if (!cm.exposed(c.x, c.y, c.z, it.dir)) return 'Gevel is bedekt';
  }
  if ((d.groundOnly || d.kind === 'stairs') && it.y !== 0) return 'Alleen op de begane grond';
  if (d.notGround && it.y === 0) return 'Niet op de begane grond';
  const layer = layerOf(d);
  const mine = localRectToHole(design, it, footprintRect(d, it));
  for (const o of design.facade) {
    if (o.id === ignoreId || o.dir !== it.dir) continue;
    const od = safeDef(o.type);
    if (!od || !isFacadeDef(od) || layerOf(od) !== layer) continue;
    // zelfde vlak?
    const samePlane = it.dir === 'px' || it.dir === 'nx' ? o.x === it.x : o.z === it.z;
    if (!samePlane) continue;
    const h = localRectToHole(design, o, footprintRect(od, o));
    const eps = 0.005;
    if (h.a0 < mine.a1 - eps && h.a1 > mine.a0 + eps && h.b0 < mine.b1 - eps && h.b1 > mine.b0 + eps) return 'Overlapt met ander element';
  }
  return null;
}

export function checkCell(design: Design, cm: CellMap, x: number, y: number, z: number): string | null {
  if (x < 0 || z < 0 || x >= design.plot.w || z >= design.plot.d) return 'Buiten de kavel';
  if (y < 0) return 'Onder de grond';
  if (y >= design.plot.floors) return `Maximaal ${design.plot.floors} lagen`;
  if (cm.has(x, y, z)) return 'Al bezet';
  if (y === 0) {
    const cx = cellCenterX(x, design.plot.w);
    const cz = cellCenterZ(z, design.plot.d);
    for (const e of design.env) {
      const d = safeDef(e.type) as EnvDef | undefined;
      const r = d?.radius ?? 0.1;
      if (Math.abs(e.x - cx) < 0.5 + r * 0.6 && Math.abs(e.z - cz) < 0.5 + r * 0.6) return 'Er staat iets in de weg';
    }
  }
  return null;
}

export function checkEnv(design: Design, cm: CellMap, d: EnvDef, x: number, z: number, ignoreId?: string): string | null {
  const hw = design.plot.w / 2 + BASE_MARGIN - d.radius * 0.5;
  const hd = design.plot.d / 2 + BASE_MARGIN - d.radius * 0.5;
  if (Math.abs(x) > hw || Math.abs(z) > hd) return 'Buiten de sokkel';
  for (const c of design.cells) {
    if (c.y !== 0) continue;
    const cx = cellCenterX(c.x, design.plot.w);
    const cz = cellCenterZ(c.z, design.plot.d);
    if (Math.abs(x - cx) < 0.5 + d.radius * 0.6 && Math.abs(z - cz) < 0.5 + d.radius * 0.6) return 'Staat in het gebouw';
  }
  for (const o of design.env) {
    if (o.id === ignoreId) continue;
    const od = safeDef(o.type) as EnvDef | undefined;
    const rr = (od?.radius ?? 0.1) + d.radius;
    if (Math.hypot(o.x - x, o.z - z) < rr * 0.75) return 'Te dicht op ander element';
  }
  void cm;
  return null;
}

export function checkRoofItem(cm: CellMap, it: Pick<RoofItem, 'x' | 'y' | 'z'>, design: Design, ignoreId?: string): string | null {
  const c = cm.get(it.x, it.y, it.z);
  if (!c || !cm.isTop(c)) return 'Alleen op een dak';
  if (design.roofItems.some((o) => o.id !== ignoreId && o.x === it.x && o.y === it.y && o.z === it.z)) return 'Hier staat al een schoorsteen';
  return null;
}

/** Verwijdert elementen die na een wijziging niet meer kunnen (bv. gevel bedekt door nieuw blok). */
export function sanitize(design: Design) {
  const cm = new CellMap(design);
  design.facade = design.facade.filter((it) => {
    const d = safeDef(it.type);
    if (!d || !isFacadeDef(d)) return false;
    return coveredCells(d, it).every((c) => cm.exposed(c.x, c.y, c.z, it.dir));
  });
  design.roofItems = design.roofItems.filter((it) => {
    const c = cm.get(it.x, it.y, it.z);
    return !!c && cm.isTop(c);
  });
  design.env = design.env.filter((e) => {
    const d = safeDef(e.type);
    return !!d && d.kind === 'env';
  });
  // dakinstellingen alleen op bovenste cellen bewaren
  for (const c of design.cells) if (c.roof && !cm.isTop(c)) delete c.roof;
}

export function itemDef(id: string) {
  return def(id);
}

export type { EnvItem };
