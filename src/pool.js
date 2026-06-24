// Minimal object pool. Hot paths spawn/cull world objects every band, so we
// recycle rather than allocate to keep GC quiet (see SPEC §8 perf budget).
export function createPool(factory, reset) {
  const free = [];
  return {
    acquire() {
      const obj = free.length ? free.pop() : factory();
      return obj;
    },
    release(obj) {
      if (reset) reset(obj);
      free.push(obj);
    },
    get size() { return free.length; },
  };
}
