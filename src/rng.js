// Seedable PRNG (mulberry32). Deterministic given a seed so a shared URL
// reproduces the same run. No dependency on Math.random in the sim.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience wrapper carrying a few helpers around a mulberry32 stream.
export function createRng(seed) {
  let next = mulberry32(seed);
  return {
    reseed(s) { next = mulberry32(s >>> 0); },
    float() { return next(); },
    range(lo, hi) { return lo + (hi - lo) * next(); },
    int(lo, hi) { return Math.floor(lo + (hi - lo + 1) * next()); },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    chance(p) { return next() < p; },
  };
}
