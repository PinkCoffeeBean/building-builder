import * as THREE from 'three';
import {
  def,
  isFacadeDef,
  type AnyDef,
  type ChimneyDef,
  type EnvDef,
  type FacadeDef,
  type PaintDef,
  type RoofDef,
  type VolumeDef,
} from '../catalog/catalog';
import {
  CellMap,
  DIR_RIGHT,
  DIR_VEC,
  FL,
  cellBottom,
  cellCenterX,
  cellCenterZ,
  cellTop,
  key,
  uid,
} from '../core/grid';
import { checkCell, checkEnv, checkFacade, checkRoofItem, coveredCells } from '../core/rules';
import type { Store } from '../core/store';
import type { Cell, CladdingId, Design, Dir, EnvItem, FaceDir, FacadeItem, RoofItem } from '../core/types';
import { buildChimney, buildEnvItem } from '../render/builders/env';
import { placeFacade, wallKey } from '../render/buildDesign';
import { roofExtra } from '../render/builders/roof';
import { clay } from '../render/materials';
import { rbox } from '../render/shapes';
import type { Stage } from '../render/stage';

export interface ToolState {
  defId: string;
  colors: Record<string, { color: string; accent: string }>;
  align: number;
  rot: number;
  text: string;
  eraser: boolean;
  paintCladding: CladdingId | 'keep';
  paintTarget: 'main' | 'accent';
}

interface Hit {
  kind: 'volume' | 'roof' | 'facade' | 'env' | 'roofItem' | 'ground';
  id?: string;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  cell?: Cell;
  dir?: FaceDir;
  obj?: THREE.Object3D;
}

interface Plan {
  key: string;
  valid: boolean;
  reason?: string;
  hint?: string;
  ghost: () => THREE.Object3D | null;
  apply: () => void;
}

export interface ControllerCallbacks {
  status: (msg: string, kind?: 'info' | 'error' | 'ok') => void;
  picked: (color: string) => void;
  toolChanged: () => void;
}

const HDIRS: Dir[] = ['px', 'nx', 'pz', 'nz'];

export class Controller {
  tool: ToolState;
  ghost: THREE.Object3D | null = null;
  ghostKey = '';
  built: THREE.Group | null = null;
  enabled = true;
  /** Fotomodus: alleen schuiven en zoomen. */
  viewOnly = false;

