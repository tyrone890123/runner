// One engine, three cameras. Owns the fixed-timestep loop, the scrolling world,
// the spawn director (difficulty ramp), the autonomous AI, the HUD and config.
// It never special-cases a mode — each mode is a strategy behind the interface
// documented in CLAUDE.md.

import { createAI } from './ai.js';
import { createRng } from './rng.js';
import { resolveTheme } from './config.js';

const STEP = 1 / 60;          // fixed sim timestep
const MAX_FRAME = 0.25;       // clamp huge dt (tab regains focus)
export const HORIZON_Z = 64;  // how far ahead objects are perceived/spawned
const CULL_Z = -8;            // recycle objects this far behind the camera
const SCROLL = 17;            // base world units/sec; config.speed scales sim time
const BASE_BAND = 11;         // nominal world-units between spawn bands

export function createEngine(canvas, config, modes, hud) {
  const ctx = canvas.getContext('2d');
  const rng = createRng(config.seed);
  const ai = createAI();

  const world = {
    distance: 0,      // monotonic total distance (telemetry + difficulty ramp)
    time: 0,
    objects: [],
    agent: null,
    spawnCursor: 0,   // absolute distance up to which we've spawned
    respawns: 0,
  };

  let mode = null;
  let lastAction = null;
  let cycleTimer = 0;

  // FPS estimate (render cadence, not sim).
  let fps = 60, fpsAccum = 0, fpsFrames = 0;

  function bandSize() {
    let b = BASE_BAND / config.density;
    if (mode && mode.id === 'bridge') b *= config.gateSpacing;
    return Math.max(4, b);
  }

  // Difficulty multiplier grows with distance, paced by config.difficulty.
  function ramp(atDistance) {
    return 1 + (atDistance / 220) * config.difficulty;
  }

  function clearWorld() {
    for (const o of world.objects) if (mode && mode.release) mode.release(o);
    world.objects.length = 0;
  }

  function setMode(id) {
    if (mode && mode.id === id && world.agent) return;
    clearWorld();
    mode = modes.find((m) => m.id === id) || modes[0];
    config.mode = mode.id;
    world.spawnCursor = world.distance + bandSize();
    world.agent = mode.init(world, config, rng);
    ai.reset();
    lastAction = null;
    cycleTimer = 0;
  }

  function reseed() {
    rng.reseed(config.seed);
    reset();
  }

  function reset() {
    world.distance = 0;
    world.time = 0;
    world.respawns = 0;
    clearWorld();
    world.spawnCursor = bandSize();
    world.agent = mode.init(world, config, rng);
    ai.reset();
    lastAction = null;
  }

  function respawn() {
    world.respawns++;
    mode.init(world, config, rng, world.agent); // mode resets the agent in place
    ai.reset();
  }

  function spawnDirector() {
    const horizon = world.distance + HORIZON_Z;
    let guard = 0;
    while (world.spawnCursor <= horizon && guard++ < 40) {
      const spawned = mode.spawnAhead(world.spawnCursor, config, rng, ramp(world.spawnCursor));
      if (spawned && spawned.length) {
        for (const o of spawned) {
          o.z = world.spawnCursor - world.distance; // place at the horizon
          world.objects.push(o);
        }
      }
      world.spawnCursor += bandSize();
    }
  }

  function update(dt) {
    world.time += dt;
    const move = SCROLL * dt;
    world.distance += move;

    const objs = world.objects;
    for (let i = 0; i < objs.length; i++) objs[i].z -= move;

    spawnDirector();

    // Shared per-tick AI flow (CLAUDE.md): perceive -> decide -> apply.
    const inputs = mode.perceive(world.agent, objs, config);
    const legal = mode.legalActions(world.agent, config);
    const action = ai.decide(inputs, legal, config.ai, dt, rng);
    mode.applyAction(world.agent, action, dt, config);
    lastAction = action;

    mode.resolve(world.agent, objs, config, rng);

    // Cull dead/behind objects, compacting in place to avoid allocation.
    let w = 0;
    for (let r = 0; r < objs.length; r++) {
      const o = objs[r];
      if (o.dead || o.z < CULL_Z) { if (mode.release) mode.release(o); continue; }
      objs[w++] = o;
    }
    objs.length = w;

    if (mode.isDead(world.agent)) respawn();

    // Auto-cycle modes (SPEC §6, default off).
    if (config.autocycle) {
      cycleTimer += dt;
      if (cycleTimer >= config.cycleInterval) {
        const i = modes.findIndex((m) => m.id === mode.id);
        setMode(modes[(i + 1) % modes.length].id);
      }
    }
  }

  function render() {
    const theme = resolveTheme(config);
    config.colors = theme;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const cam = { W, H, project: (p) => mode.project(p, { W, H }) };
    mode.render(ctx, world, cam, config);
  }

  let acc = 0, last = 0, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;

    fpsAccum += dt; fpsFrames++;
    if (fpsAccum >= 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

    if (!config.paused) {
      acc += dt * config.speed;
      let steps = 0;
      while (acc >= STEP && steps++ < 8) { update(STEP); acc -= STEP; }
      if (steps >= 8) acc = 0; // spiral-of-death guard
    }

    render();

    const tel = mode.telemetry(world.agent, lastAction, world);
    hud.update({
      ...tel,
      dist: world.distance,
      objects: world.objects.length,
      respawns: world.respawns,
      confidence: lastAction ? lastAction.confidence : null,
      fps,
    }, config.reduceMotion);
  }

  // Re-init the current mode's agent and clear objects without resetting the
  // distance counter — used when a per-mode slider changes structure live.
  function refresh() {
    clearWorld();
    world.spawnCursor = world.distance + bandSize();
    world.agent = mode.init(world, config, rng);
    ai.reset();
    lastAction = null;
  }

  return {
    start() { setMode(config.mode); raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(raf); },
    setMode,
    reset,
    reseed,
    refresh,
    get mode() { return mode ? mode.id : null; },
  };
}
