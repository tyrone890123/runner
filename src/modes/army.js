// Army Battle (Last War–style) — a squad of U units advances up a top-down
// field through operator gates and enemy waves. Simple HP trade (SPEC §4.2):
// the squad auto-fires only into its *current* lane; enemies that reach the
// line in that lane cost units (others are dodged). The AI steers toward the
// better gate / emptier lane.

import { HORIZON_Z } from '../engine.js';
import { createPool } from '../pool.js';

const LANE = 0.55;

const gatePool = createPool(() => ({ kind: 'gate' }), (o) => { o.consumed = false; o.dead = false; });
const enemyPool = createPool(() => ({ kind: 'enemy' }), (o) => { o.dead = false; });

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
function opLabel(op) { return ({ add: '+', sub: '−', mul: '×', div: '÷' }[op.type]) + op.val; }
function isGood(op) { return op.type === 'add' || op.type === 'mul'; }

function makeOp(rng, strength, ramp, good) {
  if (good) {
    if (rng.chance(0.55)) return { type: 'add', val: Math.max(1, Math.round(rng.range(2, 5 * strength) * ramp)) };
    return { type: 'mul', val: strength >= 1.5 && rng.chance(0.4) ? 3 : 2 };
  }
  if (rng.chance(0.6)) return { type: 'sub', val: Math.max(1, Math.round(rng.range(2, 6 * strength) * ramp)) };
  return { type: 'div', val: 2 };
}

