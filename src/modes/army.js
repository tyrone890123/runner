// Army Battle (Last War–style) — a squad of U units advances up the field,
// drawn in one-point perspective like Bridge/Lane runner (the field recedes to
// a horizon with the enemy HQ on it). No guns (that overlaps with Bridge
// Runner's auto-fire): clusters are resolved by *count on contact*.
//   - Red enemy clusters: if U > E you swarm/wrap them and win (losing E units);
//     if they're bigger you're overrun → respawn.
//   - Blue allied clusters (same colour as the squad): they join — U += A.
//   - Operator gates (+ − × ÷): modify U en route.
// The AI steers to recruit allies, take growth gates, swarm smaller enemies,
// and flee bigger ones.

import { HORIZON_Z } from '../engine.js';
import { createPool } from '../pool.js';

const LANE = 0.55;
const BAND = 0.30;       // how close in x a cluster must be to clash with the squad
const HORIZON_Y = 0.22;  // where the field meets the sky (screen fraction)

const gatePool = createPool(() => ({ kind: 'gate' }), (o) => { o.consumed = false; o.dead = false; });
const enemyPool = createPool(() => ({ kind: 'enemy' }), (o) => { o.dead = false; });
const allyPool = createPool(() => ({ kind: 'ally' }), (o) => { o.dead = false; });
const burstPool = createPool(() => ({ kind: 'burst' }), (o) => { o.dead = false; });

let pairId = 0;
// Last seen squad size, so waves scale to the army (keeps the swarm-or-flee
// decision live instead of letting the squad snowball past all threat).
let scaleRef = 12;

