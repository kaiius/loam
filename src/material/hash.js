// D4: the world-state hash — determinism's fingerprint.
//
// Same (seed, size) → identical hash at any tick, across runs (same code).
// Two independent FNV-1a 32-bit folds (different offsets) over:
//   g.mat (full), g.moist/g.nutrient (full, as Float32 bits),
//   g.strata/g.vein/g.weather (full), sky columns (T, vapor, cloud, soil,
//   windU as Float32 bits), plant allele means quantized to 1e-6 (sorted by
//   plant id), census series lengths + last values, mw.tick.
// Rendered as 16 hex chars in logs. Probe-only cost (not on the hot tick).

const FNV_PRIME = 0x01000193;

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
function f32bits(v) {
  _f32[0] = v;
  return _u32[0];
}

export function worldStateHash(mw) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mixByte = (b) => {
    h1 = Math.imul(h1 ^ (b & 0xff), FNV_PRIME);
    h2 = Math.imul(h2 ^ (b & 0xff), FNV_PRIME);
  };
  const mix32 = (v) => {
    v = v >>> 0;
    mixByte(v); mixByte(v >>> 8); mixByte(v >>> 16); mixByte(v >>> 24);
  };
  const g = mw.grid;
  if (g) {
    const m8 = g.mat;
    for (let i = 0; i < m8.length; i++) mixByte(m8[i]);
    for (const f of ['moist', 'nutrient']) {
      const arr = g[f];
      if (!arr) continue;
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
      for (let i = 0; i < u.length; i++) mix32(u[i]);
    }
    for (const f of ['strata', 'vein', 'weather']) {
      const arr = g[f];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) mixByte(arr[i]);
    }
  }
  if (mw.sky) {
    for (const c of mw.sky.cols) {
      mix32(f32bits(c.T)); mix32(f32bits(c.vapor)); mix32(f32bits(c.cloud));
      mix32(f32bits(c.soil)); mix32(f32bits(c.windU));
    }
  }
  if (mw.plants) {
    const ps = mw.plants.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
    for (const p of ps) {
      const al = p.genome && p.genome.alleles;
      if (!al) continue;
      const keys = Object.keys(al).sort();
      for (const k of keys) {
        const pair = al[k];
        if (!pair) continue;
        mix32((Math.round(((pair[0] + pair[1]) / 2) * 1e6) | 0) >>> 0);
      }
    }
  }
  if (mw.ecology && mw.ecology.series) {
    const keys = Object.keys(mw.ecology.series).sort();
    for (const k of keys) {
      const s = mw.ecology.series[k];
      mix32(s.length >>> 0);
      if (s.length) mix32(s[s.length - 1] >>> 0);
    }
  }
  mix32((mw.tick || 0) >>> 0);
  const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}
