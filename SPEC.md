# Autoreel — Specification

> Codename "Autoreel" (placeholder). A browser-based, **self-playing**, endless simulator of "hyper-casual mobile ad" gameplay. There is no player. A computer-controlled agent runs forever; the human only tunes the *environment* through a control panel. Static site, deployable to GitHub Pages with no build step.

---

## 1. Goals

- An endless loop that runs with **zero gameplay input**. The agent is autonomous.
- **Three modes**, switchable live (and optionally auto-cycling):
  1. **Bridge Runner** — a crowd auto-runs toward the camera through paired gates.
  2. **Army Battle** — a squad advances up a top-down field toward enemy waves.
  3. **Lane Runner** — a Subway Surfers–style runner auto-dodges obstacles in lanes.
- A **config panel of sliders** that changes the world/agent in real time.
- Runs as **static files on GitHub Pages**: vanilla JavaScript, Canvas 2D, no runtime dependencies, no backend.

## 2. Non-goals

- No score, no high-score table, no win/lose screen. Death just triggers respawn.
- No human control over the agent. The panel changes *configuration*, never steers the agent directly.
- Not a faithful reproduction of any specific commercial game. It is a genre pastiche; all art is drawn in code.
- No network calls, accounts, ads, analytics, or monetization.

---

## 3. Core concept: one engine, three cameras

The three modes look different but are the same loop:

> **a world that scrolls forever + an autonomous agent + spawned objects the agent reacts to + auto-respawn on death.**

They differ only in **camera projection** and **objective**. This is the central architectural bet: build one engine and express each mode as a strategy that implements a shared interface (camera, spawn rules, agent model, interaction rules, render, telemetry). See `CLAUDE.md` for the interface contract.

Shared systems: fixed-timestep update loop, seedable RNG, a spawner/"director" with difficulty ramp, the autonomous AI policy, the operator HUD, and the config store. None of these are mode-specific.

---

## 4. Modes

### 4.1 Bridge Runner
- **Camera:** pseudo-3D one-point perspective. The world scrolls *toward* the viewer; objects spawn small at the horizon and grow as they approach.
- **Agent:** a crowd of size `N`, drawn as up to `maxSprites` little figures with the count overlaid (the rest are implied by the number). Lane position is continuous left↔right.
- **World objects:** paired **gates**, one per side, each carrying an operator: `+k`, `−k`, `×m`, `÷m`, or a raw target number. Occasional **obstacles** that subtract from `N`.
- **AI behavior:** read the next gate pair, steer toward the gate that maximizes `N` after its operator; auto-fire at obstacles ahead.
- **Death / respawn:** `N ≤ 0` → respawn with `startCrowd`. World keeps scrolling.
- **Mode config:** `startCrowd`, `maxSprites` (render cap), gate operator strength (caps on `k`/`m`), gate spacing.

### 4.2 Army Battle (Last War–style)
- **Camera:** top-down, scrolling upward. Agent at bottom, enemies/base descending from the top.
- **Agent:** a squad of `U` units advancing up-field, with simple per-unit HP and damage; auto-targets nearest enemy.
- **World objects:** **multiplier/operator gates** en route (same operator set as Bridge), and **enemy waves**/a base that the squad fights through. Because the mode is endless, the "base" is just the current wave; clearing one reveals the next.
- **AI behavior:** steer the squad toward better gates; engage enemies automatically; spread/retreat is out of scope for v1 (units just push forward and trade fire).
- **Death / respawn:** squad eliminated mid-field → respawn with `startSquad`.
- **Mode config:** `startSquad`, unit HP, unit damage, enemy density, gate strength.
- **Open decision (default chosen):** *simple HP trade* between squad and enemies. A richer "merge units to upgrade" mechanic is deferred. Default: **HP trade**.

