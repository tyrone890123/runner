// Lane Runner (Subway Surfers–style) — a single runner auto-dodges obstacles
// across `laneCount` lanes. The AI looks a fixed horizon ahead and picks the
// lane/action that maximizes clearance; reaction latency comes from AI skill.
// Default: instant respawn on collision (lives is a config toggle, SPEC §4.3).

import { HORIZON_Z } from '../engine.js';
import { createPool } from '../pool.js';

const SPREAD = 0.72;       // lane fan-out in screen fraction
const JUMP_T = 0.6;        // seconds airborne
const SLIDE_T = 0.55;

const obsPool = createPool(() => ({ kind: 'obstacle' }), (o) => { o.dead = false; o.passed = false; });

function laneX(i, count) {
  const half = Math.max(1, (count - 1) / 2);
  return ((i - (count - 1) / 2) / half) * SPREAD;
}

export const runner = {
  id: 'runner',
  label: 'Lane Runner',

  init(world, config, rng, agent) {
    const a = agent || {};
    const mid = Math.floor(config.laneCount / 2);
    a.lane = mid;
    a.targetLane = mid;
    a.x = laneX(mid, config.laneCount);
    a.state = 'run';
    a.stateT = 0;
    a.dead = false;
    a.lives = config.lives ? 3 : 0;
    a.invuln = 1.2;
    if (!agent) { for (const o of world.objects) this.release(o); world.objects.length = 0; }
    else {
      // respawn: clear the immediate field so we don't die on the same frame
      for (const o of world.objects) if (o.kind === 'obstacle' && o.z < 30) o.dead = true;
    }
    return a;
  },

  spawnAhead(z, config, rng, ramp) {
    const out = [];
    const n = config.laneCount;
    const freq = Math.min(0.95, 0.45 * config.obstacleFreq * ramp);
    if (!rng.chance(freq)) return out;

    // Never block every lane: leave at least one escape lane.
    const count = Math.min(n - 1, rng.chance(0.3 * config.obstacleFreq) ? 2 : 1);
    const lanes = [...Array(n).keys()];
    for (let k = lanes.length - 1; k > 0; k--) { const j = rng.int(0, k); [lanes[k], lanes[j]] = [lanes[j], lanes[k]]; }
    const types = config.jumpSlide ? ['low', 'high', 'block'] : ['block'];
    for (let i = 0; i < count; i++) {
      const o = obsPool.acquire();
      o.lane = lanes[i];
      o.type = rng.pick(types);
      out.push(o);
    }
    return out;
  },

  project(p, cam) {
    const zz = Math.max(p.z, 0);
    const s = 1 / (1 + zz * 0.05);
    const horizonY = cam.H * 0.18, groundY = cam.H * 0.9;
    return { x: cam.W / 2 + p.x * cam.W * 0.5 * s, y: horizonY + (groundY - horizonY) * s, scale: s };
  },

  perceive(agent, objects, config) {
    const n = config.laneCount;
    const hazard = new Array(n).fill(null);
    for (const o of objects) {
      if (o.kind !== 'obstacle' || o.dead || o.z <= 0) continue;
      const h = hazard[o.lane];
      if (!h || o.z < h.z) hazard[o.lane] = { z: o.z, type: o.type };
    }
    agent._hazard = hazard;

    const values = {};
    for (let i = 0; i < n; i++) {
      const h = hazard[i];
      let v = h ? h.z : HORIZON_Z;
      if (h && h.type === 'block') v = h.z * 0.2;        // can only pass by leaving
      // penalize a far reach across lanes (slower to arrive)
      v -= Math.abs(i - agent.lane) * 1.5;
      values['L' + i] = v;
    }
    const cur = hazard[agent.lane];
    if (config.jumpSlide) {
      values.J = cur && cur.type === 'low' && cur.z < 18
        ? HORIZON_Z * 1.2
        : (cur && cur.z < 14 ? -60 : (cur ? cur.z * 0.6 : HORIZON_Z * 0.5));
      values.S = cur && cur.type === 'high' && cur.z < 18
        ? HORIZON_Z * 1.2
        : (cur && cur.z < 14 ? -60 : (cur ? cur.z * 0.6 : HORIZON_Z * 0.5));
    }
    return { values };
  },

  legalActions(agent, config) {
    const acts = [];
    for (let i = 0; i < config.laneCount; i++) acts.push({ key: 'L' + i, lane: i });
    if (config.jumpSlide) { acts.push({ key: 'J' }); acts.push({ key: 'S' }); }
    return acts;
  },

  applyAction(agent, action, dt, config) {
    if (action.key && action.key[0] === 'L') {
      agent.targetLane = action.lane;
    } else if (action.key === 'J' && agent.state === 'run') {
      agent.state = 'jump'; agent.stateT = JUMP_T;
    } else if (action.key === 'S' && agent.state === 'run') {
      agent.state = 'slide'; agent.stateT = SLIDE_T;
    }
    agent.lastKey = action.key;

    const tx = laneX(agent.targetLane, config.laneCount);
    agent.x += (tx - agent.x) * Math.min(1, dt * 8);
    if (Math.abs(tx - agent.x) < 0.02) agent.lane = agent.targetLane;

    if (agent.state !== 'run') {
      agent.stateT -= dt;
      if (agent.stateT <= 0) { agent.state = 'run'; agent.stateT = 0; }
    }
  },

  resolve(agent, objects, config) {
    if (agent.invuln > 0) agent.invuln -= 1 / 60;
    const gap = Math.abs(laneX(1, config.laneCount) - laneX(0, config.laneCount));
    for (const o of objects) {
      if (o.kind !== 'obstacle' || o.passed || o.dead) continue;
      if (o.z > 0) continue;
      o.passed = true;
      if (agent.invuln > 0) continue;
      const inBand = Math.abs(laneX(o.lane, config.laneCount) - agent.x) < gap * 0.6;
      if (!inBand) continue;
      let survive = false;
      if (o.type === 'low') survive = agent.state === 'jump';
      else if (o.type === 'high') survive = agent.state === 'slide';
      else survive = false; // block: should have changed lanes
      if (!survive) {
        if (agent.lives > 0) {
          agent.lives--;
          agent.invuln = 1.2;
          for (const q of objects) if (q.kind === 'obstacle' && q.z < 26) q.dead = true;
        } else {
          agent.dead = true;
        }
      }
    }
  },

  isDead(agent) { return agent.dead; },

  render(ctx, world, cam, config) {
    const c = config.colors, W = cam.W, H = cam.H, n = config.laneCount;
    const agent = world.agent;

    ctx.fillStyle = c.sky;
    ctx.fillRect(0, 0, W, H * 0.18);
    const g = ctx.createLinearGradient(0, H * 0.18, 0, H);
    g.addColorStop(0, '#7d8893');
    g.addColorStop(1, c.track);
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.18, W, H);

    // Track + lane dividers
    const edgeN = cam.project({ x: -1.05, z: 0 }), edgeF = cam.project({ x: -1.05, z: HORIZON_Z });
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      const lx = (i - n / 2) / (n / 2) * SPREAD * (n / Math.max(1, n - 1));
      const a = cam.project({ x: lx, z: 0 }), b = cam.project({ x: lx, z: HORIZON_Z });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    const objs = world.objects.slice().sort((a, b) => b.z - a.z);
    for (const o of objs) {
      if (o.dead || o.z < -2) continue;
      const p = cam.project({ x: laneX(o.lane, n), z: o.z });
      const w = W * 0.16 * p.scale;
      if (o.type === 'low') {
        const h = H * 0.07 * p.scale;
        ctx.fillStyle = c.gateBad;
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);
      } else if (o.type === 'high') {
        const h = H * 0.06 * p.scale;
        ctx.fillStyle = c.gold;
        ctx.fillRect(p.x - w / 2, p.y - H * 0.28 * p.scale, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(p.x - w * 0.1, p.y - H * 0.28 * p.scale, w * 0.2, H * 0.28 * p.scale);
      } else {
        const h = H * 0.22 * p.scale;
        ctx.fillStyle = '#3a3f46';
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);
      }
    }

    // Runner
    const p = cam.project({ x: agent.x, z: 1.3 });
    let figH = H * 0.16, yOff = 0, squash = 1;
    if (agent.state === 'jump') {
      const t = 1 - agent.stateT / JUMP_T;
      yOff = -Math.sin(t * Math.PI) * H * 0.16;
    } else if (agent.state === 'slide') {
      squash = 0.5;
    }
    const flicker = agent.invuln > 0 && Math.floor(world.time * 12) % 2 === 0;
    if (!flicker) {
      ctx.fillStyle = c.unit;
      const w = figH * 0.5;
      ctx.fillRect(p.x - w / 2, p.y - figH * squash + yOff, w, figH * squash);
      ctx.beginPath();
      ctx.arc(p.x, p.y - figH * squash + yOff - figH * 0.12, figH * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  telemetry(agent, action, world) {
    let decision = 'run';
    if (action && action.key) {
      if (action.key === 'J') decision = 'jump';
      else if (action.key === 'S') decision = 'slide';
      else decision = `lane ${Number(action.key.slice(1)) + 1}`;
    }
    return { decision, agent: agent.lives > 0 ? `♥${agent.lives + 1}` : 'live' };
  },

  release(o) { if (o.kind === 'obstacle') obsPool.release(o); },
};
