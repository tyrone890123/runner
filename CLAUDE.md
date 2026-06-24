# CLAUDE.md

Guidance for Claude (and humans) working in this repo. Read `SPEC.md` for the full product spec; this file is the operational contract.

## What this is

**Autoreel**: a self-playing, endless, browser-based simulator of "hyper-casual mobile ad" gameplay. No player — an autonomous AI agent runs forever. The human only tunes the environment via a slider panel. Three modes: Bridge Runner, Army Battle, Lane Runner. Static site for GitHub Pages.

## Hard constraints (do not violate)

- **Vanilla JS + Canvas 2D.** No framework, no bundler, no build step.
- **No runtime dependencies.** No npm packages shipped to the browser, no CDN libraries, no downloaded fonts (use system font stacks). If you think a dependency is truly needed, stop and ask first.
- **Static only.** Everything must run as plain files served over HTTPS. No backend, no `fetch` to any API, no analytics.
- **Config lives in the URL query string.** It is the canonical store and must work inside a sandboxed iframe. **Do not make core logic depend on `localStorage`** (it is blocked in some sandboxes); `localStorage` may only be an optional convenience for standalone hosting.
- **No human gameplay input.** Keyboard/mouse/touch may operate the *panel* only. Nothing the user does may steer the agent. Death always auto-respawns; never add a game-over screen.
- **No score/leaderboard system.**
- All art is **drawn in code**. No image/audio assets unless explicitly requested.

## Tech stack

- HTML + CSS + ES modules (native `import`/`export`, no transpile).
- Canvas 2D for rendering. (WebGL is out of scope unless asked.)
- Seedable PRNG in-repo (e.g. mulberry32) — do not pull in a random library.

## Repo structure (target)

```
/
├── index.html            # canvas + panel markup, loads src/main.js as a module
├── styles.css            # panel + layout; game visuals are canvas-drawn
├── src/
│   ├── main.js           # bootstraps engine, wires panel <-> config
│   ├── engine.js         # fixed-timestep loop, world scroll, spawn director, respawn
│   ├── ai.js             # generic policy; maps aiSkill -> latency/optimality/precision
│   ├── config.js         # config schema + URL query (de)serialization
│   ├── hud.js            # operator telemetry strip ("what the AI is deciding")
│   ├── rng.js            # seedable PRNG
│   ├── pool.js           # object pool helper
│   └── modes/
│       ├── bridge.js
│       ├── army.js
│       └── runner.js
└── SPEC.md
```

A single-file `index.html` is an acceptable fallback if modules are explicitly unwanted — but default to the structure above.

## Architecture

One engine, three cameras. The engine owns the loop, the scrolling world, the spawn director, the AI, the HUD, and config. Each **mode is a strategy** implementing the interface below; the engine never special-cases a mode.

### Mode interface (contract)

Each mode exports an object/class with:

- `id`, `label` — identity.
- `init(world, config)` — build the initial agent and mode state.
- `spawnAhead(distance, config) -> object[]` — emit world objects for the next distance band (gates/obstacles/enemies). Use pooled objects.
- `project(worldPoint, camera) -> { x, y, scale }` — world→screen transform (this is the camera).
- `perceive(agent, objects) -> inputs` — the limited view handed to the AI (next N objects within a horizon). The AI sees nothing else.
- `legalActions(agent) -> action[]` — what the agent may do this tick (steer lanes, choose gate, jump/slide, fire).
- `applyAction(agent, action, dt)` — move/steer/act on the agent.
- `resolve(agent, objects) -> events` — collisions and gate effects; sets `agent.dead` when appropriate.
- `isDead(agent) -> bool`.
- `render(ctx, world, camera, config)` — draw the world and agent.
- `telemetry(agent, lastAction) -> object` — fields for the operator HUD (e.g. current decision + confidence, agent count, distance).

Shared AI flow per tick: `inputs = mode.perceive(...)` → `action = ai.decide(inputs, mode.legalActions(agent), config.aiSkill)` → `mode.applyAction(...)`. The mode supplies *what's legal and what's seen*; `ai.js` decides *how well*.

### Loop

Fixed timestep with an accumulator; `requestAnimationFrame` drives render. `config.speed` scales simulation time only. Pause halts the sim, not the page. Distance increases monotonically; cull objects behind the camera and return them to the pool.

## Coding conventions

- **No comments that restate the code.** Comment only non-obvious *why* (a tricky projection, a perf workaround).
- **When fixing a bug, explain the cause** in the commit/PR description, not just the patch.
- **Prefer the standard library and existing repo helpers** over new abstractions or dependencies.
- Keep modes isolated behind the interface — no cross-mode imports, no engine reaching into mode internals.
- Pure-ish update functions where practical; keep rendering free of state mutation.
- Avoid per-frame allocation in hot paths; reuse via `pool.js`.

## Running locally

ES modules won't load over `file://` (CORS). Serve over a local static server:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

(Any static server works.) Test all three modes, the auto-cycle toggle, every slider, and confirm config round-trips through the URL (reload should restore state).

## Deploying

GitHub Pages, no build: put `index.html` at repo root (or `/docs`), enable Pages on that branch/folder, push. See `SPEC.md` §9.

## Adding a new mode

1. Create `src/modes/<name>.js` implementing the full interface above.
2. Register it in the mode list in `main.js` (selector + auto-cycle rotation).
3. Add its mode-specific fields to the config schema in `config.js` (with URL keys and ranges) and to the panel.
4. Verify: it scrolls endlessly, the AI acts only on perceived/legal actions, death auto-respawns, telemetry populates the HUD, and it holds ~60fps with pooling.

## Performance gotchas

- Cap rendered crowd sprites (e.g. ≤120) and show the remainder as a number — do not draw thousands of figures.
- DPR-aware canvas sizing; redraw on resize.
- One canvas, no DOM node per game object.
- Watch GC: pool spawned objects; avoid building arrays/objects every frame in the loop.

## Definition of done (for any change)

- Constraints above still hold (no deps, static, URL-config, no human control of the agent, no score, auto-respawn).
- All three modes run; sliders apply live; URL config round-trips.
- ~60fps on a mid laptop; no obvious GC stutter.
- Reduced motion respected; sliders keyboard-focusable; works down to mobile width.
