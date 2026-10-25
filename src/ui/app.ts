import * as THREE from 'three';
import {
  BACKGROUNDS,
  CATALOG,
  CATEGORIES,
  CLADDINGS,
  PALETTES,
  isFacadeDef,
  type AnyDef,
  type CategoryId,
} from '../catalog/catalog';
import { Store, emptyDesign } from '../core/store';
import type { CladdingId, Design } from '../core/types';
import { Controller } from '../interaction/controller';
import { MISSIONS, evaluate, type Mission } from '../missions/missions';
import { buildDesign, type BuiltDesign } from '../render/buildDesign';
import { Stage } from '../render/stage';
import { samples } from '../samples/samples';
import {
  deleteDesign,
  downloadDataUrl,
  downloadText,
  listDesigns,
  loadDesign,
  loadStars,
  loadThumb,
  normalize,
  safeFilename,
  saveDesign,
  saveStars,
} from '../storage/storage';
import { ask, clear, h, modal, stars, toast } from './dom';
import { ThumbRenderer } from './thumbs';

const AUTOSAVE = 'gevelbouwer.autosave.v1';

const LOGO = `<svg viewBox="0 0 32 32"><rect x="3" y="11" width="15" height="18" rx="2.5" fill="#f3f0e8" stroke="#23262b" stroke-width="1.4"/><rect x="14" y="3" width="15" height="26" rx="2.5" fill="#f5c22b" stroke="#23262b" stroke-width="1.4"/><rect x="8" y="20" width="6" height="9" fill="#e5707a" stroke="#23262b" stroke-width="1.2"/><rect x="18" y="8" width="3" height="15" rx="1" fill="#23262b"/></svg>`;

export class App {
  store: Store;
  stage: Stage;
  controller: Controller;
  thumbs = new ThumbRenderer();
  built: BuiltDesign | null = null;

  category: CategoryId = 'volumes';
  activeSlot: 'color' | 'accent' = 'color';
  paletteIdx = 2;
  mission: Mission | null = null;
  photo = false;

  // DOM
  root: HTMLElement;
  nameInput!: HTMLInputElement;
  rail!: HTMLElement;
  palette!: HTMLElement;
  viewport!: HTMLElement;
  inspector!: HTMLElement;
  statusEl!: HTMLElement;
  hud!: HTMLElement;
  undoBtn!: HTMLButtonElement;
  redoBtn!: HTMLButtonElement;
  viewBtns: Record<string, HTMLButtonElement> = {};
  private statusTimer = 0;
  private autosaveTimer = 0;
  private sampleThumbs = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildLayout();
    this.stage = new Stage(this.viewport);
    // raster niet meenemen in de AO-berekening
    const gtaoRender = this.stage.gtao.render.bind(this.stage.gtao);
    this.stage.gtao.render = (...args: Parameters<typeof gtaoRender>) => {
      const v = this.stage.grid.visible;
      this.stage.grid.visible = false;
      gtaoRender(...args);
      this.stage.grid.visible = v;
    };

    this.store = new Store(emptyDesign());
    this.controller = new Controller(this.stage, this.store, {
      status: (m, k) => this.status(m, k),
      picked: (c) => {
        for (const d of CATALOG) if (d.kind === 'paint' && d.mode !== 'pick') this.controller.setColors(c, c, d);
        this.controller.setColors(c, c);
        this.renderInspector();
        this.status(`Kleur ${c} opgepikt`, 'ok');
      },
      toolChanged: () => {
        const cat = this.controller.def.category;
        if (cat !== this.category) {
          this.category = cat;
          this.renderRail();
        }
        this.renderPalette();
        this.renderInspector();
      },
    });
    this.store.on((_d, reason) => this.onChange(reason));

    // eerste ontwerp: autosave of het eerste voorbeeld
    let initial: Design | null = null;
    try {
      const raw = localStorage.getItem(AUTOSAVE);
      if (raw) initial = normalize(JSON.parse(raw).design);
      const sid = raw ? JSON.parse(raw).savedId : null;
      if (initial) this.store.load(initial, sid ?? null);
    } catch {
      initial = null;
    }
    if (!initial) this.store.load(samples()[2].design);

