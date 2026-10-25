import { def, type AnyDef, type RoofDef } from '../catalog/catalog';
import { CellMap } from '../core/grid';
import type { Design } from '../core/types';
import { roofOf } from '../render/builders/roof';

/**
 * OPDRACHTEN
 * Elke opdracht heeft verplichte eisen (samen 1 ster) en twee bonuseisen (+1 ster elk).
 * Nieuwe opdracht toevoegen = een object aan MISSIONS toevoegen.
 */

export interface Stats {
  design: Design;
  floors: number;
  blocks: number;
  count: (pred: (d: AnyDef, type: string) => boolean) => number;
  kinds: Record<string, number>;
  types: Record<string, number>;
  texts: string[];
  wallColors: Set<string>;
  roofStyles: Set<string>;
  claddings: Set<string>;
  lightShare: number; // aandeel blokken met lichte kleur
}

export interface Check {
  label: string;
  bonus?: boolean;
  test: (s: Stats) => boolean;
}

export interface Mission {
  id: string;
  title: string;
  brief: string;
  icon: string;
  checks: Check[];
}

function lightness(hex: string) {
  const v = parseInt(hex.replace('#', ''), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

export function computeStats(design: Design): Stats {
  const cm = new CellMap(design);
  const kinds: Record<string, number> = {};
  const types: Record<string, number> = {};
  const all: { d: AnyDef; type: string }[] = [];
  for (const it of [...design.facade, ...design.env, ...design.roofItems]) {
    let d: AnyDef;
    try {
      d = def(it.type);
    } catch {
      continue;
    }
    kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    types[it.type] = (types[it.type] ?? 0) + 1;
    all.push({ d, type: it.type });
  }
  const roofStyles = new Set<string>();
  for (const c of design.cells) if (cm.isTop(c)) roofStyles.add((roofOf(c).def as RoofDef).style);
  const wallColors = new Set<string>();
  const claddings = new Set<string>();
  for (const c of design.cells) {
    wallColors.add(c.color.toLowerCase());
    claddings.add(c.cladding);
    for (const f of Object.values(c.faces ?? {})) {
      if (f?.color) wallColors.add(f.color.toLowerCase());
      if (f?.cladding) claddings.add(f.cladding);
    }
  }
  const light = design.cells.filter((c) => lightness(c.color) > 0.82).length;
  return {
    design,
    floors: design.cells.reduce((m, c) => Math.max(m, c.y + 1), 0),
    blocks: design.cells.length,
    count: (pred) => all.filter((a) => pred(a.d, a.type)).length,
    kinds,
    types,
    texts: design.facade.filter((f) => f.text).map((f) => f.text!.toUpperCase().trim()),
    wallColors,
    roofStyles,
    claddings,
    lightShare: design.cells.length ? light / design.cells.length : 0,
  };
}

const plants = (d: AnyDef) => d.kind === 'env' && ['lollipop', 'cypress', 'palm', 'bush', 'planter', 'pot', 'bed'].includes(d.style);
const trees = (d: AnyDef) => d.kind === 'env' && ['lollipop', 'cypress', 'palm'].includes(d.style);

export const MISSIONS: Mission[] = [
  {
    id: 'bakery',
    title: 'De dorpsbakkerij',
    icon: '🥐',
    brief: 'Ontwerp een bakkerij van maximaal 2 lagen met een luifel boven de ingang.',
    checks: [
      { label: 'Maximaal 2 lagen hoog', test: (s) => s.floors >= 1 && s.floors <= 2 },
      { label: 'Minstens één luifel of markies', test: (s) => (s.kinds.canopy ?? 0) >= 1 },
      { label: 'Een voordeur', test: (s) => (s.kinds.door ?? 0) >= 1 },
      { label: 'Gevelbord met de tekst BAKKERIJ', bonus: true, test: (s) => s.texts.some((t) => t.includes('BAKKERIJ') || t.includes('BAKERY')) },
      { label: 'Minstens 2 bloempotten of plantenbakken', bonus: true, test: (s) => s.count((d) => d.kind === 'env' && (d.style === 'pot' || d.style === 'planter')) >= 2 },
    ],
  },
  {
    id: 'hotel',
    title: 'Hotel aan zee',
    icon: '🏨',
    brief: 'Een hotel van minstens 3 lagen met minimaal 6 balkons.',
    checks: [
      { label: 'Minstens 3 lagen', test: (s) => s.floors >= 3 },
      { label: 'Minimaal 6 balkons (of loggia’s)', test: (s) => (s.kinds.balcony ?? 0) >= 6 },
      { label: 'Een ingang met deur', test: (s) => (s.kinds.door ?? 0) >= 1 },
      { label: 'Gevelbord met HOTEL', bonus: true, test: (s) => s.texts.some((t) => t.includes('HOTEL')) },
      { label: 'Luifel of portiek bij de entree', bonus: true, test: (s) => (s.kinds.canopy ?? 0) >= 1 },
    ],
  },
  {
    id: 'whiteblue',
    title: 'Grieks vakantiehuisje',
    icon: '🏝️',
    brief: 'Een wit huisje met blauwe accenten: witte gevels en minstens 4 ramen.',
    checks: [
      { label: 'Minstens 80% witte/lichte blokken', test: (s) => s.blocks > 0 && s.lightShare >= 0.8 },
      { label: 'Minstens 4 ramen', test: (s) => (s.kinds.window ?? 0) >= 4 },
      { label: 'Maximaal 2 lagen', test: (s) => s.floors >= 1 && s.floors <= 2 },
      { label: 'Een boogdeur of boograam', bonus: true, test: (s) => (s.types['door-arch'] ?? 0) + (s.types['win-arch'] ?? 0) >= 1 },
      { label: 'Een boom in de tuin', bonus: true, test: (s) => s.count(trees) >= 1 },
    ],
  },
  {
    id: 'bauhaus',
    title: 'Bauhaus-villa',
    icon: '🟨',
    brief: 'Gedurfde kleurvlakken: minstens 3 gevelkleuren, platte daken en een lang raam.',
    checks: [
      { label: 'Minstens 3 verschillende gevelkleuren', test: (s) => s.wallColors.size >= 3 },
      { label: 'Alleen platte daken', test: (s) => s.blocks > 0 && !s.roofStyles.has('shed') },
      { label: 'Een lintraam of trappenhuisraam', test: (s) => s.count((_, t) => t.startsWith('win-ribbon') || t.startsWith('win-stair')) >= 1 },
      { label: 'Een toren van minstens 4 lagen', bonus: true, test: (s) => s.floors >= 4 },
      { label: 'Een dakterras met hek', bonus: true, test: (s) => s.roofStyles.has('terrace') },
    ],
  },
  {
    id: 'tiny',
    title: 'Tiny house',
    icon: '🏠',
    brief: 'Bouw een compleet huisje van hooguit 4 blokken.',
    checks: [
      { label: 'Maximaal 4 blokken', test: (s) => s.blocks >= 1 && s.blocks <= 4 },
      { label: 'Een deur', test: (s) => (s.kinds.door ?? 0) >= 1 },
      { label: 'Minstens 2 ramen', test: (s) => (s.kinds.window ?? 0) >= 2 },
      { label: 'Een lessenaarsdak', bonus: true, test: (s) => s.roofStyles.has('shed') },
      { label: 'Trap naar de voordeur', bonus: true, test: (s) => (s.kinds.stairs ?? 0) >= 1 },
    ],
  },
  {
    id: 'garage',
    title: 'Stadswoning met garage',
    icon: '🚗',
    brief: 'Een woning van 2 lagen met garage en een balkon.',
    checks: [
      { label: 'Precies 2 lagen', test: (s) => s.floors === 2 },
      { label: 'Een garagedeur', test: (s) => (s.types['door-garage'] ?? 0) >= 1 },
      { label: 'Een balkon', test: (s) => (s.kinds.balcony ?? 0) >= 1 },
      { label: 'Ergens houten bekleding', bonus: true, test: (s) => s.claddings.has('wood') },
      { label: 'Een lantaarnpaal', bonus: true, test: (s) => (s.types.lamp ?? 0) >= 1 },
    ],
  },
  {
    id: 'green',
    title: 'Groene oase',
    icon: '🌿',
    brief: 'Een gebouw in een weelderige tuin: minstens 6 planten en bomen.',
    checks: [
      { label: 'Een gebouw van minstens 2 blokken', test: (s) => s.blocks >= 2 },
      { label: 'Minstens 6 planten, struiken of bomen', test: (s) => s.count(plants) >= 6 },
      { label: 'Minstens 2 ramen', test: (s) => (s.kinds.window ?? 0) >= 2 },
      { label: 'Drie verschillende boomsoorten', bonus: true, test: (s) => ['tree-lollipop', 'tree-cypress', 'tree-palm'].every((t) => (s.types[t] ?? 0) > 0) },
      { label: 'Een dakterras', bonus: true, test: (s) => s.roofStyles.has('terrace') },
    ],
  },
];

export interface MissionResult {
  checks: { label: string; bonus: boolean; ok: boolean }[];
  stars: number;
}

export function evaluate(m: Mission, design: Design): MissionResult {
  const s = computeStats(design);
  const checks = m.checks.map((c) => ({ label: c.label, bonus: !!c.bonus, ok: c.test(s) }));
  const required = checks.filter((c) => !c.bonus);
  const bonus = checks.filter((c) => c.bonus);
  const stars = required.every((c) => c.ok) ? 1 + bonus.filter((c) => c.ok).length : 0;
  return { checks, stars };
}
