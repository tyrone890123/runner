// Bridge Runner — a crowd auto-runs toward the camera through paired gates.
// One-point perspective: objects spawn small at the horizon and grow as they
// approach. The AI reads the next gate pair and steers to the side that
// maximizes the crowd N; obstacles are auto-fired at.

import { HORIZON_Z } from '../engine.js';
import { createPool } from '../pool.js';

const TRACK = 0.46;        // half-width of the bridge in screen fraction at z=0
const LANE = 0.55;         // crowd lane offset when committed to a side
const HORIZON_Y = 0.28;    // where bridge meets water

const gatePool = createPool(
  () => ({ kind: 'gate' }),
  (o) => { o.consumed = false; o.dead = false; },
);
const obsPool = createPool(
  () => ({ kind: 'obstacle' }),
  (o) => { o.dead = false; },
);

let pairId = 0;

function applyOp(n, op) {
  switch (op.type) {
    case 'add': return n + op.val;
    case 'sub': return Math.max(0, n - op.val);
    case 'mul': return n * op.val;
    case 'div': return Math.max(1, Math.floor(n / op.val));
  }
  return n;
}

function opLabel(op) {
  const s = { add: '+', sub: '−', mul: '×', div: '÷' }[op.type];
  return `${s}${op.val}`;
}

function isGood(op) { return op.type === 'add' || op.type === 'mul'; }

function makeOp(rng, strength, ramp, good) {
  if (good) {
    if (rng.chance(0.55)) return { type: 'add', val: Math.max(1, Math.round(rng.range(2, 6 * strength) * ramp)) };
    return { type: 'mul', val: strength >= 1.5 && rng.chance(0.4) ? 3 : 2 };
  }
  if (rng.chance(0.6)) return { type: 'sub', val: Math.max(1, Math.round(rng.range(2, 7 * strength) * ramp)) };
  return { type: 'div', val: 2 };
}

function drawFigure(ctx, x, y, h, color) {
  const w = h * 0.42;
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y - h * 0.7, w, h * 0.7);            // body
  ctx.beginPath();
  ctx.arc(x, y - h * 0.82, h * 0.2, 0, Math.PI * 2);           // head
  ctx.fill();
}

