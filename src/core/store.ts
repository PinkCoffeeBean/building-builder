import { sanitize } from './rules';
import type { Design } from './types';

export function emptyDesign(name = 'Nieuw ontwerp'): Design {
  return {
    version: 1,
    name,
    plot: { w: 8, d: 8, floors: 6 },
    cells: [],
    facade: [],
    roofItems: [],
    env: [],
    settings: { background: '#e9e5df', base: '#f1eee8', plinth: '#3a3d42', bands: null },
  };
}

type Listener = (d: Design, reason: string) => void;

/** Houdt het huidige ontwerp bij, met undo/redo via snapshots. */
export class Store {
  design: Design;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  /** Id van het opgeslagen ontwerp in de galerij (null = nog niet opgeslagen). */
  savedId: string | null = null;
  dirty = false;

  constructor(d: Design) {
    this.design = d;
  }

  on(fn: Listener) {
    this.listeners.push(fn);
  }

  private emit(reason: string) {
    for (const l of this.listeners) l(this.design, reason);
  }

  /** Voer een wijziging uit als één undo-stap. */
  commit(mut: (d: Design) => void, reason = 'edit') {
    const before = JSON.stringify(this.design);
    mut(this.design);
    sanitize(this.design);
    if (JSON.stringify(this.design) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.emit(reason);
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(prev);
    this.dirty = true;
    this.emit('undo');
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(next);
    this.dirty = true;
    this.emit('redo');
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Nieuw ontwerp laden (wist de geschiedenis). */
  load(d: Design, savedId: string | null = null) {
    this.design = structuredClone(d);
    sanitize(this.design);
    this.undoStack = [];
    this.redoStack = [];
    this.savedId = savedId;
    this.dirty = false;
    this.emit('load');
  }
}
