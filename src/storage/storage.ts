import { uid } from '../core/grid';
import { emptyDesign } from '../core/store';
import type { Design } from '../core/types';

/** Galerij van eigen ontwerpen in localStorage. Thumbnails apart, zodat de lijst licht blijft. */

const KEY = 'gevelbouwer.designs.v1';
const THUMB = 'gevelbouwer.thumb.';

export interface SavedMeta {
  id: string;
  name: string;
  updated: number;
}

function readIndex(): SavedMeta[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: SavedMeta[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function listDesigns(): SavedMeta[] {
  return readIndex().sort((a, b) => b.updated - a.updated);
}

export function loadDesign(id: string): Design | null {
  try {
    const raw = localStorage.getItem(`${KEY}.${id}`);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function loadThumb(id: string): string | null {
  try {
    return localStorage.getItem(THUMB + id);
  } catch {
    return null;
  }
}

/** Slaat op; geeft het id terug. Gooit een fout als de opslag vol is. */
export function saveDesign(design: Design, thumb: string | null, id?: string | null): string {
  const realId = id ?? uid('d');
  const list = readIndex().filter((m) => m.id !== realId);
  list.push({ id: realId, name: design.name, updated: Date.now() });
  localStorage.setItem(`${KEY}.${realId}`, JSON.stringify(design));
  if (thumb) {
    try {
      localStorage.setItem(THUMB + realId, thumb);
    } catch {
      /* thumbnail is optioneel */
    }
  }
  writeIndex(list);
  return realId;
}

export function deleteDesign(id: string) {
  writeIndex(readIndex().filter((m) => m.id !== id));
  localStorage.removeItem(`${KEY}.${id}`);
  localStorage.removeItem(THUMB + id);
}

/** Maakt een ingelezen ontwerp (bv. uit JSON) compleet en veilig. */
export function normalize(raw: unknown): Design {
  const base = emptyDesign();
  if (!raw || typeof raw !== 'object') throw new Error('Geen geldig ontwerp');
  const r = raw as Partial<Design>;
  if (!Array.isArray(r.cells)) throw new Error('Ontwerp mist "cells"');
  const num = (v: unknown, def = 0) => (typeof v === 'number' && isFinite(v) ? v : def);
  const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
  return {
    version: 1,
    name: str(r.name, 'Geïmporteerd ontwerp').slice(0, 60),
    plot: {
      w: Math.min(16, Math.max(2, num(r.plot?.w, 8))),
      d: Math.min(16, Math.max(2, num(r.plot?.d, 8))),
      floors: Math.min(10, Math.max(1, num(r.plot?.floors, 6))),
    },
    cells: r.cells
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        x: num(c.x),
        y: num(c.y),
        z: num(c.z),
        color: str(c.color, '#f3f0ea'),
        cladding: c.cladding ?? 'stucco',
        ...(c.faces ? { faces: c.faces } : {}),
        ...(c.roof ? { roof: c.roof } : {}),
      })),
    facade: Array.isArray(r.facade) ? r.facade.map((f) => ({ ...f, id: str(f.id, uid('f')) })) : [],
    roofItems: Array.isArray(r.roofItems) ? r.roofItems.map((f) => ({ ...f, id: str(f.id, uid('r')) })) : [],
    env: Array.isArray(r.env) ? r.env.map((f) => ({ ...f, id: str(f.id, uid('e')) })) : [],
    settings: { ...base.settings, ...(r.settings ?? {}) },
  };
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function downloadDataUrl(filename: string, url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function safeFilename(name: string) {
  return (name || 'ontwerp').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'ontwerp';
}

/* -------------------------------------------------------------- opdrachten: beste scores */
const STARS = 'gevelbouwer.stars.v1';
export function loadStars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STARS) ?? '{}');
  } catch {
    return {};
  }
}
export function saveStars(s: Record<string, number>) {
  try {
    localStorage.setItem(STARS, JSON.stringify(s));
  } catch {
    /* negeren */
  }
}
