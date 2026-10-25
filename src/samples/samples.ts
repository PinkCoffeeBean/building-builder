import { emptyDesign } from '../core/store';
import type { Cell, CladdingId, Design, Dir, EnvItem, FacadeItem, RoofStyle } from '../core/types';

/** Bouwhulpjes om voorbeeldontwerpen compact te beschrijven. */
function box(
  cells: Cell[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  cladding: CladdingId = 'stucco',
  roof?: RoofStyle,
) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) cells.push({ x, y, z, color, cladding, ...(roof && y === y1 ? { roof: { ...roof } } : {}) });
}

let n = 0;
function f(type: string, x: number, y: number, z: number, dir: Dir, color: string, accent: string, align = 0, text?: string): FacadeItem {
  return { id: `s${++n}`, type, x, y, z, dir, align, color, accent, ...(text ? { text } : {}) };
}
function e(type: string, x: number, z: number, color: string, accent: string, rot = 0): EnvItem {
  return { id: `s${++n}`, type, x, z, rot, color, accent };
}

/* ------------------------------------------------------------------ 1. wit-blauw huisje */
function whiteBlue(): Design {
  const d = emptyDesign('Wit-blauw huisje');
  const blue = '#3b78d0';
  const white = '#f7f5f0';
  box(d.cells, 3, 4, 0, 1, 3, 4, white, 'stucco', { type: 'roof-parapet-thick', color: blue, accent: '#4b86d8' });
  const W = '#ffffff';
  d.facade.push(
    // voorgevel (pz)
    f('win-cross', 3, 0, 4, 'pz', blue, W),
    f('door-arch', 4, 0, 4, 'pz', blue, blue),
    f('stairs-front', 4, 0, 4, 'pz', '#ffffff', '#ffffff'),
    f('win-cross', 3, 1, 4, 'pz', blue, W),
    f('win-cross', 4, 1, 4, 'pz', blue, W),
    // zijgevel (px)
    f('win-cross', 4, 0, 4, 'px', blue, W),
    f('win-cross', 4, 0, 3, 'px', blue, W),
    f('win-cross', 4, 1, 4, 'px', blue, W),
    f('win-cross', 4, 1, 3, 'px', blue, W),
  );
  d.env.push(e('tree-lollipop', 1.55, -0.55, '#6db34a', '#7a5536'), e('pot', -1.7, 1.25, '#f0b93a', '#c4673f'));
  d.settings = { background: '#e8edf2', base: '#a7abb0', plinth: blue, bands: '#ffffff' };
  return d;
}

/* ------------------------------------------------------------------ 2. petrol/oranje huis */
function tealOrange(): Design {
  const d = emptyDesign('Petrol & oranje huis');
  const teal = '#4f8f99';
  const orange = '#f2a65a';
  const dark = '#2a2e35';
  box(d.cells, 3, 4, 0, 1, 3, 4, teal, 'stucco', { type: 'roof-parapet', color: '#3a3d42', accent: '#8f9799' });
  // loggia-cel met houten bekleding aan de voorkant
  const c = d.cells.find((q) => q.x === 3 && q.y === 1 && q.z === 4)!;
  c.faces = { pz: { cladding: 'wood', color: orange } };
  d.facade.push(
    f('door-garage', 3, 0, 4, 'pz', orange, '#3a3d42'),
    f('door-slats', 4, 0, 4, 'pz', orange, dark),
    f('canopy-lamp', 4, 0, 4, 'pz', teal, '#fff3c4'),
    f('stairs-front', 4, 0, 4, 'pz', orange, orange),
    f('door-double', 3, 1, 4, 'pz', dark, dark),
    f('balc-rail', 3, 1, 4, 'pz', orange, dark),
    f('win-tall', 4, 1, 4, 'pz', dark, '#e9e2d6', -1),
    f('win-tall', 4, 0, 4, 'px', dark, '#e9e2d6', -1),
    f('win-tall', 4, 0, 3, 'px', dark, '#e9e2d6', 1),
    f('win-tall', 4, 1, 4, 'px', dark, '#e9e2d6', -1),
    f('win-tall', 4, 1, 3, 'px', dark, '#e9e2d6', 1),
  );
  d.env.push(
    e('planter', 1.45, 1.35, '#6fae4f', '#3a3d42'),
    e('bush', 1.6, -1.2, '#5f9a48', '#f2a65a'),
    e('lamp', -1.75, 1.55, '#25282d', '#fff1c2'),
  );
  d.settings = { background: '#ece6e3', base: '#f4f1ec', plinth: null, bands: null };
  return d;
}

