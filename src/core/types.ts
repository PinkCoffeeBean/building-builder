/** Gevelrichting: buitenvlak van een blok. px = +x, nx = -x, pz = +z, nz = -z. */
export type Dir = 'px' | 'nx' | 'pz' | 'nz';
export type FaceDir = Dir | 'py' | 'ny';

export type CladdingId = 'stucco' | 'wood' | 'stone' | 'concrete' | 'brick' | 'tiles';

export interface FaceStyle {
  color?: string;
  cladding?: CladdingId;
}

export interface RoofStyle {
  type: string; // id uit catalogus (roofs)
  color: string;
  accent?: string;
  /** Afschotrichting voor lessenaarsdak: 0..3 (kwartslagen). */
  rot?: number;
}

export interface Cell {
  x: number;
  y: number;
  z: number;
  color: string;
  cladding: CladdingId;
  faces?: Partial<Record<FaceDir, FaceStyle>>;
  roof?: RoofStyle;
}

/** Element dat aan een gevelvlak vastzit (raam, deur, balkon, luifel, bord, trap). */
export interface FacadeItem {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  dir: Dir;
  /** -1 = links, 0 = midden, 1 = rechts (alleen relevant als het element smaller is dan zijn cel). */
  align: number;
  color: string;
  accent: string;
  text?: string;
}

/** Element op het dak (schoorsteen). */
export interface RoofItem {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  ox: number;
  oz: number;
  color: string;
}

/** Element in de omgeving, vrij op de sokkel (bomen, potten, lantaarn). */
export interface EnvItem {
  id: string;
  type: string;
  x: number;
  z: number;
  rot: number;
  color: string;
  accent: string;
}

export interface DesignSettings {
  background: string;
  base: string;
  plinth: string | null;
  bands: string | null;
}

export interface Design {
  version: 1;
  name: string;
  plot: { w: number; d: number; floors: number };
  cells: Cell[];
  facade: FacadeItem[];
  roofItems: RoofItem[];
  env: EnvItem[];
  settings: DesignSettings;
}

export const DIRS: Dir[] = ['px', 'nx', 'pz', 'nz'];
