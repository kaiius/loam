// Seeded RNG (mulberry32) so worlds are reproducible.

export function createRng(seed) {
  let a = seed >>> 0;
  const rng = {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * rng.next();
    },
    int(min, max) {
      return Math.floor(rng.range(min, max + 1));
    },
    pick(arr) {
      return arr[Math.floor(rng.next() * arr.length)];
    },
    chance(p) {
      return rng.next() < p;
    },
  };
  return rng;
}
