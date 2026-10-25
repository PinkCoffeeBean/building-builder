/**
 * CATALOGUS
 * ---------
 * Alle bouwelementen zijn hier als data gedefinieerd. Een nieuw raam, deur, balkon of
 * kleurpalet toevoegen = een object aan een lijst toevoegen. Maten zijn in "cel-eenheden":
 * 1 eenheid = 1 cel ≈ 3 meter. Een deur van 2,2 m is dus ±0,73 hoog.
 *
 * Lokale coördinaten van gevelelementen:
 *   x = 0 … span[0]  (van links naar rechts gezien van buitenaf)
 *   y = 0            vloerpeil van de verdieping waarop het element staat
 *   z = 0            gevelvlak, +z naar buiten
 */
import type { CladdingId } from '../core/types';

export type CategoryId = 'volumes' | 'windows' | 'doors' | 'balconies' | 'roof' | 'env' | 'paint';

export interface CategoryDef {
  id: CategoryId;
  name: string;
  icon: string; // emoji/glyph voor in de gereedschapsbalk
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'volumes', name: 'Volumes', icon: '▣' },
  { id: 'windows', name: 'Ramen', icon: '⊞' },
  { id: 'doors', name: 'Deuren', icon: '⌂' },
  { id: 'balconies', name: 'Balkons', icon: '☰' },
  { id: 'roof', name: 'Dak', icon: '⏢' },
  { id: 'env', name: 'Omgeving', icon: '❀' },
  { id: 'paint', name: 'Verf', icon: '◐' },
];

interface BaseDef {
  id: string;
  name: string;
  category: CategoryId;
  color: string; // hoofdkleur
  accent: string; // accentkleur (kozijn, hek, stam…)
  /** Labels voor de kleurkiezers in het paneel. */
  colorLabels?: [string, string?];
}

/* ------------------------------------------------------------------ volumes */

export interface VolumeDef extends BaseDef {
  kind: 'volume';
  cladding: CladdingId;
}

/* ------------------------------------------------------------------ gevel */

interface FacadeBase extends BaseDef {
  /** Aantal cellen [breed, hoog] dat het element beslaat. */
  span: [number, number];
  /** Alleen op de begane grond. */
  groundOnly?: boolean;
  /** Mag niet op de begane grond. */
  notGround?: boolean;
}

export interface WindowDef extends FacadeBase {
  kind: 'window';
  width: number;
  height: number;
  sill: number; // borstwering: onderkant raam boven vloerpeil
  cols: number; // verticale roeden + 1
  rows: number; // horizontale roeden + 1
  frame: number; // kozijnbreedte
  depth: number; // diepte van de dagkant (hoe diep het raam in de gevel ligt)
  sillPlate: boolean; // vensterbank
  arch?: boolean;
  curtains?: boolean;
}

export type DoorStyle = 'panel' | 'arch' | 'double' | 'garage' | 'slats' | 'glass';

export interface DoorDef extends FacadeBase {
  kind: 'door';
  style: DoorStyle;
  width: number;
  height: number;
  bottom: number; // onderkant t.o.v. vloerpeil (garage: tot op de sokkel)
  depth: number;
  transom?: boolean; // bovenlicht
  sideLight?: boolean; // zijlicht
}

export type BalconyStyle = 'cantilever' | 'loggia' | 'french';
export type RailStyle = 'bars' | 'solid' | 'glass';

export interface BalconyDef extends FacadeBase {
  kind: 'balcony';
  style: BalconyStyle;
  width: number;
  depth: number;
  rail: RailStyle;
  railHeight: number;
  slab: number; // plaatdikte
  withDoor?: boolean;
}

export type CanopyStyle = 'slab' | 'portal' | 'awning';

export interface CanopyDef extends FacadeBase {
  kind: 'canopy';
  style: CanopyStyle;
  width: number;
  depth: number;
  height: number; // onderkant boven vloerpeil
  thickness: number;
  lamp: boolean;
}

export interface SignDef extends FacadeBase {
  kind: 'sign';
  style: 'blade' | 'board';
  defaultText: string;
}

export interface StairDef extends FacadeBase {
  kind: 'stairs';
  style: 'front' | 'side' | 'wide';
  width: number;
  steps: number;
}

export type FacadeDef = WindowDef | DoorDef | BalconyDef | CanopyDef | SignDef | StairDef;

