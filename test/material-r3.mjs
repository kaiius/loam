// Tests for the Loam round-3 renderer systems (palette-first, lightmap,
// density fields). These test pure helpers only — the browser paint path is
// exercised headless by the builder's playwright pass.
// Run: node --test test/material-r3.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  R3PAL, r3SampleRamp, r3RampRGB, r3GrassRGB, r3LightAmbient,
  r3Vigor, r3TuftDensity, r3Firefly, r3HueLerp,
} from '../src/material/render.js';

// --- palette shape ------------------------------------------------------------

test('r3 palette: one authored palette with hue-shifted ramps per material', () => {
  const keys = Object.keys(R3PAL);
  assert.ok(keys.length >= 10, `palette covers the material families, got ${keys.length}`);
  for (const k of keys) {
    if (k === 'petal') continue;
    assert.equal(R3PAL[k].length, 5, `${k}: 5-stop ramp`);
  }
});

// --- takeaway #1: hue-shifted ramps, never shade-by-darkening alone ------------

test('r3 ramps: dark and light stops differ in hue, not just lightness', () => {
  for (const key of ['grass', 'soil', 'bark', 'leaf', 'rock', 'water', 'clay', 'sand']) {
    const dark = r3SampleRamp(R3PAL[key], 0);
    const light = r3SampleRamp(R3PAL[key], 1);
    let dh = Math.abs(dark[0] - light[0]);
    if (dh > 180) dh = 360 - dh;
    assert.ok(dh > 1.5, `${key}: hue shifts along the ramp (got ${dh.toFixed(2)})`);
    assert.ok(dark[2] < light[2], `${key}: lightness rises along the ramp`);
  }
});

test('r3 ramps: darks hold saturation (no muddy darkening)', () => {
  for (const key of ['grass', 'leaf', 'soil', 'bark']) {
    const dark = r3SampleRamp(R3PAL[key], 0.1);
    const mid = r3SampleRamp(R3PAL[key], 0.5);
    assert.ok(dark[1] >= mid[1] * 0.85, `${key}: darks keep saturation (dark ${dark[1].toFixed(1)} vs mid ${mid[1].toFixed(1)})`);
  }
});

test('r3 ramps: rgb output is valid 0-255', () => {
  for (const key of Object.keys(R3PAL)) {
    if (key === 'petal') continue;
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const c = r3RampRGB(key, k);
      assert.ok(c.every((v) => v >= 0 && v <= 255), `${key}@${k}: ${c}`);
    }
  }
});

test('r3 grass: vigor shifts lush green to dry gold', () => {
  const lush = r3GrassRGB(1, 0.5), dry = r3GrassRGB(0, 0.5);
  const hue = (c) => { const [r, g, b] = c.map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d; return (h * 60 + 360) % 360; };
  assert.ok(hue(lush) > 85 && hue(lush) < 125, `lush grass is green, hue ${hue(lush).toFixed(0)}`);
  assert.ok(hue(dry) > 40 && hue(dry) < 75, `dry grass is gold, hue ${hue(dry).toFixed(0)}`);
});

// --- takeaway #1/#5: the authored day/night ambient ----------------------------

test('r3 ambient: day is bright and neutral-warm', () => {
  const a = r3LightAmbient(1);
  assert.ok(a.every((v) => v > 0.9 && v <= 1.1), `day ambient ≈ 1: ${a.map((v) => v.toFixed(2))}`);
});

test('r3 ambient: night has a floor and a cool temperature (never pure black)', () => {
  const a = r3LightAmbient(-1);
  assert.ok(a.every((v) => v >= 0.14), `night floor ≥ 0.14: ${a.map((v) => v.toFixed(2))}`);
  assert.ok(a[2] > a[0], `night is cool (blue > red): ${a.map((v) => v.toFixed(2))}`);
  assert.ok(a.every((v) => v < 0.45), `night stays dark: ${a.map((v) => v.toFixed(2))}`);
});

test('r3 ambient: dusk warms (red > blue)', () => {
  const a = r3LightAmbient(0.06);
  assert.ok(a[0] > a[2], `dusk warms: ${a.map((v) => v.toFixed(2))}`);
});

// --- takeaway #3: density fields cluster, never uniform scatter ----------------

test('r3 fields: vigor and tuft density vary across the world', () => {
  const seed = 7;
  let vmin = 1, vmax = 0, tmin = 1, tmax = 0;
  for (let x = 0; x < 3000; x += 25) {
    const v = r3Vigor(seed, x), t = r3TuftDensity(seed, x);
    assert.ok(v >= 0 && v <= 1 && t >= 0 && t <= 1, 'fields in [0,1]');
    vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
    tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
  }
  assert.ok(vmax - vmin > 0.3, `vigor varies (regions exist): ${vmin.toFixed(2)}–${vmax.toFixed(2)}`);
  assert.ok(tmax > 0.8 && tmin < 0.2, `tufts clump (dense and sparse zones): ${tmin.toFixed(2)}–${tmax.toFixed(2)}`);
});

test('r3 fields: deterministic — same seed, same field', () => {
  assert.equal(r3Vigor(7, 1234), r3Vigor(7, 1234));
  assert.equal(r3TuftDensity(42, 567), r3TuftDensity(42, 567));
  assert.notEqual(r3Vigor(7, 1234), r3Vigor(8, 1234), 'seed changes the field');
});

// --- fireflies: deterministic drift --------------------------------------------

test('r3 fireflies: pure function of (seed, i, tick)', () => {
  const a = r3Firefly(7, 3, 500, 1440, 400);
  const b = r3Firefly(7, 3, 500, 1440, 400);
  assert.deepEqual(a, b);
  const c = r3Firefly(7, 3, 501, 1440, 400);
  assert.ok(Math.abs(c.x - a.x) < 2, 'continuous drift, no popping');
  assert.ok(a.blink >= 0 && a.blink <= 1, 'blink in [0,1]');
});

// --- hue lerp takes the short path ----------------------------------------------

test('r3 hue lerp: short path (dusk never swings through swamp-green)', () => {
  assert.ok(Math.abs(r3HueLerp(350, 10, 0.5) - 0) < 1e-9, `wraps forward: ${r3HueLerp(350, 10, 0.5)}`);
  assert.ok(Math.abs(r3HueLerp(10, 350, 0.5) - 0) < 1e-9, `wraps backward: ${r3HueLerp(10, 350, 0.5)}`);
});
