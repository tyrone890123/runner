# Autoreel

A self-playing, endless, browser-based simulator of "hyper-casual mobile ad"
gameplay. **There is no player** — an autonomous AI agent runs forever. You are
the *operator*: you don't steer the agent, you only tune the environment from
the side panel and watch it play well (or hilariously badly).

Vanilla JS + Canvas 2D. No framework, no build step, no runtime dependencies.
Deployable straight to GitHub Pages.

## Modes

- **Bridge Runner** — a crowd auto-runs toward the camera through paired
  `+ / − / × / ÷` gates; the AI picks the side that grows the crowd and
  auto-fires at obstacles.
- **Army Battle** — a top-down squad advances through operator gates and enemy
  waves; the AI steers toward the better gate and emptier lane while the squad
  auto-fires. Simple HP trade.
- **Lane Runner** — a Subway Surfers–style runner auto-dodges obstacles across
  lanes (jump / slide / switch), reacting with a latency set by its skill.

## Watching it play

The **operator console** on the right tunes config live: mode, AI skill, game
speed, spawn density, difficulty ramp, palette, plus per-mode controls
(crowd/squad size, gate strength, lane count, obstacles, etc.). The
**telemetry strip** along the bottom of the canvas surfaces *what the AI is
deciding right now* — e.g. `AI ▸ gate ×2 over −8  conf 0.81` — alongside
distance, agent count and FPS.

`AI skill` (0–100) is the dial to play with: it maps to reaction latency,
optimal-choice probability, and aim/steering precision. Crank it down to watch
the agent make mistakes; death always auto-respawns.

## Running locally

ES modules don't load over `file://`, so serve the folder over any static
server:

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Config & sharing

All configuration lives in the **URL query string** (the canonical store), so a
setup is shareable as a link and works inside a sandboxed iframe. Defaults are
omitted from the URL to keep links short. Example:

```
?m=runner&ai=20&lc=4&spd=1.5&th=sunset
```

## Deploying (GitHub Pages)

`index.html` is at the repo root. Enable Pages on the branch/folder — no build
step, push = deploy.

See `SPEC.md` for the full product spec and `CLAUDE.md` for the architecture
contract (one engine, three cameras; each mode is a strategy).