### 4.3 Lane Runner (Subway Surfers–style)
- **Camera:** fixed lanes receding into the screen (or side-scrolling — implementer's choice, perspective preferred for visual consistency with Bridge).
- **Agent:** a single runner occupying one of `laneCount` lanes (default **3**), able to switch lanes and jump/slide.
- **World objects:** obstacles to dodge, gaps/barriers requiring jump or slide, optional pickups (cosmetic only — no score).
- **AI behavior:** look ahead a fixed horizon, pick the lane/action that avoids the nearest hazard; react with latency derived from AI skill.
- **Death / respawn:** collision → respawn.
- **Mode config:** `laneCount` (default 3), obstacle frequency, jump/slide enabled, **lives vs. instant respawn**.
- **Open decision (default chosen):** **instant respawn** (no lives), to keep the loop unbroken. Lives is a config toggle.

---

## 5. The autonomous AI

The agent is driven by a single policy whose **competence is itself a slider** (`aiSkill`, 0–100). `aiSkill` maps to three knobs so you can watch it play brilliantly or hilariously badly:

- **Reaction latency** — high skill reacts to upcoming objects sooner; low skill reacts late.
- **Optimal-choice probability** — chance it picks the genuinely best gate/lane vs. a random legal one.
- **Aim/precision error** — jitter on steering and firing.

The AI only ever sees what a mode exposes via its "perceive" step (the next N objects within a horizon) and only ever issues legal actions for that mode. It never reads global state it shouldn't. This keeps modes swappable and the AI generic.

---

## 6. Configuration (the control panel)

Inputs change **config only**, applied live. Grouped:

**Global**
- Mode selector + **Auto-cycle modes** toggle and interval (open decision; default **off**).
- **Game speed** (simulation time multiplier).
- **AI skill** (0–100, see §5).
- **Spawn density** (objects per distance).
- **Difficulty ramp** (how fast density/strength grow with distance).
- **Palette / theme**.
- **Reduced motion** (also auto-detected from `prefers-reduced-motion`).
- **Pause**.

**Per-mode:** the mode-specific fields listed in §4.

**Persistence:** canonical state lives in the **URL query string** (e.g. `?mode=bridge&speed=1.4&ai=70`). This is shareable and works inside sandboxed iframes. `localStorage` is an *optional* convenience for standalone hosting only; nothing core may depend on it.

---

## 7. Visual design direction

The honest, brief-specific choice is to lean *into* the cheap, oversaturated "hyper-casual ad" look as a deliberate style, and contrast it against a **clinical operator console**. The user is an operator observing an autonomous system, not a player — so the panel should read like diagnostic equipment, not a game menu. That tension is the identity.

**Signature element:** a live **telemetry strip** that surfaces *what the AI is deciding right now* — e.g. `AI ▸ gate ×2 over −8 (conf 0.81)`, plus distance, agent count, and FPS. This reframes a fake ad as an observable machine and is the one thing the project is remembered by. Spend boldness here; keep everything else quiet.

**Palette — two zones (intentionally different):**

*Game canvas (loud, plastic):*
- Gate Green `#19D26B` · Danger Red `#F5333F` · Track Grey `#C9CDD2` · Sky/Water `#36B6F0` · Multiplier Gold `#FFC02E` · Unit Blue `#2F6BFF`

*Operator panel (dark instrument):*
- Panel BG `#0E1116` · Surface `#161B22` · Hairline `#2A313C` · Readout Green `#5EF2A0` · Label Grey `#8A93A2` · Warning Amber `#FFB020`

This deliberately avoids the common AI-default looks (cream + serif + terracotta; single acid accent on black; broadsheet hairlines). The panel's restrained green is framed as a *readout*, not decoration.

**Typography (system stacks, zero font downloads to stay dependency-free):**
- Big game numbers (the `+4` / `×2` / `241`): heavy geometric sans — `"Arial Black", "Helvetica Neue", Arial, sans-serif`, heaviest weight. An optional self-hosted rounded display face may replace this if a single static font file is acceptable.
- Panel readouts & slider values: monospace — `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`. Mono is honest for live numeric data.
- UI / labels: `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

**Motion:** functional only. World scroll is content, not effect. Lane changes ease ~120ms; panel readouts flash subtly on change. `prefers-reduced-motion` (or the toggle) disables flashes/camera-shake — never the simulation. A global Pause is always available.

**Quality floor:** responsive down to mobile, visible keyboard focus on every slider, reduced motion respected.

---

## 8. Technical constraints

- **Vanilla JS + Canvas 2D.** No framework, no bundler, no runtime dependencies.
- **Static only.** Must run as plain files served over HTTPS (GitHub Pages). No server, no API calls.
- **ES modules**, loaded natively by the browser (works on Pages; local dev needs a static server, see `CLAUDE.md`). Single-file build is a documented fallback if modules are undesirable.
- **Performance budget:** target 60 fps on a mid laptop. Fixed-timestep sim decoupled from render. Pool spawned objects to avoid GC churn. Cap rendered crowd sprites (e.g. ≤120) and represent the remainder as a number. DPR-aware canvas sizing. One canvas; no DOM node per game object.

---

## 9. Deployment (GitHub Pages)

1. Put `index.html` at the repo root (or in `/docs`).
2. Repo → Settings → Pages → deploy from the chosen branch/folder.
3. No build step. Push = deploy.
4. Because config lives in the URL, specific setups are shareable as links.

---

## 10. Decisions log

Locked:
- **JavaScript, not Java** (Java cannot run on GitHub Pages).
- **Auto-respawn on death** so the loop never stops.
- **URL query params** as canonical config store.
- **Modular ES modules** as the primary structure; single-file as fallback.
- **Genre pastiche**, all art drawn in code.
- Lane Runner default lanes = **3**.

Open (defaults chosen, easy to change):
- Army combat depth → default **simple HP trade** (no merge-upgrade yet).
- Lane Runner death → default **instant respawn** (lives is a toggle).
- Auto-cycle modes → default **off**.
