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

    const gap = laneX(1, n) - laneX(0, n);
    const edgeHalf = SPREAD + gap / 2;

    // Track surface
    const nl = cam.project({ x: -edgeHalf, z: 0 }), nr = cam.project({ x: edgeHalf, z: 0 });
    const fl = cam.project({ x: -edgeHalf, z: HORIZON_Z }), fr = cam.project({ x: edgeHalf, z: HORIZON_Z });
    ctx.fillStyle = '#8a9099';
    ctx.beginPath();
    ctx.moveTo(nl.x, nl.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(fl.x, fl.y);
    ctx.closePath(); ctx.fill();

    // Scrolling ties convey speed.
    drawRungs(ctx, cam, world.distance, 'rgba(0,0,0,0.13)', 4, edgeHalf);

    // Lane dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      const lx = laneX(0, n) - gap / 2 + i * gap;
      const a = cam.project({ x: lx, z: 0 }), b = cam.project({ x: lx, z: HORIZON_Z });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Highlight the runner's current lane.
    const half = gap / 2;
    const la = cam.project({ x: agent.x - half, z: 0 }), lb = cam.project({ x: agent.x + half, z: 0 });
    const lc = cam.project({ x: agent.x + half * 0.6, z: 20 }), ld = cam.project({ x: agent.x - half * 0.6, z: 20 });
    ctx.fillStyle = hexA(c.unit, 0.12);
    ctx.beginPath();
    ctx.moveTo(la.x, la.y); ctx.lineTo(lb.x, lb.y); ctx.lineTo(lc.x, lc.y); ctx.lineTo(ld.x, ld.y);
    ctx.closePath(); ctx.fill();

    const objs = world.objects.slice().sort((a, b) => b.z - a.z);
    for (const o of objs) {
      if (o.dead || o.z < -2) continue;
      const p = cam.project({ x: laneX(o.lane, n), z: o.z });
      drawObstacle(ctx, o, p, W, H, c);
    }

    drawRunner(ctx, agent, cam, config, world.time);
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

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shadowEllipse(ctx, x, y, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
}

function hazardStripes(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  const step = Math.max(6, h * 0.6);
  for (let i = -h; i < w; i += step * 2) {
    ctx.beginPath();
    ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h);
    ctx.lineTo(x + i + h + step, y + h); ctx.lineTo(x + i + step, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// A triangle cue above/below an obstacle telling you the action it demands.
function drawCue(ctx, x, y, dir, color, scale) {
  const s = Math.max(8, 14 * scale);
  ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (dir === 'up') { ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.7, y); ctx.lineTo(x - s * 0.7, y); }
  else { ctx.moveTo(x, y + s); ctx.lineTo(x + s * 0.7, y); ctx.lineTo(x - s * 0.7, y); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function drawObstacle(ctx, o, p, W, H, c) {
  const w = W * 0.18 * p.scale;
  const x = p.x - w / 2;
  if (o.type === 'low') {
    // hurdle: jump it
    const h = H * 0.08 * p.scale, y = p.y - h;
    shadowEllipse(ctx, p.x, p.y, w * 0.55);
    ctx.fillStyle = c.gateBad; roundRect(ctx, x, y, w, h, 4); ctx.fill();
    hazardStripes(ctx, x, y, w, h);
    drawCue(ctx, p.x, y - 8 * p.scale - 6, 'up', c.gateGood, p.scale);
  } else if (o.type === 'high') {
    // overhead bar: slide under it
    const barY = p.y - H * 0.30 * p.scale, h = H * 0.06 * p.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, barY, w * 0.09, p.y - barY);
    ctx.fillRect(x + w - w * 0.09, barY, w * 0.09, p.y - barY);
    ctx.fillStyle = c.gold; ctx.fillRect(x, barY, w, h);
    hazardStripes(ctx, x, barY, w, h);
    drawCue(ctx, p.x, barY + h + 12 * p.scale, 'down', c.gateGood, p.scale);
  } else {
    // full barrier: switch lanes
    const h = H * 0.24 * p.scale, y = p.y - h;
    shadowEllipse(ctx, p.x, p.y, w * 0.55);
    ctx.fillStyle = '#2b2f36'; roundRect(ctx, x, y, w, h, 6); ctx.fill();
    hazardStripes(ctx, x, y + h * 0.18, w, h * 0.64);
    ctx.strokeStyle = c.gateBad; ctx.lineWidth = Math.max(2, 4 * p.scale);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.22, y + h * 0.32); ctx.lineTo(x + w * 0.78, y + h * 0.68);
    ctx.moveTo(x + w * 0.78, y + h * 0.32); ctx.lineTo(x + w * 0.22, y + h * 0.68);
    ctx.stroke();
  }
}

function drawRunner(ctx, agent, cam, config, time) {
  const c = config.colors, H = cam.H;
  const p = cam.project({ x: agent.x, z: 1.3 });
  let figH = H * 0.16, yOff = 0, squash = 1;
  if (agent.state === 'jump') {
    const t = 1 - agent.stateT / JUMP_T;
    yOff = -Math.sin(t * Math.PI) * H * 0.18;
  } else if (agent.state === 'slide') {
    squash = 0.5;
  }
  shadowEllipse(ctx, p.x, p.y, figH * 0.45 * (1 - Math.min(0.5, -yOff / (H * 0.3))));
  if (agent.invuln > 0 && Math.floor(time * 12) % 2 === 0) return;

  const w = figH * 0.5;
  const bodyH = figH * 0.62 * squash;
  const topY = p.y - bodyH + yOff;
  // legs
  if (agent.state !== 'slide') {
    const sw = agent.state === 'run' ? Math.sin(time * 18) * w * 0.45 : 0;
    ctx.fillStyle = shade(c.unit, 0.6);
    ctx.fillRect(p.x - w * 0.42 + sw * 0.5, p.y - figH * 0.2 + yOff, w * 0.28, figH * 0.22);
    ctx.fillRect(p.x + w * 0.14 - sw * 0.5, p.y - figH * 0.2 + yOff, w * 0.28, figH * 0.22);
  }
  // body
  const grad = ctx.createLinearGradient(p.x - w / 2, topY, p.x + w / 2, topY);
  grad.addColorStop(0, shade(c.unit, 0.8));
  grad.addColorStop(1, shade(c.unit, 1.2));
  ctx.fillStyle = grad;
  roundRect(ctx, p.x - w / 2, topY, w, bodyH, w * 0.25); ctx.fill();
  // head
  ctx.fillStyle = shade(c.unit, 1.25);
  ctx.beginPath(); ctx.arc(p.x, topY - figH * 0.1, figH * 0.15, 0, Math.PI * 2); ctx.fill();
}

// Scrolling cross-ties marching toward the camera as distance grows.
function drawRungs(ctx, cam, dist, color, spacing, xHalf) {
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  const off = ((dist % spacing) + spacing) % spacing;
  for (let rz = HORIZON_Z - off; rz > 0.3; rz -= spacing) {
    const a = cam.project({ x: -xHalf, z: rz }), b = cam.project({ x: xHalf, z: rz });
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