    this.setCategory('volumes');
    this.bindKeys();
    setTimeout(() => this.frameAll(), 50);
    this.status('Welkom! Kies een gereedschap links en klik in de scène. Slepen = schuiven, scrollen = zoomen.');
    (window as unknown as { app: App }).app = this;
  }

  /* ================================================================== layout */

  private buildLayout() {
    this.nameInput = h('input', {
      class: 'name-input',
      value: '',
      title: 'Naam van het ontwerp',
      onchange: () => this.store.commit((d) => (d.name = this.nameInput.value.slice(0, 60) || 'Naamloos')),
    }) as HTMLInputElement;
    this.undoBtn = h('button', { class: 'btn', title: 'Ongedaan maken (Ctrl+Z)', onclick: () => this.store.undo() }, h('span', { class: 'ico' }, '↶')) as HTMLButtonElement;
    this.redoBtn = h('button', { class: 'btn', title: 'Opnieuw (Ctrl+Y)', onclick: () => this.store.redo() }, h('span', { class: 'ico' }, '↷')) as HTMLButtonElement;
    this.viewBtns.iso = h('button', { class: 'btn active', title: 'Isometrisch', onclick: () => this.setView('iso') }, h('span', { class: 'ico' }, '◇'), h('span', { class: 'lbl' }, 'Iso')) as HTMLButtonElement;
    this.viewBtns.front = h('button', { class: 'btn', title: 'Vooraanzicht (V)', onclick: () => this.setView('front') }, h('span', { class: 'ico' }, '▭'), h('span', { class: 'lbl' }, 'Vooraanzicht')) as HTMLButtonElement;

    const brand = h('div', { class: 'brand' });
    brand.innerHTML = `${LOGO}<span>Gevelbouwer</span>`;

    const top = h(
      'div',
      { class: 'topbar' },
      brand,
      this.nameInput,
      h(
        'div',
        { class: 'tb-group' },
        h('button', { class: 'btn', title: 'Nieuw ontwerp', onclick: () => this.newDesign() }, h('span', { class: 'ico' }, '＋'), h('span', { class: 'lbl' }, 'Nieuw')),
        h('button', { class: 'btn', title: 'Galerij', onclick: () => this.openGallery() }, h('span', { class: 'ico' }, '▦'), h('span', { class: 'lbl' }, 'Galerij')),
        h('button', { class: 'btn', title: 'Opslaan (Ctrl+S)', onclick: () => this.save() }, h('span', { class: 'ico' }, '💾'), h('span', { class: 'lbl' }, 'Opslaan')),
        h('button', { class: 'btn', title: 'Exporteer als JSON', onclick: () => this.exportJson() }, h('span', { class: 'ico' }, '⤓'), h('span', { class: 'lbl' }, 'JSON')),
        h('button', { class: 'btn', title: 'Importeer JSON', onclick: () => this.importJson() }, h('span', { class: 'ico' }, '⤒'), h('span', { class: 'lbl' }, 'Import')),
      ),
      h('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
      h(
        'div',
        { class: 'tb-group' },
        h('button', { class: 'btn', title: 'Camera linksom (Q)', onclick: () => this.stage.rotate(-1) }, h('span', { class: 'ico' }, '⟲')),
        h('button', { class: 'btn', title: 'Camera rechtsom (E)', onclick: () => this.stage.rotate(1) }, h('span', { class: 'ico' }, '⟳')),
        this.viewBtns.iso,
        this.viewBtns.front,
      ),
      h('div', { class: 'tb-spacer' }),
      h(
        'div',
        { class: 'tb-group' },
        h('button', { class: 'btn', title: 'Opdrachten', onclick: () => this.openMissions() }, h('span', { class: 'ico' }, '★'), h('span', { class: 'lbl' }, 'Opdrachten')),
        h('button', { class: 'btn', title: 'Sneltoetsen', onclick: () => this.openHelp() }, h('span', { class: 'ico' }, '?')),
      ),
      h('button', { class: 'btn primary', title: 'Fotomodus (P)', onclick: () => this.enterPhoto() }, h('span', { class: 'ico' }, '📷'), h('span', { class: 'lbl' }, 'Fotomodus')),
    );

    this.rail = h('div', { class: 'rail' });
    this.palette = h('div', { class: 'palette' });
    this.statusEl = h('div', { class: 'status' }, '');
    this.hud = h('div', { class: 'mission-hud', style: 'display:none' });
    this.viewport = h(
      'div',
      { class: 'viewport' },
      this.statusEl,
      h('div', { class: 'hint' }, h('kbd', null, 'Klik'), ' plaatsen · ', h('kbd', null, 'Rechts'), ' wissen · ', h('kbd', null, 'R'), ' draaien · ', h('kbd', null, 'Q'), h('kbd', null, 'E'), ' camera'),
      h(
        'div',
        { class: 'view-tools' },
        h('button', { class: 'fab', title: 'Inzoomen', onclick: () => this.stage.setZoom(this.stage.zoom * 1.2) }, '＋'),
        h('button', { class: 'fab', title: 'Uitzoomen', onclick: () => this.stage.setZoom(this.stage.zoom / 1.2) }, '－'),
        h('button', { class: 'fab', title: 'Alles in beeld (F)', onclick: () => this.frameAll() }, '⤢'),
        h('button', { class: 'fab inspector-toggle', title: 'Eigenschappen', onclick: () => this.inspector.classList.toggle('open') }, '🎨'),
      ),
      this.hud,
    );
    this.inspector = h('div', { class: 'inspector' });
    const main = h('div', { class: 'main' }, this.rail, this.palette, this.viewport, this.inspector);
    this.root.append(top, main);
  }

  /* ================================================================== categorieën & items */

  setCategory(c: CategoryId) {
    this.category = c;
    const first = CATALOG.find((d) => d.category === c);
    const cur = this.controller.def;
    if (first && cur.category !== c) this.controller.setTool(first.id);
    this.renderRail();
    this.renderPalette();
    this.renderInspector();
  }

  private renderRail() {
    clear(this.rail);
    for (const c of CATEGORIES) {
      this.rail.append(
        h(
          'button',
          {
            class: `rail-btn${this.category === c.id && !this.controller.tool.eraser ? ' active' : ''}`,
            title: c.name,
            onclick: () => {
              this.controller.tool.eraser = false;
              this.setCategory(c.id);
            },
          },
          h('span', { class: 'ico' }, c.icon),
          c.name,
        ),
      );
    }
    this.rail.append(h('div', { class: 'rail-sep' }));
    this.rail.append(
      h(
        'button',
        {
          class: `rail-btn eraser${this.controller.tool.eraser ? ' active' : ''}`,
          title: 'Gum (G) — tik om te wissen',
          onclick: () => this.toggleEraser(),
        },
        h('span', { class: 'ico' }, '⌫'),
        'Gum',
      ),
    );
  }

  toggleEraser(on = !this.controller.tool.eraser) {
    this.controller.tool.eraser = on;
    this.controller.refresh();
    this.renderRail();
    this.status(on ? 'Gum actief: klik op een element om het te verwijderen' : 'Gum uit');
  }

  private iconFor(d: AnyDef): HTMLElement {
    if (d.kind === 'paint') {
      const glyph = { volume: '🪣', cell: '▣', face: '▱', pick: '💧' }[d.mode];
      return h('div', { class: 'glyph' }, glyph);
    }
    const img = h('img', { alt: d.name, loading: 'lazy' }) as HTMLImageElement;
    // pictogrammen achter elkaar renderen zonder de interface te blokkeren
    requestAnimationFrame(() => {
      img.src = this.thumbs.item(d);
    });
    return img;
  }

  private renderPalette() {
    clear(this.palette);
    const cat = CATEGORIES.find((c) => c.id === this.category)!;
    this.palette.append(h('h3', null, cat.name));
    const grid = h('div', { class: 'items' });
    for (const d of CATALOG.filter((x) => x.category === this.category)) {
      grid.append(
        h(
          'button',
          {
            class: `item${this.controller.tool.defId === d.id ? ' active' : ''}`,
            title: d.name,
            onclick: () => {
              this.controller.tool.eraser = false;
              this.controller.setTool(d.id);
              this.renderRail();
            },
          },
          this.iconFor(d),
          d.name,
        ),
      );
    }
    this.palette.append(grid);
  }

  /* ================================================================== inspector */

  renderInspector() {
    const ins = this.inspector;
    clear(ins);
    const d = this.controller.def;
    const cols = this.controller.colorsFor(d);
    const labels = d.colorLabels ?? (d.kind === 'volume' ? ['Kleur'] : ['Kleur', 'Accent']);
    const hasAccent = !!labels[1] && labels[1] !== '—' && d.kind !== 'volume';

    // --- gereedschap
    const toolCard = h('div', { class: 'card' });
    const thumb = d.kind === 'paint' ? null : (h('img', { src: this.thumbs.item(d, cols.color, cols.accent) }) as HTMLImageElement);
    toolCard.append(
      h(
        'div',
        { class: 'tool-head' },
        thumb,
        h('div', null, h('div', { class: 't' }, d.name), h('div', { class: 's' }, CATEGORIES.find((c) => c.id === d.category)!.name + (isFacadeDef(d) ? ` · ${d.span[0]}×${d.span[1]} cel` : ''))),
      ),
    );

    const slot = (which: 'color' | 'accent', label: string) => {
      const val = which === 'color' ? cols.color : cols.accent;
      const input = h('input', {
        type: 'color',
        value: val,
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          if (which === 'color') this.controller.setColors(v, undefined);
          else this.controller.setColors(undefined, v);
          sw.style.background = v;
          code.textContent = v;
        },
        onchange: () => this.renderInspector(),
      });
      const sw = h('div', { class: 'sw', style: `background:${val}` }, input);
      const code = h('span', null, val);
      return h(
        'div',
        {
          class: `slot${this.activeSlot === which ? ' active' : ''}`,
          onclick: () => {
            if (this.activeSlot !== which) {
              this.activeSlot = which;
              this.renderInspector();
            }
          },
        },
        sw,
        h('div', { class: 'meta' }, h('b', null, label), code),
      );
    };
    if (this.activeSlot === 'accent' && !hasAccent) this.activeSlot = 'color';
    toolCard.append(h('div', { class: 'row' }, slot('color', labels[0]), hasAccent ? slot('accent', labels[1]!) : null));

    // paletten
    const palSel = h(
      'select',
      {
        class: 'sel',
        onchange: (e: Event) => {
          this.paletteIdx = Number((e.target as HTMLSelectElement).value);
          this.renderInspector();
        },
      },
      ...PALETTES.map((p, i) => h('option', { value: String(i), selected: i === this.paletteIdx }, p.name)),
    );
    const sws = h('div', { class: 'swatches' });
    const activeVal = this.activeSlot === 'color' ? cols.color : cols.accent;
    for (const c of PALETTES[this.paletteIdx].colors) {
      sws.append(
        h('button', {
          class: `swatch${c.toLowerCase() === activeVal.toLowerCase() ? ' sel' : ''}`,
          style: `background:${c}`,
          title: c,
          onclick: () => {
            if (this.activeSlot === 'color') this.controller.setColors(c, undefined);
            else this.controller.setColors(undefined, c);
            this.renderInspector();
          },
        }),
      );
    }
    toolCard.append(h('div', { class: 'row' }, h('label', { class: 'lbl' }, 'Palet'), palSel), sws);

    // specifieke opties
    if (isFacadeDef(d)) {
      const seg = h('div', { class: 'seg' });
      for (const [v, l] of [
        [-1, 'Links'],
        [0, 'Midden'],
        [1, 'Rechts'],
      ] as [number, string][])
        seg.append(
          h(
            'button',
            {
              class: this.controller.tool.align === v ? 'on' : '',
              onclick: () => {
                this.controller.tool.align = v;
                this.controller.refresh();
                this.renderInspector();
              },
            },
            l,
          ),
        );
      toolCard.append(h('div', { class: 'row' }, h('label', { class: 'lbl' }, 'Positie (R)'), seg));
    }
    if (d.kind === 'sign') {
      const txt = h('input', {
        class: 'txt',
        value: this.controller.tool.text || d.defaultText,
        maxlength: 14,
        oninput: (e: Event) => {
          this.controller.tool.text = (e.target as HTMLInputElement).value.toUpperCase();
          this.controller.refresh();
        },
      });
      toolCard.append(h('div', { class: 'row' }, h('label', { class: 'lbl' }, 'Tekst'), txt));
    }
    if (d.kind === 'env' || (d.kind === 'roof' && d.style === 'shed')) {
      const seg = h('div', { class: 'seg' });
      for (let r = 0; r < 4; r++)
        seg.append(
          h(
            'button',
            {
              class: this.controller.tool.rot === r ? 'on' : '',
              onclick: () => {
                this.controller.tool.rot = r;
                this.controller.refresh();
                this.renderInspector();
              },
            },
            `${r * 90}°`,
          ),
        );
      toolCard.append(h('div', { class: 'row' }, h('label', { class: 'lbl' }, d.kind === 'roof' ? 'Helling (R)' : 'Draaiing (R)'), seg));
    }
    if (d.kind === 'paint' && d.mode !== 'pick') {
      const sel = h(
        'select',
        {
          class: 'sel',
          onchange: (e: Event) => {
            this.controller.tool.paintCladding = (e.target as HTMLSelectElement).value as CladdingId | 'keep';
            this.controller.refresh();
          },
        },
        h('option', { value: 'keep', selected: this.controller.tool.paintCladding === 'keep' }, 'Huidige behouden'),
        ...CLADDINGS.map((c) => h('option', { value: c.id, selected: this.controller.tool.paintCladding === c.id }, c.name)),
      );
      toolCard.append(h('div', { class: 'row' }, h('label', { class: 'lbl' }, 'Bekleding'), sel));
    }
    if (d.kind === 'paint') {
      const seg = h('div', { class: 'seg' });
      for (const [v, l] of [
        ['main', 'Hoofdkleur'],
        ['accent', 'Accent / kozijn'],
      ] as ['main' | 'accent', string][])
        seg.append(
          h(
            'button',
            {
              class: this.controller.tool.paintTarget === v ? 'on' : '',
              onclick: () => {
                this.controller.tool.paintTarget = v;
                this.controller.refresh();
                this.renderInspector();
              },
            },
            l,
          ),
        );
      toolCard.append(h('div', { class: 'row' }, h('label', { class: 'lbl' }, 'Elementen'), seg));
      toolCard.append(h('p', { class: 'muted' }, 'Klik op een blok, gevelvlak, dak, element of de sokkel om te verven. De pipet neemt een kleur over.'));
    }
    if (d.kind === 'volume')
      toolCard.append(h('p', { class: 'muted' }, 'Klik op de grond of op een blokzijde. Blokken met dezelfde kleur versmelten tot één volume. Rechtsklik verwijdert.'));
    if (d.kind === 'roof') toolCard.append(h('p', { class: 'muted' }, 'Klik op een dak: het hele dakvlak op die hoogte krijgt dit daktype.'));
    ins.append(toolCard);

    // --- ontwerp-instellingen
    const s = this.store.design.settings;
    const setCard = h('div', { class: 'card' }, h('h3', null, 'Ontwerp'));
    const colorRow = (label: string, val: string, set: (v: string) => void) => {
      const inp = h('input', { type: 'color', value: val, onchange: (e: Event) => set((e.target as HTMLInputElement).value) });
      return h('div', { class: 'row' }, h('label', { class: 'lbl' }, label), h('div', { class: 'mini-sw', style: `background:${val}` }, inp));
    };
    const bgs = h('div', { class: 'swatches' });
    for (const c of BACKGROUNDS)
      bgs.append(
        h('button', {
          class: `swatch${c === s.background ? ' sel' : ''}`,
          style: `background:${c}`,
          onclick: () => this.store.commit((dd) => (dd.settings.background = c)),
        }),
      );
    setCard.append(
      colorRow('Achtergrond', s.background, (v) => this.store.commit((dd) => (dd.settings.background = v))),
      bgs,
      colorRow('Sokkel', s.base, (v) => this.store.commit((dd) => (dd.settings.base = v))),
    );
    const toggleRow = (label: string, val: string | null, fallback: string, set: (v: string | null) => void) => {
      const cb = h('input', { type: 'checkbox', checked: !!val, onchange: (e: Event) => set((e.target as HTMLInputElement).checked ? fallback : null) });
      const row = h('div', { class: 'row' }, h('label', { class: 'toggle lbl' }, cb, label));
      if (val) row.append(h('div', { class: 'mini-sw', style: `background:${val}` }, h('input', { type: 'color', value: val, onchange: (e: Event) => set((e.target as HTMLInputElement).value) })));
      return row;
    };
    setCard.append(
      toggleRow('Plint', s.plinth, '#3a3d42', (v) => this.store.commit((dd) => (dd.settings.plinth = v))),
      toggleRow('Gevelbanden', s.bands, '#ffffff', (v) => this.store.commit((dd) => (dd.settings.bands = v))),
    );
    const ao = h('input', {
      type: 'checkbox',
      checked: this.stage.aoEnabled,
      onchange: (e: Event) => {
        this.stage.aoEnabled = (e.target as HTMLInputElement).checked;
        this.stage.invalidate();
      },
    });
    setCard.append(h('div', { class: 'row' }, h('label', { class: 'toggle lbl' }, ao, 'Zachte schaduw (AO)')));
    const stats = this.store.design;
    const floors = stats.cells.reduce((m, c) => Math.max(m, c.y + 1), 0);
    setCard.append(h('p', { class: 'muted', style: 'margin:10px 0 0' }, `${stats.cells.length} blokken · ${floors} lagen · ${stats.facade.length} gevelelementen · ${stats.env.length} in de omgeving`));
    ins.append(setCard);
  }

  /* ================================================================== bouwen & veranderen */

  private onChange(reason: string) {
    this.rebuild();
    this.nameInput.value = this.store.design.name;
    this.undoBtn.disabled = !this.store.canUndo;
    this.redoBtn.disabled = !this.store.canRedo;
    this.renderInspector();
    this.updateHud();
    if (reason === 'load') setTimeout(() => this.frameAll(), 0);
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE, JSON.stringify({ design: this.store.design, savedId: this.store.savedId }));
      } catch {
        /* opslag vol: negeren */
      }
    }, 400);
  }

  rebuild() {
    if (this.built) {
      this.stage.content.remove(this.built.group);
      this.built.dispose();
    }
    const d = this.store.design;
    this.built = buildDesign(d);
    this.stage.content.add(this.built.group);
    this.controller.built = this.built.group;
    this.stage.setBackground(d.settings.background);
    if ((this.stage.grid.geometry as THREE.PlaneGeometry).parameters.width !== d.plot.w) this.stage.setGrid(d.plot.w, d.plot.d, !this.photo);
    this.controller.refresh();
    this.stage.invalidate();
  }

  /** Beeldverhouding van de foto-uitsnede (alleen in fotomodus). */
  photoAspect = 1;

  frameAll() {
    const box = new THREE.Box3();
    if (this.built)
      this.built.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && (this.photo || o.userData.kind !== 'ground')) box.expandByObject(o);
      });
    const d = this.store.design;
    // minimaal de kavel laten zien als er weinig staat
    const plot = new THREE.Box3(new THREE.Vector3(-d.plot.w / 2, 0, -d.plot.d / 2), new THREE.Vector3(d.plot.w / 2, 1.5, d.plot.d / 2));
    if (box.isEmpty() || d.cells.length < 3) box.union(plot);
    this.stage.frame(box, this.photo ? 1.1 : 1.3, this.photo ? this.photoAspect : undefined);
  }

  setView(mode: 'iso' | 'front') {
    this.stage.setMode(mode);
    this.viewBtns.iso.classList.toggle('active', mode === 'iso');
    this.viewBtns.front.classList.toggle('active', mode === 'front');
  }

  status(msg: string, kind: 'info' | 'error' | 'ok' = 'info') {
    this.statusEl.textContent = msg;
    this.statusEl.className = `status ${kind === 'info' ? '' : kind}`;
    clearTimeout(this.statusTimer);
    if (kind !== 'info')
      this.statusTimer = window.setTimeout(() => {
        this.statusEl.className = 'status';
      }, 1800);
  }

  /* ================================================================== toetsenbord */

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (document.querySelector('.modal-back')) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.store.undo();
      } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.store.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        this.save();
      } else if (mod) return;
      else if (k === 'escape') {
        if (this.photo) this.exitPhoto();
        else if (this.controller.tool.eraser) this.toggleEraser(false);
      } else if (this.photo) return;
      else if (k === 'r') this.controller.rotateTool();
      else if (k === 'q') this.stage.rotate(-1);
      else if (k === 'e') this.stage.rotate(1);
      else if (k === 'v') this.setView(this.stage.mode === 'front' ? 'iso' : 'front');
      else if (k === 'f') this.frameAll();
      else if (k === 'g' || k === 'delete' || k === 'backspace') this.toggleEraser();
      else if (k === 'p') this.enterPhoto();
      else if (/^[1-7]$/.test(k)) {
        this.controller.tool.eraser = false;
        this.setCategory(CATEGORIES[Number(k) - 1].id);
      } else return;
      if (k === 'q' || k === 'e') setTimeout(() => this.controller.refresh(), 450);
    });
  }

  /* ================================================================== opslaan & delen */

  async newDesign() {
    if (this.store.dirty && !(await ask('Huidig ontwerp sluiten? Niet-opgeslagen wijzigingen gaan verloren.', 'Sluiten'))) return;
    this.store.load(emptyDesign());
    this.mission = null;
    this.updateHud();
    this.status('Nieuw ontwerp. Klik op het raster om je eerste blok te zetten.');
  }

  save() {
    try {
      const thumb = this.thumbs.design(this.store.design, 320);
      const id = saveDesign(this.store.design, thumb, this.store.savedId);
      this.store.savedId = id;
      this.store.dirty = false;
      toast(`“${this.store.design.name}” opgeslagen in de galerij`);
    } catch (e) {
      toast('Opslaan mislukt: de browseropslag is vol. Verwijder oude ontwerpen in de galerij.');
      console.error(e);
    }
  }

  exportJson() {
    downloadText(`${safeFilename(this.store.design.name)}.json`, JSON.stringify(this.store.design, null, 2));
  }

  importJson() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        const d = normalize(JSON.parse(await f.text()));
        this.store.load(d);
        toast(`“${d.name}” geïmporteerd`);
      } catch (e) {
        toast(`Kon dit bestand niet lezen: ${(e as Error).message}`);
      }
    };
    inp.click();
  }

  /* ================================================================== galerij */

  openGallery() {
    const body = h('div');
    let close = () => {};
    const open = async (d: Design, id: string | null) => {
      if (this.store.dirty && !(await ask('Huidig ontwerp sluiten? Niet-opgeslagen wijzigingen gaan verloren.', 'Sluiten'))) return;
      this.store.load(d, id);
      close();
    };
    const fmt = (t: number) => new Date(t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    body.append(h('h4', null, 'Voorbeelden'));
    const sg = h('div', { class: 'cards' });
    for (const s of samples()) {
      const img = h('img', { class: 'thumb', alt: s.design.name, onclick: () => open(s.design, null) }) as HTMLImageElement;
      const cached = this.sampleThumbs.get(s.id);
      if (cached) img.src = cached;
      else
        setTimeout(() => {
          const url = this.thumbs.design(s.design, 320);
          this.sampleThumbs.set(s.id, url);
          img.src = url;
        }, 30);
      sg.append(
        h(
          'div',
          { class: 'gcard' },
          img,
          h('div', { class: 'info' }, h('div', { class: 'n' }, h('b', null, s.design.name), h('span', null, 'Voorbeeld')), h('button', { class: 'btn', onclick: () => open(s.design, null) }, 'Open')),
        ),
      );
    }
    body.append(sg);

    body.append(h('h4', null, 'Mijn ontwerpen'));
    const mine = listDesigns();
    const mg = h('div', { class: 'cards' });
    if (!mine.length) body.append(h('p', { class: 'muted' }, 'Nog niets opgeslagen. Gebruik “Opslaan” in de bovenbalk (Ctrl+S).'));
    for (const m of mine) {
      const thumb = loadThumb(m.id);
      const load = () => {
        const d = loadDesign(m.id);
        if (d) open(d, m.id);
        else toast('Dit ontwerp kon niet worden geladen.');
      };
      const card = h(
        'div',
        { class: 'gcard' },
        h('img', { class: 'thumb', src: thumb ?? '', alt: m.name, onclick: load }),
        h(
          'div',
          { class: 'info' },
          h('div', { class: 'n' }, h('b', null, m.name), h('span', null, fmt(m.updated))),
          h(
            'button',
            {
              class: 'icon-btn',
              title: 'Exporteer JSON',
              onclick: () => {
                const d = loadDesign(m.id);
                if (d) downloadText(`${safeFilename(d.name)}.json`, JSON.stringify(d, null, 2));
              },
            },
            '⤓',
          ),
          h(
            'button',
            {
              class: 'icon-btn danger',
              title: 'Verwijderen',
              onclick: async () => {
                if (!(await ask(`“${m.name}” verwijderen uit de galerij?`, 'Verwijderen'))) return;
                deleteDesign(m.id);
                if (this.store.savedId === m.id) this.store.savedId = null;
                card.remove();
              },
            },
            '🗑',
          ),
          h('button', { class: 'btn', onclick: load }, 'Open'),
        ),
      );
      mg.append(card);
    }
    body.append(mg);
    close = modal('Galerij', body, { actions: h('button', { class: 'btn', onclick: () => (close(), this.importJson()) }, '⤒ Importeer JSON') });
  }

  /* ================================================================== fotomodus */

  enterPhoto() {
    if (this.photo) return;
    this.photo = true;
    document.body.classList.add('photo');
    this.controller.clearGhost();
    this.controller.viewOnly = true;
    this.stage.grid.visible = false;
    let aspect = this.photoAspect;
    let res = 2400;
    const frameEl = h('div', { class: 'photo-frame' });
    document.body.append(frameEl);
    const updateFrame = () => {
      const r = this.viewport.getBoundingClientRect();
      const sa = r.width / r.height;
      let w = r.width;
      let hh = r.height;
      if (aspect > sa) hh = w / aspect;
      else w = hh * aspect;
      Object.assign(frameEl.style, { left: `${r.left + (r.width - w) / 2}px`, top: `${r.top + (r.height - hh) / 2}px`, width: `${w}px`, height: `${hh}px` });
    };
    const startAz = Math.round(((this.stage.azimuth * 180) / Math.PI) % 360 + 360) % 360;
    const startEl = Math.round((this.stage.elevation * 180) / Math.PI);
    const az = h('input', { type: 'range', min: 0, max: 359, value: startAz }) as HTMLInputElement;
    const el = h('input', { type: 'range', min: 0, max: 75, value: startEl }) as HTMLInputElement;
    const zoom = h('input', { type: 'range', min: 35, max: 400, value: Math.round(this.stage.zoom * 100) }) as HTMLInputElement;
    const applyAngle = () => this.stage.setFree(Number(az.value), Number(el.value));
    az.oninput = applyAngle;
    el.oninput = applyAngle;
    zoom.oninput = () => this.stage.setZoom(Number(zoom.value) / 100);
    const syncSliders = () => {
      az.value = String(Math.round(((this.stage.azimuth * 180) / Math.PI % 360 + 360) % 360));
      el.value = String(Math.round((this.stage.elevation * 180) / Math.PI));
      zoom.value = String(Math.round(this.stage.zoom * 100));
    };
    const bgs = h('div', { class: 'swatches' });
    const renderBgs = () => {
      clear(bgs);
      for (const c of BACKGROUNDS)
        bgs.append(h('button', { class: `swatch${c === this.store.design.settings.background ? ' sel' : ''}`, style: `background:${c}`, onclick: () => (this.store.commit((d) => (d.settings.background = c)), renderBgs()) }));
      bgs.append(
        h('div', { class: 'mini-sw', style: `background:${this.store.design.settings.background}` }, h('input', { type: 'color', value: this.store.design.settings.background, oninput: (e: Event) => this.stage.setBackground((e.target as HTMLInputElement).value), onchange: (e: Event) => (this.store.commit((d) => (d.settings.background = (e.target as HTMLInputElement).value)), renderBgs()) })),
      );
    };
    renderBgs();
    const aspSeg = h('div', { class: 'seg' });
    const aspects: [string, number][] = [
      ['1:1', 1],
      ['4:5', 0.8],
      ['3:2', 1.5],
      ['16:9', 16 / 9],
    ];
    const renderAsp = () => {
      clear(aspSeg);
      for (const [l, v] of aspects) aspSeg.append(h('button', { class: v === aspect ? 'on' : '', onclick: () => ((aspect = this.photoAspect = v), renderAsp(), updateFrame(), this.frameAll(), syncSliders()) }, l));
    };
    renderAsp();
    const resSel = h('select', { class: 'sel', onchange: (e: Event) => (res = Number((e.target as HTMLSelectElement).value)) }, ...[1600, 2400, 3200, 4096].map((r) => h('option', { value: String(r), selected: r === res }, `${r} px`))) as HTMLSelectElement;
    const preset = (mode: 'iso' | 'front', step = 0) => {
      this.stage.mode = mode;
      if (step) this.stage.azimuthStep += step;
      this.stage.setMode(mode);
      setTimeout(syncSliders, 450);
    };
    const panel = h(
      'div',
      { class: 'photo-panel' },
      h('div', { class: 'title' }, h('span', null, '📷 Fotomodus'), h('button', { class: 'icon-btn', title: 'Sluiten (Esc)', onclick: () => this.exitPhoto() }, '✕')),
      h('label', null, 'Achtergrond', bgs),
      h(
        'label',
        null,
        'Camerahoek',
        h(
          'div',
          { class: 'seg' },
          h('button', { onclick: () => preset('iso') }, 'Iso'),
          h('button', { onclick: () => preset('front') }, 'Vooraanzicht'),
          h('button', { onclick: () => preset(this.stage.mode === 'free' ? 'iso' : (this.stage.mode as 'iso' | 'front'), -1) }, '⟲'),
          h('button', { onclick: () => preset(this.stage.mode === 'free' ? 'iso' : (this.stage.mode as 'iso' | 'front'), 1) }, '⟳'),
        ),
      ),
      h('label', null, 'Draaien', az),
      h('label', null, 'Hoogte', el),
      h('label', null, 'Zoom', zoom),
      h('label', null, 'Beeldverhouding', aspSeg),
      h('label', null, 'Resolutie', resSel),
      h('button', { class: 'btn', onclick: () => (this.frameAll(), syncSliders()) }, '⤢ Passend maken'),
      h(
        'button',
        {
          class: 'btn primary',
          style: 'justify-content:center',
          onclick: () => {
            const w = aspect >= 1 ? res : Math.round(res * aspect);
            const hh = aspect >= 1 ? Math.round(res / aspect) : res;
            const url = this.stage.snapshot(w, hh);
            downloadDataUrl(`${safeFilename(this.store.design.name)}.png`, url);
            toast(`PNG ${w}×${hh} opgeslagen`);
          },
        },
        '⤓ Exporteer PNG',
      ),
      h('p', { class: 'muted', style: 'margin:0' }, 'Sleep om te schuiven, scroll of knijp om te zoomen. Esc sluit.'),
    );
    document.body.append(panel);
    this.photoCleanup = () => {
      panel.remove();
      frameEl.remove();
      window.removeEventListener('resize', updateFrame);
    };
    window.addEventListener('resize', updateFrame);
    setTimeout(() => {
      this.frameAll();
      syncSliders();
      updateFrame();
    }, 60);
  }
  private photoCleanup: (() => void) | null = null;

  exitPhoto() {
    if (!this.photo) return;
    this.photo = false;
    document.body.classList.remove('photo');
    this.photoCleanup?.();
    this.photoCleanup = null;
    this.controller.viewOnly = false;
    this.stage.grid.visible = true;
    if (this.stage.mode === 'free') this.setView('iso');
    setTimeout(() => this.frameAll(), 60);
  }

  /* ================================================================== opdrachten */

  openMissions() {
    const best = loadStars();
    const list = h('div', { class: 'mission-list' });
    let close = () => {};
    for (const m of MISSIONS) {
      list.append(
        h(
          'div',
          { class: 'mcard' },
          h('div', { class: 'top' }, h('span', { class: 'emoji' }, m.icon), h('div', { style: 'flex:1' }, h('b', null, m.title), h('div', null, stars(best[m.id] ?? 0)))),
          h('div', { class: 'muted' }, m.brief),
          h(
            'div',
            { style: 'display:flex;gap:6px;margin-top:4px' },
            h('button', { class: 'btn primary', onclick: () => (close(), this.startMission(m, true)) }, 'Begin leeg'),
            h('button', { class: 'btn', onclick: () => (close(), this.startMission(m, false)) }, 'Met huidig ontwerp'),
          ),
        ),
      );
    }
    const body = h('div', null, h('p', { class: 'muted', style: 'margin-top:0' }, 'Kies een opdracht. Voldoe aan alle eisen voor ★, en haal de bonuseisen voor ★★★. Je voortgang zie je live linksboven.'), list);
    close = modal('Opdrachten', body);
  }

  async startMission(m: Mission, fresh: boolean) {
    if (fresh) {
      if (this.store.dirty && !(await ask('Leeg beginnen? Niet-opgeslagen wijzigingen gaan verloren.', 'Leeg beginnen'))) return;
      const d = emptyDesign(m.title);
      this.store.load(d);
    }
    this.mission = m;
    this.updateHud();
  }

  updateHud() {
    const m = this.mission;
    if (!m) {
      this.hud.style.display = 'none';
      return;
    }
    this.hud.style.display = '';
    clear(this.hud);
    const r = evaluate(m, this.store.design);
    this.hud.append(
      h('div', { class: 'h' }, h('span', null, `${m.icon} ${m.title}`), stars(r.stars)),
      h('p', null, m.brief),
      ...r.checks.map((c) => h('div', { class: `check${c.ok ? ' ok' : ''}` }, h('span', { class: 'b' }, c.ok ? '✓' : ''), h('span', null, c.label, c.bonus ? h('span', { class: 'tag' }, 'bonus') : null))),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => this.submitMission() }, 'Inleveren'),
        h('button', { class: 'btn', onclick: () => ((this.mission = null), this.updateHud()) }, 'Stoppen'),
      ),
    );
  }

  submitMission() {
    const m = this.mission;
    if (!m) return;
    const r = evaluate(m, this.store.design);
    const best = loadStars();
    const prev = best[m.id] ?? 0;
    if (r.stars > prev) {
      best[m.id] = r.stars;
      saveStars(best);
    }
    const msg =
      r.stars === 0 ? 'Nog niet alle eisen gehaald. Bekijk de lijst en probeer het nog eens!' : r.stars === 3 ? 'Perfect! Alle eisen én bonussen gehaald.' : r.stars === 2 ? 'Heel goed! Nog één bonus voor de volle score.' : 'Opdracht gehaald! Probeer de bonuseisen voor meer sterren.';
    const body = h(
      'div',
      { style: 'text-align:center' },
      h('div', { class: 'big-stars' }, stars(r.stars)),
      h('p', null, msg),
      r.stars > prev && prev > 0 ? h('p', { class: 'muted' }, `Nieuw record (was ${prev} ★)`) : null,
      h('div', { style: 'display:flex;gap:8px;justify-content:center;margin-top:12px' }, h('button', { class: 'btn', onclick: () => close() }, 'Verder bouwen'), h('button', { class: 'btn primary', onclick: () => (close(), this.openMissions()) }, 'Andere opdracht')),
    );
    const close = modal(m.title, body, { small: true });
  }

  openHelp() {
    const rows: [string, string][] = [
      ['Linksklik / tik', 'Plaatsen'],
      ['Rechtsklik / Gum (G)', 'Verwijderen'],
      ['Slepen', 'Schuiven'],
      ['Scroll / knijpen', 'Zoomen'],
      ['R', 'Element draaien of links/midden/rechts'],
      ['Q / E', 'Camera 90° draaien'],
      ['V', 'Iso ↔ vooraanzicht'],
      ['F', 'Alles in beeld'],
      ['1 – 7', 'Categorie kiezen'],
      ['Ctrl+Z / Ctrl+Y', 'Ongedaan maken / opnieuw'],
      ['Ctrl+S', 'Opslaan in galerij'],
      ['P', 'Fotomodus'],
    ];
    const body = h('div', null, ...rows.map(([k, v]) => h('div', { class: 'row', style: 'margin-top:6px' }, h('label', { class: 'lbl' }, v), h('b', null, k))));
    body.append(h('p', { class: 'muted', style: 'margin-top:14px' }, 'Nieuwe ramen, deuren of paletten toevoegen? Zie src/catalog/catalog.ts — alles is data.'));
    modal('Sneltoetsen', body, { small: true });
  }
}