export const army = {
  id: 'army',
  label: 'Army Battle',

  init(world, config, rng, agent) {
    const a = agent || {};
    a.count = config.startSquad;
    a.x = 0;
    a.targetX = 0;
    a.dead = false;
    a._gate = null;
    a.fireFx = null;
    if (!agent) { for (const o of world.objects) this.release(o); world.objects.length = 0; }
    return a;
  },

  spawnAhead(z, config, rng, ramp) {
    const out = [];
    const r = rng.float();
    if (r < 0.45 * config.enemyDensity) {
      // enemy cluster in one lane
      const e = enemyPool.acquire();
      e.x = rng.pick([-LANE, 0, LANE]) + rng.range(-0.1, 0.1);
      e.size = Math.max(1, Math.round(rng.range(2, 6) * ramp));
      e.maxHp = Math.round((2 + 2.5 * ramp) * e.size);
      e.hp = e.maxHp;
      out.push(e);
    } else {
      const id = ++pairId;
      const leftGood = rng.chance(0.5);
      const L = gatePool.acquire(), R = gatePool.acquire();
      L.side = 'L'; L.x = -LANE; L.pairId = id; L.op = makeOp(rng, config.armyGateStrength, ramp, leftGood);
      R.side = 'R'; R.x = LANE; R.pairId = id; R.op = makeOp(rng, config.armyGateStrength, ramp, !leftGood);
      out.push(L, R);
    }
    return out;
  },

  project(p, cam) {
    const t = Math.max(0, Math.min(1, p.z / HORIZON_Z));
    const topY = cam.H * 0.06, botY = cam.H * 0.88;
    const s = 1 - 0.45 * t;
    return { x: cam.W / 2 + p.x * cam.W * 0.40 * s, y: botY + (topY - botY) * t, scale: s };
  },

  perceive(agent, objects) {
    const cands = { L: -LANE, C: 0, R: LANE };
    const values = {};
    let nearGate = null, ngz = Infinity;
    for (const key in cands) {
      const cx = cands[key];
      let gateVal = agent.count, threat = 0;
      for (const o of objects) {
        if (o.z <= 0) continue;
        if (o.kind === 'gate' && !o.consumed && Math.abs(o.x - cx) < 0.32) {
          gateVal = applyOp(agent.count, o.op);
          if (o.z < ngz) { ngz = o.z; nearGate = o; }
        } else if (o.kind === 'enemy' && !o.dead && Math.abs(o.x - cx) < 0.32 && o.z < 30) {
          threat += o.hp;
        }
      }
      values[key] = gateVal - threat * 0.4;
    }
    agent._gate = nearGate;
    return { values };
  },

  legalActions() {
    return [{ key: 'L', x: -LANE }, { key: 'C', x: 0 }, { key: 'R', x: LANE }];
  },

  applyAction(agent, action, dt) {
    const base = (action.x || 0) + (action.jitter || 0) * 0.3;
    agent.targetX = Math.max(-0.8, Math.min(0.8, base));
    agent.x += (agent.targetX - agent.x) * Math.min(1, dt * 5);
    agent.lastKey = action.key;
  },

  resolve(agent, objects, config) {
    // Auto-fire: the squad only engages enemies in its *current* lane. Enemies
    // in other lanes are neither shot nor a threat — steering decides what the
    // guns can reach.
    let laneTgt = null, ltz = Infinity;
    for (const o of objects) {
      if (o.kind !== 'enemy' || o.dead || o.z <= 0) continue;
      if (Math.abs(o.x - agent.x) < 0.32 && o.z < ltz) { ltz = o.z; laneTgt = o; }
    }
    if (laneTgt) {
      laneTgt.hp -= agent.count * config.unitDamage * (1 / 60);
      agent.fireFx = laneTgt;
      if (laneTgt.hp <= 0) laneTgt.dead = true;
    } else {
      agent.fireFx = null;
    }

    for (const o of objects) {
      if (o.z > 0) continue;
      if (o.kind === 'gate' && !o.consumed) {
        const matched = (o.side === 'L' && agent.x < 0) || (o.side === 'R' && agent.x >= 0);
        if (matched) agent.count = Math.round(applyOp(agent.count, o.op));
        o.consumed = true; o.dead = true;
      } else if (o.kind === 'enemy' && !o.dead) {
        // Only enemies that reach the line in the squad's lane trade HP; ones in
        // other lanes were dodged. Steering (AI skill) therefore matters.
        if (Math.abs(o.x - agent.x) < 0.32) {
          agent.count -= Math.max(1, Math.ceil(o.hp / config.unitHp));
        }
        o.dead = true;
      }
    }
    agent.count = Math.max(0, Math.min(9999, agent.count));
    if (agent.count <= 0) agent.dead = true;
  },

  isDead(agent) { return agent.dead || agent.count <= 0; },

  render(ctx, world, cam, config) {
    const c = config.colors, W = cam.W, H = cam.H;
    const agent = world.agent;

    // Field
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3a4a2e');
    g.addColorStop(1, '#52663f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Scrolling turf rows convey the advance.
    drawRows(ctx, cam, world.distance, 'rgba(255,255,255,0.05)', 6);
    // Lane guides
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    for (const lx of [-LANE, 0, LANE]) {
      const a = cam.project({ x: lx, z: 0 }), b = cam.project({ x: lx, z: HORIZON_Z });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Highlight the squad's firing lane.
    const ha = cam.project({ x: agent.x - 0.16, z: 0 }), hb = cam.project({ x: agent.x + 0.16, z: 0 });
    const hc = cam.project({ x: agent.x + 0.09, z: 22 }), hd = cam.project({ x: agent.x - 0.09, z: 22 });
    ctx.fillStyle = hexA(c.unit, 0.12);
    ctx.beginPath();
    ctx.moveTo(ha.x, ha.y); ctx.lineTo(hb.x, hb.y); ctx.lineTo(hc.x, hc.y); ctx.lineTo(hd.x, hd.y);
    ctx.closePath(); ctx.fill();

    const objs = world.objects.slice().sort((a, b) => b.z - a.z);
    for (const o of objs) {
      if (o.z < -2) continue;
      const p = cam.project({ x: o.x, z: o.z });
      if (o.kind === 'gate') {
        const good = isGood(o.op);
        const col = good ? c.gateGood : c.gateBad;
        const w = W * 0.3 * p.scale, h = H * 0.05 * p.scale + 10;
        const x = p.x - w / 2, y = p.y - h / 2;
        ctx.fillStyle = hexA(col, 0.55); ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 3 * p.scale); ctx.strokeRect(x, y, w, h);
        const fs = Math.max(11, h * 0.8);
        ctx.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.fillText(opLabel(o.op), p.x, p.y);
      } else if (o.kind === 'enemy' && !o.dead) {
        drawCluster(ctx, p, o.size, c.enemy);
        const top = p.y - 18 * p.scale - 10;
        const bw = 26 * p.scale + 14;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p.x - bw / 2, top, bw, 4);
        ctx.fillStyle = c.gateBad; ctx.fillRect(p.x - bw / 2, top, bw * (o.hp / o.maxHp), 4);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
        ctx.font = `900 ${Math.max(11, 20 * p.scale)}px "Arial Black", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.strokeText(String(o.size), p.x, top - 2);
        ctx.fillText(String(o.size), p.x, top - 2);
      }
    }

    // Bullets streaming up the firing lane.
    if (agent.fireFx && !agent.fireFx.dead) {
      const from = cam.project({ x: agent.x, z: 1 });
      const to = cam.project({ x: agent.fireFx.x, z: agent.fireFx.z });
      drawTracers(ctx, from, to, world.time, c.gold);
    }

    // Squad
    const sp = cam.project({ x: agent.x, z: 1 });
    drawCluster(ctx, sp, Math.min(60, agent.count), c.unit);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4;
    ctx.font = `900 ${H * 0.06}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const label = String(Math.floor(agent.count));
    ctx.strokeText(label, sp.x, sp.y - 44);
    ctx.fillText(label, sp.x, sp.y - 44);
  },

  telemetry(agent, action) {
    let decision = 'advance';
    if (agent._gate && action) {
      decision = `lane ${action.key} ▸ ${opLabel(agent._gate.op)}`;
    }
    return { decision, agent: agent.count };
  },

  release(o) {
    if (o.kind === 'gate') gatePool.release(o);
    else if (o.kind === 'enemy') enemyPool.release(o);
  },
};

function drawCluster(ctx, p, n, color) {
  const shown = Math.min(40, Math.max(1, n));
  const cols = Math.min(7, Math.ceil(Math.sqrt(shown)));
  const rows = Math.ceil(shown / cols);
  const r = Math.max(2.5, 7 * p.scale);
  // grouped ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + r * 0.8, cols * r * 1.3, rows * r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const light = shade(color, 1.25), dark = shade(color, 0.7);
  let k = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols && k < shown; col++, k++) {
      const ox = (col - (cols - 1) / 2) * r * 2.2;
      const oy = (row - (rows - 1) / 2) * r * 2.2;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(p.x + ox, p.y + oy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(p.x + ox - r * 0.3, p.y + oy - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Cross-field rows that scroll toward the squad to convey forward motion.
function drawRows(ctx, cam, dist, color, spacing) {
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  const off = ((dist % spacing) + spacing) % spacing;
  for (let rz = HORIZON_Z - off; rz > 0.3; rz -= spacing) {
    const a = cam.project({ x: -1.05, z: rz }), b = cam.project({ x: 1.05, z: rz });
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
}

function drawTracers(ctx, from, to, time, color) {
  for (let k = 0; k < 4; k++) {
    const f = (time * 3.2 + k / 4) % 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // muzzle flash + impact
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.arc(from.x, from.y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hexA(color, 0.9);
  ctx.beginPath(); ctx.arc(to.x, to.y, 4 + 2 * Math.abs(Math.sin(time * 18)), 0, Math.PI * 2); ctx.fill();
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
