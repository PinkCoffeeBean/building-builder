import * as THREE from 'three';
import type { ChimneyDef, EnvDef } from '../../catalog/catalog';
import type { EnvItem } from '../../core/types';
import { clay, emissive } from '../materials';
import { capsule, cyl, mesh, rboxAt, sphere } from '../shapes';
import { shade } from './facade';

/** Lichte kleurvariatie zodat bollen niet allemaal identiek ogen. */
function vary(hex: string, i: number) {
  return shade(hex, ((i * 37) % 7) / 100 - 0.03);
}

function leafGeo() {
  // langwerpig, licht gebogen palmblad
  const g = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI);
  g.scale(0.16, 0.012, 0.035);
  g.translate(0.16, 0, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, pos.getY(i) - 0.55 * (x * x) * 1.6);
  }
  g.computeVertexNormals();
  return g;
}
let LEAF: THREE.BufferGeometry | null = null;

export function buildEnvItem(d: EnvDef, item: EnvItem): THREE.Group {
  const g = new THREE.Group();
  const main = clay(item.color, 0.9);
  const acc = clay(item.accent, 0.85);
  switch (d.style) {
    case 'lollipop': {
      g.add(mesh(cyl(0.016, 0.022, 0.5, 10), acc, 0, 0.25, 0));
      const crown = mesh(sphere(0.2, 32, 24), main, 0, 0.6, 0);
      crown.scale.set(1, 0.95, 1);
      g.add(crown);
      g.add(mesh(cyl(0.05, 0.06, 0.02, 16), clay('#6b5040'), 0, 0.01, 0));
      break;
    }
    case 'cypress': {
      g.add(mesh(cyl(0.014, 0.018, 0.12, 8), acc, 0, 0.06, 0));
      const c = mesh(sphere(0.12, 28, 20), main, 0, 0.36, 0);
      c.scale.set(1, 2.4, 1);
      g.add(c);
      break;
    }
    case 'palm': {
      const n = 9;
      let x = 0;
      let y = 0;
      for (let i = 0; i < n; i++) {
        const seg = mesh(cyl(0.017 - i * 0.0007, 0.021 - i * 0.0007, 0.075, 10), clay(i % 2 ? item.accent : shade(item.accent, -0.06), 0.9), x, y + 0.0375, 0);
        seg.rotation.z = -0.03;
        g.add(seg);
        x += 0.0022 * i * 0.6;
        y += 0.07;
      }
      LEAF ??= leafGeo();
      const leafMat = main;
      for (let i = 0; i < 11; i++) {
        const l = new THREE.Mesh(LEAF, i % 2 ? leafMat : clay(shade(item.color, 0.05), 0.9));
        l.castShadow = true;
        l.position.set(x, y, 0);
        l.rotation.y = (i / 11) * Math.PI * 2;
        l.rotation.z = 0.35 - (i % 3) * 0.12;
        g.add(l);
      }
      g.add(mesh(sphere(0.03, 12, 8), clay('#7a5a30'), x, y - 0.01, 0));
      break;
    }
    case 'bush': {
      const pts: [number, number, number, number][] = [
        [0, 0.08, 0, 0.1],
        [0.08, 0.06, 0.03, 0.075],
        [-0.07, 0.055, 0.05, 0.07],
        [0.02, 0.05, -0.08, 0.07],
      ];
      pts.forEach(([px, py, pz, r], i) => g.add(mesh(sphere(r, 20, 14), clay(vary(item.color, i)), px, py, pz)));
      for (let i = 0; i < 7; i++) {
        const a = i * 2.1;
        g.add(mesh(sphere(0.013, 8, 6), clay(item.accent, 0.8), Math.cos(a) * 0.08, 0.1 + (i % 3) * 0.02, Math.sin(a) * 0.08, false));
      }
      break;
    }
    case 'bed': {
      const s = 0.38;
      g.add(rboxAt(clay('#d9d6cf'), -s, 0, -s, s, 0.035, s, 0.008));
      g.add(rboxAt(acc, -s + 0.03, 0.03, -s + 0.03, s - 0.03, 0.04, s - 0.03, 0.004));
      const spots: [number, number, number][] = [
        [-0.2, -0.18, 0.09],
        [0.15, -0.2, 0.07],
        [0.22, 0.12, 0.085],
        [-0.12, 0.2, 0.08],
        [0.02, 0.02, 0.1],
        [-0.25, 0.02, 0.06],
        [0.1, 0.26, 0.06],
      ];
      spots.forEach(([px, pz, r], i) => {
        const b = mesh(sphere(r, 18, 12), clay(vary(item.color, i)), px, 0.04 + r * 0.6, pz);
        b.scale.y = 0.8;
        g.add(b);
      });
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7 + 0.5;
        g.add(mesh(sphere(0.035, 12, 8), clay('#d873a6'), Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2));
      }
      break;
    }
    case 'planter': {
      g.add(rboxAt(acc, -0.19, 0, -0.07, 0.19, 0.14, 0.07, 0.012));
      g.add(rboxAt(clay('#5c4636'), -0.17, 0.13, -0.055, 0.17, 0.142, 0.055, 0.004));
      [-0.11, 0, 0.11].forEach((px, i) => g.add(mesh(sphere(0.07 - (i % 2) * 0.01, 18, 12), clay(vary(item.color, i)), px, 0.18, 0)));
      break;
    }
    case 'pot': {
      g.add(mesh(cyl(0.05, 0.036, 0.085, 20), acc, 0, 0.0425, 0));
      g.add(mesh(cyl(0.053, 0.053, 0.014, 20), acc, 0, 0.085, 0));
      g.add(mesh(sphere(0.055, 16, 12), clay('#5f9a48'), 0, 0.12, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(mesh(sphere(0.016, 8, 6), clay(item.color, 0.8), Math.cos(a) * 0.04, 0.15, Math.sin(a) * 0.04, false));
      }
      break;
    }
    case 'lamp': {
      g.add(mesh(cyl(0.025, 0.03, 0.03, 12), main, 0, 0.015, 0));
      g.add(mesh(cyl(0.008, 0.009, 0.62, 10), main, 0, 0.32, 0));
      const arm = mesh(capsule(0.007, 0.08), main, 0.04, 0.63, 0);
      arm.rotation.z = Math.PI / 2;
      g.add(arm);
      g.add(rboxAt(main, 0.05, 0.6, -0.022, 0.12, 0.625, 0.022, 0.008));
      g.add(rboxAt(emissive(item.accent, 2.5), 0.055, 0.594, -0.016, 0.115, 0.6, 0.016, 0.002));
      break;
    }
    case 'bench': {
      for (let i = 0; i < 3; i++) g.add(rboxAt(main, -0.17, 0.1, -0.055 + i * 0.038, 0.17, 0.115, -0.025 + i * 0.038, 0.004));
      for (const x of [-0.14, 0.14]) g.add(rboxAt(acc, x - 0.01, 0, -0.06, x + 0.01, 0.1, 0.06, 0.004));
      break;
    }
  }
  g.scale.setScalar(d.scale);
  return g;
}

export function buildChimney(d: ChimneyDef, color: string, extra: number): THREE.Group {
  const g = new THREE.Group();
  const m = clay(color, 0.9);
  const w = d.width;
  const h = d.height + extra;
  g.add(rboxAt(m, -w / 2, -0.02, -w / 2, w / 2, h, w / 2, 0.01));
  g.add(rboxAt(clay(shade(color, -0.12)), -w / 2 - 0.015, h, -w / 2 - 0.015, w / 2 + 0.015, h + 0.025, w / 2 + 0.015, 0.008));
  g.add(mesh(cyl(w * 0.22, w * 0.22, 0.05, 12), clay('#2a2c30'), 0, h + 0.045, 0));
  return g;
}