/* ------------------------------------------------------------------ 3. Bauhaus */
function bauhaus(): Design {
  const d = emptyDesign('Bauhaus wit-geel-roze');
  const white = '#f3f0e8';
  const yellow = '#f5c22b';
  const pink = '#e5707a';
  const red = '#c9474f';
  const dark = '#24282e';
  const roof: RoofStyle = { type: 'roof-parapet', color: '#2d3036', accent: '#8f8f8b' };
  box(d.cells, 1, 3, 0, 2, 2, 4, white, 'stucco', roof);
  box(d.cells, 4, 5, 0, 4, 2, 4, yellow, 'stucco', roof);
  box(d.cells, 6, 7, 0, 1, 2, 4, yellow, 'stucco', { type: 'roof-terrace', color: '#2d3036', accent: '#d8d4cc' });
  // grijs-blauw accentvlak boven de entree
  d.cells.find((q) => q.x === 3 && q.y === 1 && q.z === 4)!.faces = { pz: { color: '#7d8d9c' } };
  d.facade.push(
    // witte volume
    f('win-slit', 1, 0, 4, 'pz', dark, '#d9d6cf', -1),
    f('win-slit', 1, 0, 4, 'pz', dark, '#d9d6cf', 1),
    f('win-cross', 2, 0, 4, 'pz', dark, '#d9d6cf'),
    f('door-double', 3, 0, 4, 'pz', dark, dark),
    f('canopy-portal', 3, 0, 4, 'pz', pink, '#fff3c4'),
    f('stairs-wide', 3, 0, 4, 'pz', '#3a3d42', '#3a3d42'),
    f('win-curtain', 3, 1, 4, 'pz', '#1f2226', '#d9d6cf'),
    f('win-tall', 1, 1, 4, 'pz', dark, '#d9d6cf'),
    f('door-panel', 2, 2, 4, 'pz', dark, dark),
    f('balc-rail', 2, 2, 4, 'pz', red, dark),
    f('win-cross', 3, 2, 4, 'pz', dark, '#d9d6cf'),
    f('win-tall', 1, 2, 4, 'pz', dark, '#d9d6cf'),
    // toren
    f('win-stair', 4, 1, 4, 'pz', '#8a6a3a', '#d9d6cf', -1),
    f('win-small', 4, 4, 4, 'pz', dark, '#d9d6cf', -1),
    f('win-slit', 5, 3, 4, 'pz', dark, '#d9d6cf'),
    // lage vleugel
    f('win-ribbon', 6, 0, 4, 'pz', '#8a6a3a', '#d9d6cf'),
    f('win-pano', 6, 1, 4, 'pz', dark, '#d9d6cf'),
    // zijgevel toren / vleugel
    f('win-tall', 7, 0, 4, 'px', dark, '#d9d6cf'),
    f('win-tall', 7, 0, 3, 'px', dark, '#d9d6cf'),
    f('win-tall', 7, 1, 4, 'px', dark, '#d9d6cf'),
    f('win-tall', 7, 1, 2, 'px', dark, '#d9d6cf'),
    f('win-slit', 5, 2, 4, 'px', dark, '#d9d6cf'),
    f('win-slit', 5, 3, 3, 'px', dark, '#d9d6cf'),
    f('win-cross', 5, 4, 3, 'px', dark, '#d9d6cf'),
  );
  d.env.push(e('tree-cypress', -3.0, 1.75, '#5f8f52', '#7a5536'), e('pot', 1.0, 1.65, '#e5707a', '#c4673f'));
  d.settings = { background: '#4b5d6e', base: '#d7d3cc', plinth: '#26292e', bands: null };
  return d;
}

export interface Sample {
  id: string;
  design: Design;
}

export function samples(): Sample[] {
  return [
    { id: 'sample-white-blue', design: whiteBlue() },
    { id: 'sample-teal-orange', design: tealOrange() },
    { id: 'sample-bauhaus', design: bauhaus() },
  ];
}