  private raycaster = new THREE.Raycaster();
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; button: number; moved: boolean; pointerType: string } | null = null;
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private wasPinch = false;
  private lastHover: { x: number; y: number } | null = null;
  private ghostMats = new Map<string, THREE.Material>();
  private redMat = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.45, depthWrite: false });

  constructor(
    public stage: Stage,
    public store: Store,
    public cb: ControllerCallbacks,
  ) {
    this.tool = {
      defId: 'block-stucco',
      colors: {},
      align: 0,
      rot: 0,
      text: '',
      eraser: false,
      paintCladding: 'keep',
      paintTarget: 'main',
    };
    const el = stage.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onCancel(e));
    el.addEventListener('pointerleave', () => {
      if (!this.down) this.clearGhost();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  get def(): AnyDef {
    return def(this.tool.defId);
  }

  colorsFor(d: AnyDef = this.def) {
    return this.tool.colors[d.id] ?? { color: d.color, accent: d.accent };
  }

  setColors(color?: string, accent?: string, d: AnyDef = this.def) {
    const cur = this.colorsFor(d);
    this.tool.colors[d.id] = { color: color ?? cur.color, accent: accent ?? cur.accent };
    this.refresh();
  }

  setTool(id: string) {
    this.tool.defId = id;
    this.tool.align = 0;
    const d = this.def;
    if (d.kind === 'sign' && !this.tool.text) this.tool.text = d.defaultText;
    if (d.kind === 'sign') this.tool.text = d.defaultText;
    this.ghostKey = '';
    this.refresh();
    this.cb.toolChanged();
  }

  /** R: roteren / uitlijning wisselen. */
  rotateTool() {
    const d = this.def;
    if (isFacadeDef(d)) {
      this.tool.align = this.tool.align === 0 ? 1 : this.tool.align === 1 ? -1 : 0;
      this.cb.status(`Uitlijning: ${this.tool.align === 0 ? 'midden' : this.tool.align < 0 ? 'links' : 'rechts'}`);
    } else {
      this.tool.rot = (this.tool.rot + 1) % 4;
      this.cb.status(`Draaiing: ${this.tool.rot * 90}°`);
    }
    this.ghostKey = '';
    this.refresh();
  }

  /* ================================================================ invoer */

  private ndc(x: number, y: number) {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private onDown(e: PointerEvent) {
    if (!this.enabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, pointerType: e.pointerType };
      this.wasPinch = false;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      this.wasPinch = true;
      this.clearGhost();
    }
  }

  private onMove(e: PointerEvent) {
    if (!this.enabled) return;
    const prev = this.pointers.get(e.pointerId);
    if (prev) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (this.pinch.dist > 0) this.stage.setZoom(this.stage.zoom * (dist / this.pinch.dist));
        this.stage.pan(mx - this.pinch.mx, my - this.pinch.my);
        this.pinch = { dist, mx, my };
        return;
      }
      if (this.down) {
        if (!this.down.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) {
          this.down.moved = true;
          this.clearGhost();
        }
        if (this.down.moved) this.stage.pan(dx, dy);
        return;
      }
    }
    if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent) {
    if (!this.enabled) return;
    const d = this.down;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;
    this.down = null;
    if (!d || d.moved || this.wasPinch) {
      if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY);
      return;
    }
    const erase = d.button === 2 || this.tool.eraser;
    if (d.button === 1 || this.viewOnly) return;
    this.click(e.clientX, e.clientY, erase);
    if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY);
    else this.clearGhost();
  }

  private onCancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.down = null;
    this.pinch = null;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    this.stage.setZoom(this.stage.zoom * f);
    if (this.lastHover) this.hover(this.lastHover.x, this.lastHover.y);
  }

  /** Ghost opnieuw berekenen voor de laatste muispositie (na wijziging of gereedschapwissel). */
  refresh() {
    this.ghostKey = '';
    if (this.lastHover) this.hover(this.lastHover.x, this.lastHover.y);
    else this.clearGhost();
  }

  private hover(x: number, y: number) {
    this.lastHover = { x, y };
    if (this.viewOnly) return;
    const hit = this.pick(x, y);
    const plan = this.plan(hit, this.tool.eraser);
    if (!plan) {
      this.clearGhost();
      return;
    }
    if (plan.key !== this.ghostKey) {
      this.clearGhost();
      const g = plan.ghost();
      if (g) {
        this.ghostify(g, plan.valid);
        this.stage.overlayScene.add(g);
        this.ghost = g;
      }
      this.ghostKey = plan.key;
      if (!plan.valid && plan.reason) this.cb.status(plan.reason, 'error');
      else if (plan.hint) this.cb.status(plan.hint);
      this.stage.invalidate();
    }
  }

  private click(x: number, y: number, erase: boolean) {
    const hit = this.pick(x, y);
    const plan = this.plan(hit, erase);
    if (!plan) return;
    if (!plan.valid) {
      this.cb.status(plan.reason ?? 'Kan hier niet', 'error');
      return;
    }
    plan.apply();
    this.ghostKey = '';
  }

  clearGhost() {
    if (this.ghost) {
      this.stage.overlayScene.remove(this.ghost);
      this.ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      });
      this.ghost = null;
      this.stage.invalidate();
    }
    this.ghostKey = '';
  }

  private ghostify(obj: THREE.Object3D, valid: boolean) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.LineSegments).isLineSegments) return;
      m.castShadow = false;
      m.receiveShadow = false;
      if ((o as THREE.LineSegments).isLineSegments) {
        if (!valid) (o as THREE.LineSegments).material = new THREE.LineBasicMaterial({ color: '#ff3b3b' });
        return;
      }
      if (!valid) {
        m.material = this.redMat;
        return;
      }
      const src = m.material as THREE.Material;
      let gm = this.ghostMats.get(src.uuid);
      if (!gm) {
        gm = src.clone();
        gm.transparent = true;
        gm.opacity = Math.min(0.7, (src.opacity ?? 1) * 0.7);
        gm.depthWrite = true;
        this.ghostMats.set(src.uuid, gm);
      }
      m.material = gm;
    });
    obj.renderOrder = 10;
  }

  /* ================================================================ raycast */

  private pick(x: number, y: number): Hit | null {
    if (!this.built) return null;
    const design = this.store.design;
    this.raycaster.setFromCamera(this.ndc(x, y), this.stage.camera);
    const hits = this.raycaster.intersectObject(this.built, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      const kind = o.userData.kind as Hit['kind'];
      const n = (h.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone().transformDirection(h.object.matrixWorld);
      const snapped = snapNormal(n);
      if (kind === 'volume') {
        const res = this.cellFromVolumeHit(h.point, snapped);
        if (!res) continue;
        return { kind, point: h.point, normal: snapped, cell: res.cell, dir: res.dir, obj: o };
      }
      if (kind === 'roof') {
        const cell = this.topCellAt(h.point);
        if (!cell) continue;
        return { kind, point: h.point, normal: snapped, cell, dir: 'py', obj: o };
      }
      if (kind === 'facade') {
        const it = design.facade.find((f) => f.id === o!.userData.id);
        if (!it) continue;
        const cell = this.cellUnderFacadePoint(it, h.point);
        return { kind, id: it.id, point: h.point, normal: snapped, cell, dir: it.dir, obj: o };
      }
      if (kind === 'env' || kind === 'roofItem') return { kind, id: o.userData.id, point: h.point, normal: snapped, obj: o };
      if (kind === 'ground') return this.groundHit() ?? null;
    }
    return this.groundHit();
  }

  private groundHit(): Hit | null {
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    const d = this.store.design;
    if (Math.abs(p.x) > d.plot.w / 2 + 1.2 || Math.abs(p.z) > d.plot.d / 2 + 1.2) return null;
    return { kind: 'ground', point: p, normal: new THREE.Vector3(0, 1, 0) };
  }

  private cellIndex(p: THREE.Vector3) {
    const d = this.store.design;
    return {
      x: Math.floor(p.x + d.plot.w / 2),
      y: p.y < FL + 1 ? 0 : Math.floor(p.y - FL),
      z: Math.floor(p.z + d.plot.d / 2),
    };
  }

  private cellFromVolumeHit(p: THREE.Vector3, n: THREE.Vector3): { cell: Cell; dir: FaceDir } | null {
    const cm = new CellMap(this.store.design);
    const dir = normalToDir(n);
    // iets naar binnen stappen langs de normaal
    for (const depth of [0.02, 0.06, 0.12]) {
      const q = p.clone().addScaledVector(n, -depth);
      const i = this.cellIndex(q);
      const c = cm.get(i.x, i.y, i.z);
      if (c) return { cell: c, dir };
    }
    return null;
  }

  private topCellAt(p: THREE.Vector3): Cell | null {
    const design = this.store.design;
    const cm = new CellMap(design);
    const tryCol = (q: THREE.Vector3) => {
      const i = this.cellIndex(q);
      let best: Cell | null = null;
      for (const c of design.cells) {
        if (c.x !== i.x || c.z !== i.z || !cm.isTop(c)) continue;
        if (cellTop(c.y) <= q.y + 0.7 && (!best || c.y > best.y)) best = c;
      }
      return best;
    };
    const direct = tryCol(p);
    if (direct) return direct;
    for (const [dx, dz] of [
      [0.08, 0],
      [-0.08, 0],
      [0, 0.08],
      [0, -0.08],
    ]) {
      const c = tryCol(p.clone().add(new THREE.Vector3(dx, 0, dz)));
      if (c) return c;
    }
    return null;
  }

  private cellUnderFacadePoint(it: FacadeItem, p: THREE.Vector3): Cell | undefined {
    const design = this.store.design;
    const cm = new CellMap(design);
    const d = def(it.type) as FacadeDef;
    const cells = coveredCells(d, it);
    const i = this.cellIndex(p);
    const along = it.dir === 'px' || it.dir === 'nx' ? 'z' : 'x';
    const match = cells.find((c) => c.y === i.y && c[along] === i[along]) ?? cells.find((c) => c.y === i.y) ?? cells[0];
    return cm.get(match.x, match.y, match.z);
  }

  /* ================================================================ plannen */

  private plan(hit: Hit | null, erase: boolean): Plan | null {
    if (!hit) return null;
    if (erase) return this.erasePlan(hit);
    const d = this.def;
    switch (d.kind) {
      case 'volume':
        return this.volumePlan(hit, d);
      case 'roof':
        return this.roofPlan(hit, d);
      case 'chimney':
        return this.chimneyPlan(hit, d);
      case 'env':
        return this.envPlan(d);
      case 'paint':
        return this.paintPlan(hit, d);
      default:
        if (isFacadeDef(d)) return this.facadePlan(hit, d);
        return null;
    }
  }

  private commit(fn: (d: Design) => void, msg?: string) {
    this.store.commit(fn);
    if (msg) this.cb.status(msg, 'ok');
  }

  private volumePlan(hit: Hit, d: VolumeDef): Plan | null {
    const design = this.store.design;
    const cm = new CellMap(design);
    let t: { x: number; y: number; z: number };
    if (hit.kind === 'ground') {
      const i = this.cellIndex(hit.point);
      t = { x: i.x, y: 0, z: i.z };
    } else if (hit.cell && hit.dir) {
      const v = DIR_VEC[hit.dir];
      t = { x: hit.cell.x + v[0], y: hit.cell.y + v[1], z: hit.cell.z + v[2] };
    } else return null;
    const reason = checkCell(design, cm, t.x, t.y, t.z);
    const { color } = this.colorsFor(d);
    return {
      key: `vol|${key(t.x, t.y, t.z)}|${!reason}|${color}`,
      valid: !reason,
      reason: reason ?? undefined,
      hint: 'Klik om een blok te plaatsen · rechtsklik verwijdert',
      ghost: () => this.cellGhost(design, [t], color),
      apply: () =>
        this.commit((ds) => {
          const cmm = new CellMap(ds);
          const below = cmm.get(t.x, t.y - 1, t.z);
          let roof = below?.roof;
          if (!roof)
            for (const dir of HDIRS) {
              const n = cmm.neighbor(t, dir);
              if (n?.roof && cmm.isTop(n)) {
                roof = n.roof;
                break;
              }
            }
          ds.cells.push({ x: t.x, y: t.y, z: t.z, color, cladding: d.cladding, ...(roof ? { roof: { ...roof } } : {}) });
        }),
    };
  }

  private erasePlan(hit: Hit): Plan | null {
    const design = this.store.design;
    if (hit.kind === 'facade' || hit.kind === 'env' || hit.kind === 'roofItem') {
      const id = hit.id!;
      return {
        key: `erase|${id}`,
        valid: true,
        hint: 'Klik om dit element te verwijderen',
        ghost: () => this.boxGhostAround(hit.obj!),
        apply: () =>
          this.commit((ds) => {
            ds.facade = ds.facade.filter((f) => f.id !== id);
            ds.env = ds.env.filter((f) => f.id !== id);
            ds.roofItems = ds.roofItems.filter((f) => f.id !== id);
          }, 'Verwijderd'),
      };
    }
    if ((hit.kind === 'volume' || hit.kind === 'roof') && hit.cell) {
      const c = hit.cell;
      if (this.def.category !== 'volumes')
        return {
          key: `erase-no|${key(c.x, c.y, c.z)}`,
          valid: false,
          reason: 'Blokken verwijder je met het gereedschap Volumes',
          ghost: () => null,
          apply: () => {},
        };
      return {
        key: `erase|${key(c.x, c.y, c.z)}`,
        valid: true,
        hint: 'Klik om dit blok te verwijderen',
        ghost: () => this.cellGhost(design, [c], '#ff3b3b', 1.02),
        apply: () => this.commit((ds) => (ds.cells = ds.cells.filter((q) => !(q.x === c.x && q.y === c.y && q.z === c.z)))),
      };
    }
    return null;
  }

  private facadePlan(hit: Hit, d: FacadeDef): Plan | null {
    // bestaand gevelbord aanklikken met het bordgereedschap = tekst en kleuren aanpassen
    if (d.kind === 'sign' && hit.kind === 'facade') {
      const it = this.store.design.facade.find((f) => f.id === hit.id);
      if (it && def(it.type).kind === 'sign') {
        const { color, accent } = this.colorsFor(d);
        const text = this.tool.text || d.defaultText;
        return {
          key: `sign-edit|${it.id}|${text}|${color}|${accent}`,
          valid: true,
          hint: `Klik om dit bord “${text}” te geven`,
          ghost: () => this.boxGhostAround(hit.obj!, color),
          apply: () =>
            this.commit((ds) => {
              const f = ds.facade.find((q) => q.id === it.id);
              if (f) Object.assign(f, { text, color, accent });
            }, 'Gevelbord aangepast'),
        };
      }
    }
    if (!hit.cell || !hit.dir || hit.dir === 'py' || hit.dir === 'ny') {
      if (hit.kind === 'volume' || hit.kind === 'roof') return { key: 'face-no', valid: false, reason: 'Kies een gevelvlak (zijkant van een blok)', ghost: () => null, apply: () => {} };
      return null;
    }
    const design = this.store.design;
    const cm = new CellMap(design);
    const { color, accent } = this.colorsFor(d);
    const dir = hit.dir as Dir;
    let anchor = { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z };
    // brede elementen: kies een anker zodat het element zo goed mogelijk past
    if (d.span[0] > 1 || d.span[1] > 1) {
      const r = DIR_RIGHT[dir];
      const options: { x: number; y: number; z: number }[] = [];
      for (let j = 0; j < d.span[1]; j++)
        for (let i = 0; i < d.span[0]; i++) options.push({ x: hit.cell.x - r[0] * i, y: hit.cell.y - j, z: hit.cell.z - r[2] * i });
      const ok = options.find((o) => o.y >= 0 && !checkFacade(design, cm, d, { ...o, dir, id: '', type: d.id, align: this.tool.align, color, accent }));
      if (ok) anchor = ok;
    }
    const item: FacadeItem = {
      id: uid('f'),
      type: d.id,
      ...anchor,
      dir,
      align: this.tool.align,
      color,
      accent,
      ...(d.kind === 'sign' ? { text: this.tool.text || d.defaultText } : {}),
    };
    const reason = checkFacade(design, cm, d, item);
    const anchorCell = cm.get(anchor.x, anchor.y, anchor.z) ?? hit.cell;
    return {
      key: `fac|${d.id}|${key(anchor.x, anchor.y, anchor.z)}|${dir}|${item.align}|${color}|${accent}|${item.text ?? ''}|${!reason}`,
      valid: !reason,
      reason: reason ?? undefined,
      hint: 'Klik om te plaatsen · R wisselt links/midden/rechts',
      ghost: () => placeFacade(design, d, item, clay(anchorCell.color)),
      apply: () => this.commit((ds) => ds.facade.push(item)),
    };
  }

  /** Aaneengesloten dakvlak op dezelfde hoogte. */
  private roofRegion(design: Design, start: Cell): Cell[] {
    const cm = new CellMap(design);
    const out: Cell[] = [];
    const seen = new Set<string>([key(start.x, start.y, start.z)]);
    const stack = [start];
    while (stack.length) {
      const c = stack.pop()!;
      out.push(c);
      for (const dir of HDIRS) {
        const n = cm.neighbor(c, dir);
        if (!n || !cm.isTop(n)) continue;
        const k = key(n.x, n.y, n.z);
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push(n);
      }
    }
    return out;
  }

  private roofPlan(hit: Hit, d: RoofDef): Plan | null {
    if (!hit.cell || (hit.kind !== 'roof' && hit.dir !== 'py')) {
      if (hit.kind === 'volume') return { key: 'roof-no', valid: false, reason: 'Wijs een dak aan (bovenkant van een blok)', ghost: () => null, apply: () => {} };
      return null;
    }
    const design = this.store.design;
    const region = this.roofRegion(design, hit.cell);
    const { color, accent } = this.colorsFor(d);
    const rot = this.tool.rot;
    return {
      key: `roof|${d.id}|${region.map((c) => key(c.x, c.y, c.z)).join(';')}|${color}|${accent}|${rot}`,
      valid: true,
      hint: d.style === 'shed' ? 'Klik om dit dak te zetten · R draait de helling' : 'Klik om dit dak toe te passen',
      ghost: () => {
        const g = new THREE.Group();
        const m = clay(color);
        for (const c of region) {
          const mesh = new THREE.Mesh(rbox(1.04, 0.06, 1.04, 0.02), m);
          mesh.position.set(cellCenterX(c.x, design.plot.w), cellTop(c.y) + 0.06, cellCenterZ(c.z, design.plot.d));
          g.add(mesh);
        }
        return g;
      },
      apply: () =>
        this.commit((ds) => {
          const keys = new Set(region.map((c) => key(c.x, c.y, c.z)));
          for (const c of ds.cells) if (keys.has(key(c.x, c.y, c.z))) c.roof = { type: d.id, color, accent, rot };
        }, `Dak: ${d.name}`),
    };
  }

  private chimneyPlan(hit: Hit, d: ChimneyDef): Plan | null {
    if (!hit.cell || (hit.kind !== 'roof' && hit.dir !== 'py')) return null;
    const design = this.store.design;
    const cm = new CellMap(design);
    const c = hit.cell;
    const cx = cellCenterX(c.x, design.plot.w);
    const cz = cellCenterZ(c.z, design.plot.d);
    const snap = (v: number) => Math.max(-0.3, Math.min(0.3, Math.round(v / 0.15) * 0.15));
    const ox = snap(hit.point.x - cx);
    const oz = snap(hit.point.z - cz);
    const { color } = this.colorsFor(d);
    const reason = checkRoofItem(cm, c, design);
    const item: RoofItem = { id: uid('r'), type: d.id, x: c.x, y: c.y, z: c.z, ox, oz, color };
    return {
      key: `chim|${key(c.x, c.y, c.z)}|${ox}|${oz}|${color}|${!reason}`,
      valid: !reason,
      reason: reason ?? undefined,
      hint: 'Klik om een schoorsteen te plaatsen',
      ghost: () => {
        const g = buildChimney(d, color, roofExtra(c));
        g.position.set(cx + ox, cellTop(c.y), cz + oz);
        return g;
      },
      apply: () => this.commit((ds) => ds.roofItems.push(item)),
    };
  }

  private envPlan(d: EnvDef): Plan | null {
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    const design = this.store.design;
    const cm = new CellMap(design);
    const snap = (v: number) => Math.round(v / 0.05) * 0.05;
    const x = snap(p.x);
    const z = snap(p.z);
    const reason = checkEnv(design, cm, d, x, z);
    const { color, accent } = this.colorsFor(d);
    const item: EnvItem = { id: uid('e'), type: d.id, x, z, rot: this.tool.rot, color, accent };
    return {
      key: `env|${d.id}|${x}|${z}|${item.rot}|${color}|${accent}|${!reason}`,
      valid: !reason,
      reason: reason ?? undefined,
      hint: 'Klik om te plaatsen · R draait',
      ghost: () => {
        const g = buildEnvItem(d, item);
        g.position.set(x, 0, z);
        g.rotation.y = (item.rot * Math.PI) / 2;
        return g;
      },
      apply: () => this.commit((ds) => ds.env.push(item)),
    };
  }

  private paintPlan(hit: Hit, d: PaintDef): Plan | null {
    const design = this.store.design;
    const { color } = this.colorsFor(d);
    const clad = this.tool.paintCladding;
    const target = this.tool.paintTarget;

    if (d.mode === 'pick') {
      let picked: string | null = null;
      if (hit.kind === 'facade') {
        const it = design.facade.find((f) => f.id === hit.id);
        picked = it ? (target === 'accent' ? it.accent : it.color) : null;
      } else if (hit.kind === 'env') {
        const it = design.env.find((f) => f.id === hit.id);
        picked = it ? (target === 'accent' ? it.accent : it.color) : null;
      } else if (hit.kind === 'roofItem') picked = design.roofItems.find((f) => f.id === hit.id)?.color ?? null;
      else if (hit.kind === 'roof' && hit.cell) picked = hit.cell.roof?.color ?? null;
      else if (hit.kind === 'volume' && hit.cell && hit.dir) picked = wallKey(hit.cell, hit.dir).split('|')[1];
      else if (hit.kind === 'ground') picked = design.settings.base;
      if (!picked) return null;
      const col = picked;
      return {
        key: `pick|${col}|${hit.kind}|${hit.id ?? ''}`,
        valid: true,
        hint: `Pipet: ${col} — klik om over te nemen`,
        ghost: () => null,
        apply: () => this.cb.picked(col),
      };
    }

    // elementen verven
    if (hit.kind === 'facade' || hit.kind === 'env' || hit.kind === 'roofItem') {
      const id = hit.id!;
      return {
        key: `paint-item|${id}|${color}|${target}`,
        valid: true,
        hint: `Klik om dit element te verven (${target === 'main' ? 'hoofdkleur' : 'accentkleur'})`,
        ghost: () => this.boxGhostAround(hit.obj!, color),
        apply: () =>
          this.commit((ds) => {
            for (const list of [ds.facade, ds.env] as (FacadeItem | EnvItem)[][]) {
              const it = list.find((f) => f.id === id);
              if (it) {
                if (target === 'accent') it.accent = color;
                else it.color = color;
              }
            }
            const r = ds.roofItems.find((f) => f.id === id);
            if (r) r.color = color;
          }),
      };
    }
    if (hit.kind === 'roof' && hit.cell) {
      const region = this.roofRegion(design, hit.cell);
      return {
        key: `paint-roof|${key(hit.cell.x, hit.cell.y, hit.cell.z)}|${color}|${target}`,
        valid: true,
        hint: `Klik om het dak te verven (${target === 'main' ? 'dakrand' : 'dakbedekking'})`,
        ghost: () => this.cellGhost(design, region, color, 1.01),
        apply: () =>
          this.commit((ds) => {
            const keys = new Set(region.map((c) => key(c.x, c.y, c.z)));
            for (const c of ds.cells)
              if (keys.has(key(c.x, c.y, c.z))) {
                const r = c.roof ?? { type: 'roof-parapet', color: '#2d3036', accent: '#9a9a96' };
                c.roof = target === 'accent' ? { ...r, accent: color } : { ...r, color };
              }
          }),
      };
    }
    if (hit.kind === 'ground') {
      return {
        key: `paint-base|${color}`,
        valid: true,
        hint: 'Klik om de sokkel te verven',
        ghost: () => null,
        apply: () => this.commit((ds) => (ds.settings.base = color)),
      };
    }
    if (hit.kind !== 'volume' || !hit.cell || !hit.dir) return null;
    const c = hit.cell;
    const dir = hit.dir;
    let cells: Cell[] = [c];
    if (d.mode === 'volume') {
      const cm = new CellMap(design);
      const gk = `${c.cladding}|${c.color}`;
      const seen = new Set([key(c.x, c.y, c.z)]);
      const stack = [c];
      cells = [];
      while (stack.length) {
        const q = stack.pop()!;
        cells.push(q);
        for (const fd of ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as FaceDir[]) {
          const n = cm.neighbor(q, fd);
          if (!n || `${n.cladding}|${n.color}` !== gk) continue;
          const k = key(n.x, n.y, n.z);
          if (seen.has(k)) continue;
          seen.add(k);
          stack.push(n);
        }
      }
    }
    const keys = new Set(cells.map((q) => key(q.x, q.y, q.z)));
    if (d.mode === 'face') {
      return {
        key: `paint-face|${key(c.x, c.y, c.z)}|${dir}|${color}|${clad}`,
        valid: true,
        hint: 'Klik om dit gevelvlak te verven',
        ghost: () => this.faceGhost(design, c, dir, color),
        apply: () =>
          this.commit((ds) => {
            const cc = ds.cells.find((q) => q.x === c.x && q.y === c.y && q.z === c.z);
            if (!cc) return;
            cc.faces ??= {};
            cc.faces[dir] = { color, ...(clad !== 'keep' ? { cladding: clad } : cc.faces[dir]?.cladding ? { cladding: cc.faces[dir]!.cladding } : {}) };
          }),
      };
    }
    return {
      key: `paint|${d.mode}|${[...keys].join(';')}|${color}|${clad}`,
      valid: true,
      hint: d.mode === 'volume' ? 'Klik om het hele volume te verven' : 'Klik om dit blok te verven',
      ghost: () => this.cellGhost(design, cells, color, 1.015),
      apply: () =>
        this.commit((ds) => {
          for (const q of ds.cells)
            if (keys.has(key(q.x, q.y, q.z))) {
              q.color = color;
              if (clad !== 'keep') q.cladding = clad;
              delete q.faces;
            }
        }),
    };
  }

  /* ================================================================ ghosts */

  private cellGhost(design: Design, cells: { x: number; y: number; z: number }[], color: string, scale = 1) {
    const g = new THREE.Group();
    const mat = clay(color);
    for (const c of cells) {
      const h = cellTop(c.y) - cellBottom(c.y);
      const geo = rbox(scale, h * (scale === 1 ? 1 : scale), scale, 0.035);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cellCenterX(c.x, design.plot.w), cellBottom(c.y) + h / 2, cellCenterZ(c.z, design.plot.d));
      g.add(m);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(scale * 1.002, h * 1.002, scale * 1.002)), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
      edges.position.copy(m.position);
      g.add(edges);
    }
    return g;
  }

  private faceGhost(design: Design, c: Cell, dir: FaceDir, color: string) {
    const h = cellTop(c.y) - cellBottom(c.y);
    const v = DIR_VEC[dir];
    const g = new THREE.Group();
    const sx = v[0] !== 0 ? 0.03 : 1.0;
    const sy = v[1] !== 0 ? 0.03 : h;
    const sz = v[2] !== 0 ? 0.03 : 1.0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), clay(color));
    m.position.set(
      cellCenterX(c.x, design.plot.w) + v[0] * 0.5,
      (v[1] > 0 ? cellTop(c.y) : cellBottom(c.y) + h / 2),
      cellCenterZ(c.z, design.plot.d) + v[2] * 0.5,
    );
    g.add(m);
    return g;
  }

  private boxGhostAround(obj: THREE.Object3D, color?: string) {
    const box = new THREE.Box3().setFromObject(obj);
    box.expandByScalar(0.02);
    const size = box.getSize(new THREE.Vector3());
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), color ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }) : this.redMat);
    box.getCenter(m.position);
    g.add(m);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: color ?? '#ff3b3b' }));
    edges.position.copy(m.position);
    g.add(edges);
    return g;
  }
}

function snapNormal(n: THREE.Vector3) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(n.x), 0, 0);
  if (ay >= az) return new THREE.Vector3(0, Math.sign(n.y), 0);
  return new THREE.Vector3(0, 0, Math.sign(n.z));
}

function normalToDir(n: THREE.Vector3): FaceDir {
  if (n.x > 0.5) return 'px';
  if (n.x < -0.5) return 'nx';
  if (n.y > 0.5) return 'py';
  if (n.y < -0.5) return 'ny';
  if (n.z > 0.5) return 'pz';
  return 'nz';
}