/* ------------------------------------------------------------------ dak */

export type RoofStyleId = 'parapet' | 'overhang' | 'shed' | 'terrace' | 'none';

export interface RoofDef extends BaseDef {
  kind: 'roof';
  style: RoofStyleId;
  /** Dakrand / overstek-parameters. */
  edge: number; // breedte dakrand of overstek
  height: number; // hoogte opstand / dikte dakplaat
  fascia?: CladdingId; // materiaal van de zijkant van een overstek
  rise?: number; // hoogteverschil lessenaarsdak
}

export interface ChimneyDef extends BaseDef {
  kind: 'chimney';
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ omgeving */

export type EnvStyle = 'lollipop' | 'cypress' | 'palm' | 'bush' | 'planter' | 'pot' | 'lamp' | 'bed' | 'bench';

export interface EnvDef extends BaseDef {
  kind: 'env';
  style: EnvStyle;
  radius: number; // footprint voor botsingscontrole
  scale: number;
}

/* ------------------------------------------------------------------ verf */

export type PaintMode = 'volume' | 'cell' | 'face' | 'pick';

export interface PaintDef extends BaseDef {
  kind: 'paint';
  mode: PaintMode;
}

export type AnyDef = VolumeDef | FacadeDef | RoofDef | ChimneyDef | EnvDef | PaintDef;

/* ================================================================== DATA */

const WHITE = '#f3f0ea';
const FRAME_DARK = '#2a2e35';
const SILL = '#d9d6cf';

export const CATALOG: AnyDef[] = [
  // ---------------------------------------------------------------- Volumes
  { kind: 'volume', id: 'block-stucco', name: 'Blok stuc', category: 'volumes', cladding: 'stucco', color: WHITE, accent: WHITE },
  { kind: 'volume', id: 'block-wood', name: 'Blok hout', category: 'volumes', cladding: 'wood', color: '#c98d55', accent: '#c98d55' },
  { kind: 'volume', id: 'block-stone', name: 'Blok natuursteen', category: 'volumes', cladding: 'stone', color: '#cdbfa8', accent: '#cdbfa8' },
  { kind: 'volume', id: 'block-concrete', name: 'Blok beton', category: 'volumes', cladding: 'concrete', color: '#b9b7b1', accent: '#b9b7b1' },
  { kind: 'volume', id: 'block-brick', name: 'Blok baksteen', category: 'volumes', cladding: 'brick', color: '#b5654a', accent: '#b5654a' },

  // ---------------------------------------------------------------- Ramen
  {
    kind: 'window', id: 'win-cross', name: 'Vierkant met kruisroede', category: 'windows', span: [1, 1],
    width: 0.4, height: 0.4, sill: 0.32, cols: 2, rows: 2, frame: 0.028, depth: 0.06, sillPlate: true,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-tall', name: 'Staand raam', category: 'windows', span: [1, 1],
    width: 0.3, height: 0.58, sill: 0.2, cols: 1, rows: 2, frame: 0.026, depth: 0.06, sillPlate: true,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-slit', name: 'Smal spleetraam', category: 'windows', span: [1, 1],
    width: 0.11, height: 0.5, sill: 0.25, cols: 1, rows: 1, frame: 0.02, depth: 0.06, sillPlate: false,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-pano', name: 'Breed panoramaraam', category: 'windows', span: [1, 1],
    width: 0.78, height: 0.5, sill: 0.24, cols: 2, rows: 1, frame: 0.028, depth: 0.07, sillPlate: true,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-ribbon', name: 'Lintraam (2 cellen)', category: 'windows', span: [2, 1],
    width: 1.72, height: 0.28, sill: 0.4, cols: 6, rows: 1, frame: 0.022, depth: 0.06, sillPlate: true,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-ribbon3', name: 'Lintraam (3 cellen)', category: 'windows', span: [3, 1],
    width: 2.7, height: 0.3, sill: 0.38, cols: 9, rows: 1, frame: 0.022, depth: 0.06, sillPlate: true,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-stair', name: 'Trappenhuisraam (3 lagen)', category: 'windows', span: [1, 3],
    width: 0.2, height: 2.6, sill: 0.25, cols: 2, rows: 9, frame: 0.02, depth: 0.06, sillPlate: false, curtains: true,
    color: '#8a6a3a', accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-stair2', name: 'Trappenhuisraam (2 lagen)', category: 'windows', span: [1, 2],
    width: 0.2, height: 1.6, sill: 0.3, cols: 2, rows: 6, frame: 0.02, depth: 0.06, sillPlate: false, curtains: true,
    color: '#8a6a3a', accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-small', name: 'Klein dakraampje', category: 'windows', span: [1, 1],
    width: 0.14, height: 0.14, sill: 0.62, cols: 1, rows: 1, frame: 0.018, depth: 0.05, sillPlate: false,
    color: FRAME_DARK, accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-arch', name: 'Boograam', category: 'windows', span: [1, 1],
    width: 0.32, height: 0.55, sill: 0.22, cols: 2, rows: 3, frame: 0.024, depth: 0.06, sillPlate: true, arch: true,
    color: '#2f6fd6', accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },
  {
    kind: 'window', id: 'win-curtain', name: 'Raam met vitrage', category: 'windows', span: [1, 1],
    width: 0.36, height: 0.4, sill: 0.3, cols: 2, rows: 1, frame: 0.022, depth: 0.06, sillPlate: true, curtains: true,
    color: '#1f2226', accent: SILL, colorLabels: ['Kozijn', 'Vensterbank'],
  },

  // ---------------------------------------------------------------- Deuren
  {
    kind: 'door', id: 'door-panel', name: 'Rechthoekige deur', category: 'doors', span: [1, 1], style: 'panel',
    width: 0.32, height: 0.72, bottom: 0, depth: 0.07, color: '#2a2e35', accent: '#2a2e35', colorLabels: ['Deur', 'Kozijn'],
  },
  {
    kind: 'door', id: 'door-arch', name: 'Boogdeur', category: 'doors', span: [1, 1], style: 'arch',
    width: 0.34, height: 0.74, bottom: 0, depth: 0.07, color: '#2f6fd6', accent: '#2f6fd6', colorLabels: ['Deur', 'Kozijn'],
  },
  {
    kind: 'door', id: 'door-double', name: 'Dubbele deur', category: 'doors', span: [1, 1], style: 'double',
    width: 0.5, height: 0.76, bottom: 0, depth: 0.07, transom: true, color: '#22262c', accent: '#22262c', colorLabels: ['Deur', 'Kozijn'],
  },
  {
    kind: 'door', id: 'door-garage', name: 'Garagedeur', category: 'doors', span: [1, 1], style: 'garage', groundOnly: true,
    width: 0.78, height: 0.72, bottom: -0.16, depth: 0.06, color: '#f0a85a', accent: '#3a3d42', colorLabels: ['Deur', 'Kozijn'],
  },
  {
    kind: 'door', id: 'door-slats', name: 'Houten latjesdeur', category: 'doors', span: [1, 1], style: 'slats',
    width: 0.32, height: 0.74, bottom: 0, depth: 0.07, color: '#c98d55', accent: '#2a2e35', colorLabels: ['Deur', 'Kozijn'],
  },
  {
    kind: 'door', id: 'door-glass', name: 'Glazen pui', category: 'doors', span: [1, 1], style: 'glass', sideLight: true,
    width: 0.62, height: 0.78, bottom: 0, depth: 0.07, color: '#2a2e35', accent: '#2a2e35', colorLabels: ['Kozijn', 'Deur'],
  },
  {
    kind: 'canopy', id: 'canopy-slab', name: 'Luifel', category: 'doors', span: [1, 1], style: 'slab',
    width: 0.56, depth: 0.26, height: 0.84, thickness: 0.045, lamp: false, color: '#f3f0ea', accent: '#fff3c4', colorLabels: ['Luifel', 'Lamp'],
  },
  {
    kind: 'canopy', id: 'canopy-lamp', name: 'Luifel met lamp', category: 'doors', span: [1, 1], style: 'slab',
    width: 0.56, depth: 0.28, height: 0.84, thickness: 0.05, lamp: true, color: '#3f8a96', accent: '#fff3c4', colorLabels: ['Luifel', 'Lamp'],
  },
  {
    kind: 'canopy', id: 'canopy-portal', name: 'Portiek', category: 'doors', span: [1, 1], style: 'portal', groundOnly: true,
    width: 0.62, depth: 0.32, height: 0.86, thickness: 0.07, lamp: false, color: '#e5707a', accent: '#fff3c4', colorLabels: ['Portiek', 'Lamp'],
  },
  {
    kind: 'canopy', id: 'canopy-awning', name: 'Gestreepte markies', category: 'doors', span: [1, 1], style: 'awning',
    width: 0.86, depth: 0.3, height: 0.8, thickness: 0.02, lamp: false, color: '#c9744a', accent: '#f6efe2', colorLabels: ['Streep', 'Streep 2'],
  },

  // ---------------------------------------------------------------- Balkons
  {
    kind: 'balcony', id: 'balc-rail', name: 'Uitkragend met hek', category: 'balconies', span: [1, 1], style: 'cantilever', notGround: true,
    width: 0.8, depth: 0.3, rail: 'bars', railHeight: 0.32, slab: 0.06, color: '#c9474f', accent: '#24282e', colorLabels: ['Plaat', 'Hek'],
  },
  {
    kind: 'balcony', id: 'balc-rail2', name: 'Breed balkon (2 cellen)', category: 'balconies', span: [2, 1], style: 'cantilever', notGround: true,
    width: 1.8, depth: 0.3, rail: 'bars', railHeight: 0.32, slab: 0.06, color: '#f3f0ea', accent: '#24282e', colorLabels: ['Plaat', 'Hek'],
  },
  {
    kind: 'balcony', id: 'balc-solid', name: 'Met borstwering', category: 'balconies', span: [1, 1], style: 'cantilever',
    width: 0.66, depth: 0.28, rail: 'solid', railHeight: 0.3, slab: 0.05, color: '#b9b7b1', accent: '#b9b7b1', colorLabels: ['Plaat', 'Borstwering'],
  },
  {
    kind: 'balcony', id: 'balc-glass', name: 'Met glazen balustrade', category: 'balconies', span: [1, 1], style: 'cantilever', notGround: true,
    width: 0.8, depth: 0.3, rail: 'glass', railHeight: 0.32, slab: 0.05, color: '#f3f0ea', accent: '#2a2e35', colorLabels: ['Plaat', 'Profiel'],
  },
  {
    kind: 'balcony', id: 'balc-loggia', name: 'Inpandige loggia', category: 'balconies', span: [1, 1], style: 'loggia', withDoor: true,
    width: 0.74, depth: 0.32, rail: 'bars', railHeight: 0.32, slab: 0, color: '#e9e2d6', accent: '#24282e', colorLabels: ['Binnenwand', 'Hek'],
  },
  {
    kind: 'balcony', id: 'balc-french', name: 'Frans balkon', category: 'balconies', span: [1, 1], style: 'french', notGround: true,
    width: 0.4, depth: 0.04, rail: 'bars', railHeight: 0.3, slab: 0, color: '#2a2e35', accent: '#24282e', colorLabels: ['Kozijn', 'Hek'],
  },

  // ---------------------------------------------------------------- Dak
  { kind: 'roof', id: 'roof-parapet', name: 'Plat met dakrand', category: 'roof', style: 'parapet', edge: 0.06, height: 0.06, color: '#2d3036', accent: '#9a9a96', colorLabels: ['Dakrand', 'Dakbedekking'] },
  { kind: 'roof', id: 'roof-parapet-thick', name: 'Brede opstand', category: 'roof', style: 'parapet', edge: 0.1, height: 0.12, color: '#3b78d0', accent: '#4f88da', colorLabels: ['Dakrand', 'Dakbedekking'] },
  { kind: 'roof', id: 'roof-overhang', name: 'Plat met overstek', category: 'roof', style: 'overhang', edge: 0.14, height: 0.07, fascia: 'stucco', color: '#f3f0ea', accent: '#f3f0ea', colorLabels: ['Dak', 'Boeiboord'] },
  { kind: 'roof', id: 'roof-overhang-wood', name: 'Overstek met hout', category: 'roof', style: 'overhang', edge: 0.16, height: 0.08, fascia: 'wood', color: '#3a3b3f', accent: '#c98d55', colorLabels: ['Dak', 'Boeiboord'] },
  { kind: 'roof', id: 'roof-shed', name: 'Lessenaarsdak golfplaat', category: 'roof', style: 'shed', edge: 0.16, height: 0.03, rise: 0.32, color: '#6d6f73', accent: '#7a4a2c', colorLabels: ['Golfplaat', 'Balken'] },
  { kind: 'roof', id: 'roof-terrace', name: 'Dakterras met hek', category: 'roof', style: 'terrace', edge: 0.05, height: 0.05, color: '#2d3036', accent: '#d8d4cc', colorLabels: ['Dakrand & hek', 'Tegels'] },
  { kind: 'roof', id: 'roof-none', name: 'Plat zonder rand', category: 'roof', style: 'none', edge: 0, height: 0, color: '#9a9a96', accent: '#9a9a96', colorLabels: ['Dak', '—'] },
  { kind: 'chimney', id: 'chimney', name: 'Schoorsteen', category: 'roof', width: 0.12, height: 0.36, color: '#3a3d42', accent: '#3a3d42' },
  { kind: 'chimney', id: 'chimney-brick', name: 'Bakstenen schoorsteen', category: 'roof', width: 0.16, height: 0.42, color: '#b5654a', accent: '#3a3d42' },

  // ---------------------------------------------------------------- Omgeving
  {
    kind: 'stairs', id: 'stairs-front', name: 'Trap naar voordeur', category: 'env', span: [1, 1], style: 'front', groundOnly: true,
    width: 0.44, steps: 3, color: '#d9d6cf', accent: '#d9d6cf', colorLabels: ['Treden'],
  },
  {
    kind: 'stairs', id: 'stairs-wide', name: 'Brede bordestrap', category: 'env', span: [1, 1], style: 'wide', groundOnly: true,
    width: 0.8, steps: 3, color: '#4a4d52', accent: '#4a4d52', colorLabels: ['Treden'],
  },
  {
    kind: 'stairs', id: 'stairs-side', name: 'Zijtrap langs gevel', category: 'env', span: [1, 1], style: 'side', groundOnly: true,
    width: 0.2, steps: 4, color: '#2d3036', accent: '#2d3036', colorLabels: ['Treden'],
  },
  {
    kind: 'sign', id: 'sign-blade', name: 'Gevelbord staand', category: 'env', span: [1, 2], style: 'blade', notGround: false,
    defaultText: 'HOTEL', color: '#4f7f8c', accent: '#f6f2ea', colorLabels: ['Bord', 'Letters'],
  },
  {
    kind: 'sign', id: 'sign-board', name: 'Gevelbord liggend', category: 'env', span: [1, 1], style: 'board',
    defaultText: 'BAKKERIJ', color: '#efe4d0', accent: '#f6efe2', colorLabels: ['Bord', 'Letters'],
  },
  { kind: 'env', id: 'tree-lollipop', name: 'Bolboom', category: 'env', style: 'lollipop', radius: 0.22, scale: 1, color: '#6fae4f', accent: '#7a5536', colorLabels: ['Kroon', 'Stam'] },
  { kind: 'env', id: 'tree-cypress', name: 'Cypres', category: 'env', style: 'cypress', radius: 0.14, scale: 1, color: '#5f8f52', accent: '#7a5536', colorLabels: ['Kroon', 'Stam'] },
  { kind: 'env', id: 'tree-palm', name: 'Palmboom', category: 'env', style: 'palm', radius: 0.2, scale: 1, color: '#5c9a3e', accent: '#a07850', colorLabels: ['Bladeren', 'Stam'] },
  { kind: 'env', id: 'bush', name: 'Struik', category: 'env', style: 'bush', radius: 0.16, scale: 1, color: '#5f9a48', accent: '#d873a6', colorLabels: ['Blad', 'Bloei'] },
  { kind: 'env', id: 'bed', name: 'Plantvak', category: 'env', style: 'bed', radius: 0.4, scale: 1, color: '#5f9a48', accent: '#6b5040', colorLabels: ['Planten', 'Aarde'] },
  { kind: 'env', id: 'planter', name: 'Plantenbak', category: 'env', style: 'planter', radius: 0.2, scale: 1, color: '#6fae4f', accent: '#3a3d42', colorLabels: ['Planten', 'Bak'] },
  { kind: 'env', id: 'pot', name: 'Bloempot', category: 'env', style: 'pot', radius: 0.08, scale: 1, color: '#f0b93a', accent: '#c4673f', colorLabels: ['Bloemen', 'Pot'] },
  { kind: 'env', id: 'lamp', name: 'Lantaarnpaal', category: 'env', style: 'lamp', radius: 0.06, scale: 1, color: '#25282d', accent: '#fff1c2', colorLabels: ['Paal', 'Licht'] },
  { kind: 'env', id: 'bench', name: 'Bankje', category: 'env', style: 'bench', radius: 0.2, scale: 1, color: '#c98d55', accent: '#2a2e35', colorLabels: ['Zitting', 'Poten'] },

  // ---------------------------------------------------------------- Verf
  { kind: 'paint', id: 'paint-volume', name: 'Heel volume', category: 'paint', mode: 'volume', color: '#f5c22b', accent: '#f5c22b', colorLabels: ['Verf'] },
  { kind: 'paint', id: 'paint-cell', name: 'Eén blok', category: 'paint', mode: 'cell', color: '#f5c22b', accent: '#f5c22b', colorLabels: ['Verf'] },
  { kind: 'paint', id: 'paint-face', name: 'Eén gevelvlak', category: 'paint', mode: 'face', color: '#e5707a', accent: '#e5707a', colorLabels: ['Verf'] },
  { kind: 'paint', id: 'paint-pick', name: 'Pipet', category: 'paint', mode: 'pick', color: '#f5c22b', accent: '#f5c22b', colorLabels: ['Opgepikt'] },
];

export const CATALOG_BY_ID = new Map<string, AnyDef>(CATALOG.map((d) => [d.id, d]));

export function def<T extends AnyDef = AnyDef>(id: string): T {
  const d = CATALOG_BY_ID.get(id);
  if (!d) throw new Error(`Onbekend catalogus-element: ${id}`);
  return d as T;
}

export function isFacadeDef(d: AnyDef): d is FacadeDef {
  return d.kind === 'window' || d.kind === 'door' || d.kind === 'balcony' || d.kind === 'canopy' || d.kind === 'sign' || d.kind === 'stairs';
}

/** Gevelelementen die een gat in de muur maken (laag "wand"), de rest hangt ervoor (laag "buiten"). */
export function facadeLayer(d: FacadeDef): 'wall' | 'outside' {
  if (d.kind === 'window' || d.kind === 'door') return 'wall';
  if (d.kind === 'balcony' && (d.style === 'loggia' || d.style === 'french')) return 'wall';
  return 'outside';
}

/* ================================================================== MATERIALEN */

export interface CladdingDef {
  id: CladdingId;
  name: string;
}

export const CLADDINGS: CladdingDef[] = [
  { id: 'stucco', name: 'Stuc' },
  { id: 'wood', name: 'Houten latten' },
  { id: 'stone', name: 'Natuursteen' },
  { id: 'concrete', name: 'Beton' },
  { id: 'brick', name: 'Baksteen' },
  { id: 'tiles', name: 'Tegels' },
];

/* ================================================================== PALETTEN */

export interface Palette {
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { name: 'Wit & kobalt', colors: ['#f3f0ea', '#ffffff', '#3b78d0', '#2f6fd6', '#1f3f86', '#cfd6df'] },
  { name: 'Petrol & oranje', colors: ['#4f8f99', '#3f7f8a', '#2c5f68', '#f2a65a', '#e8893a', '#efe6d8'] },
  { name: 'Bauhaus', colors: ['#f3f0e8', '#f5c22b', '#e5707a', '#c9474f', '#7a8a99', '#24282e'] },
  { name: 'Antraciet & zand', colors: ['#3a3b3f', '#56575c', '#d9c3a0', '#c8ad84', '#efe8dc', '#8a7d6b'] },
  { name: 'Beton', colors: ['#b9b7b1', '#a5a39d', '#8f8e8a', '#d8d6d0', '#6c6b67', '#3a3c40'] },
  { name: 'Mediterraan', colors: ['#f2b33d', '#e8793a', '#c4673f', '#f6efe2', '#7a4a2c', '#5c9a3e'] },
  { name: 'Pastel', colors: ['#f6d6d2', '#f7e7b4', '#cfe5d6', '#cddcf0', '#e3d5ef', '#fbf7f0'] },
  { name: 'Natuur', colors: ['#6fae4f', '#5f8f52', '#3e6b3a', '#c98d55', '#8a5a35', '#e6dcc8'] },
];

export const BACKGROUNDS = ['#e9e5df', '#f3efe8', '#dfe6ec', '#f1e3dd', '#e3ecdf', '#46586a', '#2e2b29', '#3a3f4a'];