export const bridge = {
  id: 'bridge',
  label: 'Bridge Runner',

  init(world, config, rng, agent) {
    const a = agent || {};
    a.count = config.startCrowd;
    a.x = 0;
    a.targetX = 0;
    a.dead = false;
    a._pair = null;
    if (!agent) {
      // fresh start: drop any leftover objects
      for (const o of world.objects) this.release(o);
      world.objects.length = 0;
    }
    return a;
  },

  spawnAhead(z, config, rng, ramp) {
    const out = [];
    if (rng.chance(0.18)) {
      // obstacle band
      const obs = obsPool.acquire();
      obs.x = rng.range(-LANE, LANE);
      obs.maxHp = Math.max(3, Math.round(4 * ramp));
      obs.hp = obs.maxHp;
      obs.damage = Math.max(1, Math.round(2 * ramp));
      out.push(obs);
      return out;
    }
    const id = ++pairId;
    // Bias toward a meaningful choice: usually one good + one bad gate.
    const bothSame = rng.chance(0.2);
    const leftGood = rng.chance(0.5);
    const left = gatePool.acquire();
    const right = gatePool.acquire();
    left.side = 'L'; left.x = -LANE; left.pairId = id;
    right.side = 'R'; right.x = LANE; right.pairId = id;
    left.op = makeOp(rng, config.gateStrength, ramp, bothSame ? rng.chance(0.5) : leftGood);
    right.op = makeOp(rng, config.gateStrength, ramp, bothSame ? rng.chance(0.5) : !leftGood);
    out.push(left, right);
    return out;
  },

  project(p, cam) {
    const zz = Math.max(p.z, 0);
    const s = 1 / (1 + zz * 0.055);
    const horizonY = cam.H * HORIZON_Y;
    const groundY = cam.H * 0.92;
    return {
      x: cam.W / 2 + p.x * cam.W * TRACK * s,
      y: horizonY + (groundY - horizonY) * s,
      scale: s,
    };
  },

  perceive(agent, objects) {
    // Nearest unconsumed gate pair.
    let pair = null, bestZ = Infinity;
    const pairs = new Map();
    for (const o of objects) {
      if (o.kind !== 'gate' || o.consumed || o.z <= 0) continue;
      let g = pairs.get(o.pairId);
      if (!g) { g = {}; pairs.set(o.pairId, g); }
      g[o.side] = o;
    }
    for (const g of pairs.values()) {
      if (!g.L || !g.R) continue;
      const z = Math.min(g.L.z, g.R.z);
      if (z < bestZ) { bestZ = z; pair = g; }
    }
    agent._pair = pair;
    if (!pair) return { values: { L: agent.count, R: agent.count } };
    return {
      values: {
        L: applyOp(agent.count, pair.L.op),
        R: applyOp(agent.count, pair.R.op),
      },
    };
  },

  legalActions() {
    return [{ key: 'L' }, { key: 'R' }];
  },

  applyAction(agent, action, dt) {
    const base = action.key === 'L' ? -LANE : action.key === 'R' ? LANE : 0;
    agent.targetX = Math.max(-0.85, Math.min(0.85, base + (action.jitter || 0) * 0.3));
    agent.x += (agent.targetX - agent.x) * Math.min(1, dt * 6);
    agent.lastKey = action.key;
  },

  resolve(agent, objects, config, rng) {
    // Auto-fire: nearest obstacle in range loses hp proportional to crowd size.
    let target = null, tz = Infinity;
    for (const o of objects) {
      if (o.kind === 'obstacle' && !o.dead && o.z > 0 && o.z < 26 && o.z < tz) { tz = o.z; target = o; }
    }
    if (target) target.hp -= agent.count * 1.6 * (1 / 60);

    for (const o of objects) {
      if (o.z > 0) continue;
      if (o.kind === 'gate' && !o.consumed) {
        const matched = (o.side === 'L' && agent.x < 0) || (o.side === 'R' && agent.x >= 0);
        if (matched) agent.count = Math.round(applyOp(agent.count, o.op));
        o.consumed = true; o.dead = true;
      } else if (o.kind === 'obstacle' && !o.dead) {
        if (o.hp > 0 && Math.abs(o.x - agent.x) < 0.45) agent.count -= o.damage;
        o.dead = true;
      }
    }
    agent.count = Math.max(0, Math.min(99999, agent.count));
    if (agent.count <= 0) agent.dead = true;
  },

  isDead(agent) { return agent.dead || agent.count <= 0; },

  render(ctx, world, cam, config) {
    const c = config.colors;
    const W = cam.W, H = cam.H;

    // Sky + water
    ctx.fillStyle = c.sky;
    ctx.fillRect(0, 0, W, H * HORIZON_Y);
    const water = ctx.createLinearGradient(0, H * HORIZON_Y, 0, H);
    water.addColorStop(0, c.sky);
    water.addColorStop(1, '#1d7fb0');
    ctx.fillStyle = water;
    ctx.fillRect(0, H * HORIZON_Y, W, H);

    // Bridge deck (perspective trapezoid)
    const nl = cam.project({ x: -1.05, z: 0 }), nr = cam.project({ x: 1.05, z: 0 });
    const fl = cam.project({ x: -1.05, z: HORIZON_Z }), fr = cam.project({ x: 1.05, z: HORIZON_Z });
    ctx.fillStyle = c.track;
    ctx.beginPath();
    ctx.moveTo(nl.x, nl.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(fl.x, fl.y);
    ctx.closePath(); ctx.fill();
    // Rails
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(nl.x, nl.y); ctx.lineTo(fl.x, fl.y);
    ctx.moveTo(nr.x, nr.y); ctx.lineTo(fr.x, fr.y); ctx.stroke();

    // World objects, far to near
    const objs = world.objects.slice().sort((a, b) => b.z - a.z);
    for (const o of objs) {
      if (o.z < -2) continue;
      const p = cam.project({ x: o.x, z: o.z });
      if (o.kind === 'gate') {
        const good = isGood(o.op);
        const w = W * 0.34 * p.scale;
        const h = H * 0.42 * p.scale;
        ctx.fillStyle = good ? hexA(c.gateGood, 0.78) : hexA(c.gateBad, 0.78);
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = `900 ${Math.max(10, h * 0.34)}px "Arial Black", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(opLabel(o.op), p.x, p.y - h * 0.5);
      } else if (o.kind === 'obstacle') {
        const w = W * 0.12 * p.scale, h = H * 0.16 * p.scale;
        ctx.fillStyle = o.hp > 0 ? '#3a3f46' : 'rgba(58,63,70,0.25)';
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);
        if (o.hp > 0) {
          ctx.fillStyle = c.gateBad;
          ctx.fillRect(p.x - w / 2, p.y - h - 4, w * (o.hp / o.maxHp), 3);
        }
      }
    }

    // Crowd near the camera
    drawCrowd(ctx, world.agent, cam, config);
  },

  telemetry(agent, action) {
    let decision = 'hold';
    if (agent._pair && action) {
      const chosen = action.key === 'L' ? agent._pair.L.op : agent._pair.R.op;
      const other = action.key === 'L' ? agent._pair.R.op : agent._pair.L.op;
      decision = `gate ${opLabel(chosen)} over ${opLabel(other)}`;
    }
    return { decision, agent: agent.count };
  },

  release(o) {
    if (o.kind === 'gate') gatePool.release(o);
    else if (o.kind === 'obstacle') obsPool.release(o);
  },
};

function drawCrowd(ctx, agent, cam, config) {
  const c = config.colors;
  const cap = config.maxSprites;
  const shown = Math.min(cap, Math.max(1, agent.count));
  const base = cam.project({ x: agent.x, z: 1.0 });
  const figH = cam.H * 0.12;
  // arrange figures in a small block around the agent lane
  const cols = Math.min(8, Math.ceil(Math.sqrt(shown)));
  const rows = Math.ceil(shown / cols);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols && n < shown; col++, n++) {
      const ox = (col - (cols - 1) / 2) * figH * 0.5;
      const oy = (r - (rows - 1) / 2) * figH * 0.28;
      drawFigure(ctx, base.x + ox, base.y + oy, figH * (1 - r * 0.03), c.crowd);
    }
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 4;
  ctx.font = `900 ${cam.H * 0.07}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const label = String(Math.floor(agent.count));
  ctx.strokeText(label, base.x, base.y - figH);
  ctx.fillText(label, base.x, base.y - figH);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