function spawnBurst(objects, x, z, size, color) {
  const b = burstPool.acquire();
  b.x = x; b.z = z; b.life = 0.4; b.maxLife = 0.4; b.size = size; b.color = color;
  objects.push(b);
}

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
    a._lanes = null;
    scaleRef = config.startSquad;
    if (!agent) { for (const o of world.objects) this.release(o); world.objects.length = 0; }
    return a;
  },

  spawnAhead(z, config, rng, ramp) {
    const out = [];
    const r = rng.float();
    const enemyW = 0.4 * config.enemyDensity;
    const allyW = 0.3 * config.allyFreq;
    const ref = Math.max(4, scaleRef);
    if (r < enemyW) {
      const e = enemyPool.acquire();
      e.x = rng.pick([-LANE, 0, LANE]) + rng.range(-0.08, 0.08);
      // Roughly proportional to the army; difficulty skews waves bigger so they
      // more often exceed U (a clash that must be fled, not swarmed).
      e.count = Math.max(2, Math.round(ref * rng.range(0.45, 1.1 + 0.25 * config.difficulty)));
      out.push(e);
    } else if (r < enemyW + allyW) {
      const a = allyPool.acquire();
      a.x = rng.pick([-LANE, 0, LANE]) + rng.range(-0.08, 0.08);
      a.count = Math.max(1, Math.round(ref * rng.range(0.15, 0.4)));
      out.push(a);
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

  // One-point perspective like Bridge/Lane runner: the field recedes to a
  // horizon, objects spawn small far away and grow as they near the squad.
  project(p, cam) {
    const zz = Math.max(p.z, 0);
    const s = 1 / (1 + zz * 0.05);
    const horizonY = cam.H * HORIZON_Y, groundY = cam.H * 0.9;
    return {
      x: cam.W / 2 + p.x * cam.W * 0.46 * s,
      y: horizonY + (groundY - horizonY) * s,
      scale: s,
    };
  },

  perceive(agent, objects) {
    const cands = { L: -LANE, C: 0, R: LANE };
    const info = {}, values = {};
    for (const key in cands) {
      const cx = cands[key];
      let near = null, nz = Infinity;
      for (const o of objects) {
        if (o.z <= 0 || o.dead || o.kind === 'burst') continue;
        const band = o.kind === 'gate' ? 0.32 : BAND;
        if (Math.abs(o.x - cx) >= band) continue;
        if (o.z < nz) { nz = o.z; near = o; }
      }
      info[key] = near;
      // Estimate the squad size after committing to this lane's nearest object.
      let est = agent.count;
      if (near) {
        if (near.kind === 'gate') est = applyOp(agent.count, near.op);
        else if (near.kind === 'ally') est = agent.count + near.count;
        else if (near.kind === 'enemy') est = agent.count > near.count ? agent.count - near.count : -100;
      }
      values[key] = est;
    }
    agent._lanes = info;
    scaleRef = agent.count;
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

  resolve(agent, objects) {
    for (const o of objects) {
      if (o.kind === 'burst') { o.life -= 1 / 60; if (o.life <= 0) o.dead = true; continue; }
      if (o.z > 0 || o.dead) continue;
      if (o.kind === 'gate' && !o.consumed) {
        const matched = (o.side === 'L' && agent.x < 0) || (o.side === 'R' && agent.x >= 0);
        if (matched) agent.count = Math.round(applyOp(agent.count, o.op));
        o.consumed = true; o.dead = true;
      } else if (o.kind === 'ally') {
        // Same colour as the squad: they join.
        if (Math.abs(o.x - agent.x) < BAND) { agent.count += o.count; spawnBurst(objects, o.x, 1, o.count, 'ally'); }
        o.dead = true;
      } else if (o.kind === 'enemy') {
        // Count battle: the bigger force wins; a clash in another lane is dodged.
        if (Math.abs(o.x - agent.x) < BAND) {
          if (agent.count > o.count) { agent.count -= o.count; spawnBurst(objects, o.x, 1, o.count, 'win'); }
          else { agent.count = 0; spawnBurst(objects, o.x, 1, o.count, 'lose'); }
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

    // Sky/backdrop above the horizon, hazy ground receding below it.
    const horizonY = H * HORIZON_Y;
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#aebfd0');
    sky.addColorStop(1, '#cdd6c2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY);
    const g = ctx.createLinearGradient(0, horizonY, 0, H);
    g.addColorStop(0, '#5d6e42');
    g.addColorStop(1, '#3a4a2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    drawRows(ctx, cam, world.distance, 'rgba(0,0,0,0.10)', 6);
    drawHQ(ctx, cam, c);
    // Lane guides converge toward the horizon.
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    for (const lx of [-LANE, 0, LANE]) {
      const a = cam.project({ x: lx, z: 0 }), b = cam.project({ x: lx, z: HORIZON_Z });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Highlight the squad's current lane (where clashes happen).
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
        const col = isGood(o.op) ? c.gateGood : c.gateBad;
        const w = W * 0.3 * p.scale, h = H * 0.05 * p.scale + 10;
        const x = p.x - w / 2, y = p.y - h / 2;
        ctx.fillStyle = hexA(col, 0.55); ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 3 * p.scale); ctx.strokeRect(x, y, w, h);
        ctx.font = `900 ${Math.max(11, h * 0.8)}px "Arial Black", Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.fillText(opLabel(o.op), p.x, p.y);
      } else if (o.kind === 'enemy' && !o.dead) {
        // Squad units wrap around an enemy as it's about to be engaged.
        if (Math.abs(o.x - agent.x) < BAND && o.z < 8 && agent.count > o.count) drawWrap(ctx, p, c.unit);
        drawCluster(ctx, p, o.count, c.enemy);
        clusterLabel(ctx, p, String(o.count), '#fff');
      } else if (o.kind === 'ally' && !o.dead) {
        drawCluster(ctx, p, o.count, c.unit);
        // green ring marks them as joinable
        ctx.strokeStyle = c.gateGood; ctx.lineWidth = Math.max(2, 2.5 * p.scale);
        ctx.beginPath(); ctx.arc(p.x, p.y, (14 + o.count) * p.scale, 0, Math.PI * 2); ctx.stroke();
        clusterLabel(ctx, p, '+' + o.count, c.gateGood);
      } else if (o.kind === 'burst') {
        const t = 1 - o.life / o.maxLife;
        const col = o.color === 'ally' ? c.gateGood : o.color === 'lose' ? c.gateBad : c.gold;
        const r = (10 + (o.size || 3) * 3) * p.scale * (0.5 + t);
        ctx.strokeStyle = hexA(col, 1 - t); ctx.lineWidth = 3 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = hexA('#ffffff', (1 - t) * 0.6);
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2); ctx.fill();
      }
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
    if (action && agent._lanes) {
      const o = agent._lanes[action.key];
      if (o) {
        if (o.kind === 'gate') decision = `lane ${action.key} ▸ ${opLabel(o.op)}`;
        else if (o.kind === 'ally') decision = `recruit +${o.count}`;
        else if (o.kind === 'enemy') {
          decision = agent.count > o.count ? `swarm ${o.count} (we ${agent.count})` : `flee ${o.count}!`;
        }
      }
    }
    return { decision, agent: agent.count };
  },

  release(o) {
    if (o.kind === 'gate') gatePool.release(o);
    else if (o.kind === 'enemy') enemyPool.release(o);
    else if (o.kind === 'ally') allyPool.release(o);
    else if (o.kind === 'burst') burstPool.release(o);
  },
};

function clusterLabel(ctx, p, text, color) {
  const top = p.y - 18 * p.scale - 8;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
  ctx.font = `900 ${Math.max(11, 20 * p.scale)}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.strokeText(text, p.x, top);
  ctx.fillText(text, p.x, top);
}

// A ring of squad dots flanking a cluster — the "wrap around" before a clash.
function drawWrap(ctx, p, color) {
  const r = 22 * p.scale, dot = Math.max(2, 4 * p.scale);
  ctx.fillStyle = color;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.7, dot, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCluster(ctx, p, n, color) {
  const shown = Math.min(40, Math.max(1, n));
  const cols = Math.min(7, Math.ceil(Math.sqrt(shown)));
  const rows = Math.ceil(shown / cols);
  const r = Math.max(2.5, 7 * p.scale);
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

// Distant enemy stronghold across the far horizon — gives the field a goal.
function drawHQ(ctx, cam, c) {
  const l = cam.project({ x: -1.05, z: HORIZON_Z }), r = cam.project({ x: 1.05, z: HORIZON_Z });
  const w = r.x - l.x, h = cam.H * 0.05;
  const y = l.y - h;
  ctx.fillStyle = '#3a2f33';
  ctx.fillRect(l.x, y, w, h);
  ctx.fillStyle = hexA(c.enemy, 0.5);
  ctx.fillRect(l.x, y, w, h * 0.25);
  ctx.fillStyle = '#3a2f33';
  const n = 9, mw = w / (n * 2);
  for (let i = 0; i < n; i++) ctx.fillRect(l.x + (i * 2 + 0.5) * mw, y - h * 0.4, mw, h * 0.4);
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
