import * as THREE from 'three';
import type { CladdingId } from '../core/types';

/**
 * Matte "clay"-materialen. Elke bekleding heeft een grijswaarde-textuur (map, vermenigvuldigd
 * met de kleur) en een bumpmap, beide procedureel getekend op een canvas. UV's zijn in
 * wereldeenheden, dus 1 textuur = 1 cel (≈3 m) en patronen lopen door over blokken heen.
 */

type TexPair = { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; bumpScale: number; roughness: number };

const SIZE = 512;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

function noise(ctx: CanvasRenderingContext2D, amount: number, seed: number, base = 128) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, (base === -1 ? img.data[i] : base) + n));
    img.data[i + 1] = Math.max(0, Math.min(255, (base === -1 ? img.data[i + 1] : base) + n));
    img.data[i + 2] = Math.max(0, Math.min(255, (base === -1 ? img.data[i + 2] : base) + n));
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function toTex(c: HTMLCanvasElement, color: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function draw(fnMap: (ctx: CanvasRenderingContext2D) => void, fnBump: (ctx: CanvasRenderingContext2D) => void) {
  const a = canvas();
  const b = canvas();
  fnMap(a.getContext('2d', { willReadFrequently: true })!);
  fnBump(b.getContext('2d', { willReadFrequently: true })!);
  return { map: toTex(a, true), bump: toTex(b, false) };
}

const texCache = new Map<CladdingId, TexPair>();

function claddingTextures(id: CladdingId): TexPair {
  const hit = texCache.get(id);
  if (hit) return hit;
  let res: TexPair;
  switch (id) {
    case 'wood': {
      // Verticale houten latten: 24 latten per cel, met kleine variaties per lat.
      const n = 24;
      const w = SIZE / n;
      const r = rng(7);
      const shades = Array.from({ length: n }, () => 205 + r() * 50);
      const { map, bump } = draw(
        (ctx) => {
          for (let i = 0; i < n; i++) {
            const s = shades[i];
            ctx.fillStyle = `rgb(${s},${s},${s})`;
            ctx.fillRect(i * w, 0, w, SIZE);
            // nerf
            for (let k = 0; k < 6; k++) {
              ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`;
              ctx.fillRect(i * w + r() * w, 0, 1 + r() * 1.5, SIZE);
            }
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(i * w, 0, 2.5, SIZE);
          }
        },
        (ctx) => {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, SIZE, SIZE);
          for (let i = 0; i < n; i++) {
            const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
            g.addColorStop(0, '#000');
            g.addColorStop(0.12, '#ddd');
            g.addColorStop(0.5, '#fff');
            g.addColorStop(0.88, '#ddd');
            g.addColorStop(1, '#555');
            ctx.fillStyle = g;
            ctx.fillRect(i * w, 0, w, SIZE);
          }
        },
      );
      res = { map, bump, bumpScale: 3, roughness: 0.82 };
      break;
    }
    case 'stone': {
      // Onregelmatig natuursteen-verband.
      const r = rng(11);
      const rows: { y: number; h: number; stones: { x: number; w: number; s: number }[] }[] = [];
      let y = 0;
      while (y < SIZE) {
        const h = Math.min(SIZE - y, 28 + Math.floor(r() * 30));
        const stones: { x: number; w: number; s: number }[] = [];
        let x = -Math.floor(r() * 40);
        while (x < SIZE) {
          const w = 40 + Math.floor(r() * 70);
          stones.push({ x, w, s: 190 + r() * 60 });
          x += w;
        }
        rows.push({ y, h, stones });
        y += h;
      }
      const paint = (ctx: CanvasRenderingContext2D, bump: boolean) => {
        ctx.fillStyle = bump ? '#000' : '#8c8c8c';
        ctx.fillRect(0, 0, SIZE, SIZE);
        for (const row of rows) {
          for (const st of row.stones) {
            const v = bump ? 235 : st.s;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            const pad = 2.5;
            const x0 = st.x + pad;
            const ww = st.w - pad * 2;
            const yy = row.y + pad;
            const hh = row.h - pad * 2;
            ctx.beginPath();
            ctx.roundRect(x0, yy, ww, hh, 4);
            ctx.fill();
            if (x0 + ww > SIZE) {
              ctx.beginPath();
              ctx.roundRect(x0 - SIZE, yy, ww, hh, 4);
              ctx.fill();
            }
          }
        }
      };
      const { map, bump } = draw(
        (ctx) => {
          paint(ctx, false);
          noise(ctx, 26, 3, -1);
        },
        (ctx) => {
          paint(ctx, true);
          noise(ctx, 40, 5, -1);
        },
      );
      res = { map, bump, bumpScale: 4, roughness: 0.95 };
      break;
    }
    case 'concrete': {
      // Glad beton met bekistingsnaden en ankergaatjes.
      const r = rng(21);
      const { map, bump } = draw(
        (ctx) => {
          noise(ctx, 22, 9, 235);
          for (let i = 0; i < 40; i++) {
            ctx.fillStyle = `rgba(0,0,0,${r() * 0.035})`;
            ctx.beginPath();
            ctx.ellipse(r() * SIZE, r() * SIZE, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(0, SIZE / 2 - 1, SIZE, 2);
          ctx.fillRect(0, 0, SIZE, 2);
          ctx.fillRect(0, 0, 2, SIZE);
          for (const yy of [SIZE / 4, (SIZE * 3) / 4])
            for (const xx of [SIZE / 6, SIZE / 2, (SIZE * 5) / 6]) {
              ctx.fillStyle = 'rgba(0,0,0,0.35)';
              ctx.beginPath();
              ctx.arc(xx, yy, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }
        },
        (ctx) => {
          noise(ctx, 30, 13, 200);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, SIZE / 2 - 1, SIZE, 2);
          ctx.fillRect(0, 0, SIZE, 2);
          ctx.fillRect(0, 0, 2, SIZE);
          for (const yy of [SIZE / 4, (SIZE * 3) / 4])
            for (const xx of [SIZE / 6, SIZE / 2, (SIZE * 5) / 6]) {
              ctx.beginPath();
              ctx.arc(xx, yy, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }
        },
      );
      res = { map, bump, bumpScale: 1.5, roughness: 0.9 };
      break;
    }
    case 'brick': {
      // Halfsteens verband: 12 stenen breed, 32 lagen per cel.
      const cols = 12;
      const rowsN = 32;
      const bw = SIZE / cols;
      const bh = SIZE / rowsN;
      const r = rng(31);
      const paint = (ctx: CanvasRenderingContext2D, bump: boolean) => {
        ctx.fillStyle = bump ? '#000' : '#e8e2d8';
        ctx.fillRect(0, 0, SIZE, SIZE);
        for (let j = 0; j < rowsN; j++) {
          const off = j % 2 ? bw / 2 : 0;
          for (let i = -1; i < cols; i++) {
            const v = bump ? 230 : 175 + r() * 70;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(i * bw + off + 1.5, j * bh + 1.5, bw - 3, bh - 3);
          }
        }
      };
      const { map, bump } = draw(
        (ctx) => {
          paint(ctx, false);
          noise(ctx, 18, 4, -1);
        },
        (ctx) => paint(ctx, true),
      );
      res = { map, bump, bumpScale: 2.5, roughness: 0.93 };
      break;
    }
    case 'tiles': {
      const n = 10;
      const s = SIZE / n;
      const r = rng(41);
      const paint = (ctx: CanvasRenderingContext2D, bump: boolean) => {
        ctx.fillStyle = bump ? '#000' : '#9d9a95';
        ctx.fillRect(0, 0, SIZE, SIZE);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const v = bump ? 230 : 228 + r() * 22;
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
          }
      };
      const { map, bump } = draw(
        (ctx) => paint(ctx, false),
        (ctx) => paint(ctx, true),
      );
      res = { map, bump, bumpScale: 1.5, roughness: 0.85 };
      break;
    }
    case 'stucco':
    default: {
      const { map, bump } = draw(
        (ctx) => noise(ctx, 10, 1, 246),
        (ctx) => noise(ctx, 70, 2, 128),
      );
      res = { map, bump, bumpScale: 0.6, roughness: 0.92 };
    }
  }
  texCache.set(id, res);
  return res;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Materiaal voor een bekleding in een kleur (gecachet). */
export function cladMat(cladding: CladdingId, color: string): THREE.MeshStandardMaterial {
  const k = `${cladding}|${color}`;
  let m = matCache.get(k);
  if (!m) {
    const t = claddingTextures(cladding);
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      map: t.map,
      bumpMap: t.bump,
      bumpScale: t.bumpScale,
      roughness: t.roughness,
      metalness: 0,
      envMapIntensity: 0.55,
    });
    m.name = k;
    matCache.set(k, m);
  }
  return m;
}

/** Effen mat "klei"-materiaal zonder textuur. */
export function clay(color: string, roughness = 0.88): THREE.MeshStandardMaterial {
  const k = `clay|${color}|${roughness}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0, envMapIntensity: 0.55 });
    m.name = k;
    matCache.set(k, m);
  }
  return m;
}

export function glass(tint = '#2c3540'): THREE.MeshStandardMaterial {
  const k = `glass|${tint}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint), roughness: 0.12, metalness: 0.1, envMapIntensity: 1.4 });
    m.name = k;
    matCache.set(k, m);
  }
  return m;
}

export function clearGlass(): THREE.MeshStandardMaterial {
  const k = 'clearglass';
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#cfe3ea'),
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.32,
      envMapIntensity: 1.2,
      depthWrite: false,
    });
    m.name = k;
    matCache.set(k, m);
  }
  return m;
}

export function emissive(color: string, intensity = 1.6): THREE.MeshStandardMaterial {
  const k = `emis|${color}|${intensity}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.5 });
    m.name = k;
    matCache.set(k, m);
  }
  return m;
}

/** Vitrage: zachte lichte stof met verticale plooien. */
let curtainTex: THREE.CanvasTexture | null = null;
export function curtain(): THREE.MeshStandardMaterial {
  const k = 'curtain';
  let m = matCache.get(k);
  if (!m) {
    if (!curtainTex) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 16;
      const ctx = c.getContext('2d')!;
      for (let i = 0; i < 128; i++) {
        const v = 150 + 60 * Math.sin((i / 128) * Math.PI * 16) ** 2;
        ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
        ctx.fillRect(i, 0, 1, 16);
      }
      curtainTex = new THREE.CanvasTexture(c);
      curtainTex.colorSpace = THREE.SRGBColorSpace;
      curtainTex.wrapS = curtainTex.wrapT = THREE.RepeatWrapping;
    }
    m = new THREE.MeshStandardMaterial({ map: curtainTex, color: '#8f969c', roughness: 0.9 });
    matCache.set(k, m);
  }
  return m;
}

const signTexCache = new Map<string, THREE.CanvasTexture>();
/** Tekst-textuur voor gevelborden (letters licht op transparant). */
export function textTexture(text: string, vertical: boolean, color: string): THREE.CanvasTexture {
  const k = `${text}|${vertical}|${color}`;
  const hit = signTexCache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const chars = [...text];
  if (vertical) {
    c.width = 128;
    c.height = Math.max(1, chars.length) * 128;
  } else {
    c.width = Math.max(1, chars.length) * 96 + 64;
    c.height = 160;
  }
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${vertical ? 112 : 124}px "Futura", "Avenir Next", "Montserrat", "Helvetica Neue", Arial, sans-serif`;
  if (vertical) chars.forEach((ch, i) => ctx.fillText(ch, 64, i * 128 + 70));
  else ctx.fillText(text, c.width / 2, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  signTexCache.set(k, t);
  return t;
}

/** Streeptextuur voor markiezen. */
export function stripeMat(a: string, b: string): THREE.MeshStandardMaterial {
  const k = `stripe|${a}|${b}`;
  let m = matCache.get(k);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 8;
    const ctx = c.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect(i * 32, 0, 32, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
    matCache.set(k, m);
  }
  return m;
}
