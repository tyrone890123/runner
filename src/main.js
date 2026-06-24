// Bootstraps the engine and wires the operator panel <-> config. The panel
// only ever mutates config (applied live); it never steers the agent.

import { SCHEMA, THEMES, MODES, loadConfig, writeUrl, resolveTheme } from './config.js';
import { createEngine } from './engine.js';
import { createHud } from './hud.js';
import { bridge } from './modes/bridge.js';
import { army } from './modes/army.js';
import { runner } from './modes/runner.js';

const modes = [bridge, army, runner];
const MODE_LABEL = Object.fromEntries(modes.map((m) => [m.id, m.label]));

const config = loadConfig();
const canvas = document.getElementById('game');
const hud = createHud(document.getElementById('hud'));
const engine = createEngine(canvas, config, modes, hud);

// --- DPR-aware canvas sizing -------------------------------------------------
function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (w === 0 || h === 0) return;              // mid-layout (e.g. panel hidden): skip
  if (canvas.width === w && canvas.height === h) return; // unchanged: don't clear
  const ctx = canvas.getContext('2d');
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', fit);
// Re-fit whenever the canvas itself changes size — covers showing/hiding the
// panel, which resizes the canvas via the grid without a window resize event.
if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas);

// --- Panel -------------------------------------------------------------------
const panel = document.getElementById('controls');
const inputs = {};
const groupEls = {};

function optionLabel(field, opt) {
  if (field.key === 'mode') return MODE_LABEL[opt] || opt;
  if (field.key === 'theme') return THEMES[opt] ? THEMES[opt].label : opt;
  return opt;
}

function buildField(field) {
  const row = document.createElement('label');
  row.className = 'ctl';

  const name = document.createElement('span');
  name.className = 'ctl-label';
  name.textContent = field.label;

  let input, valueOut;
  if (field.type === 'bool') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!config[field.key];
    row.classList.add('ctl-bool');
  } else if (field.type === 'select') {
    input = document.createElement('select');
    for (const opt of field.options) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = optionLabel(field, opt);
      input.appendChild(o);
    }
    input.value = config[field.key];
  } else {
    input = document.createElement('input');
    input.type = 'range';
    input.min = field.min; input.max = field.max;
    input.step = field.step != null ? field.step : 1;
    input.value = config[field.key];
    valueOut = document.createElement('output');
    valueOut.className = 'ctl-value';
    valueOut.textContent = config[field.key];
  }
  input.id = `ctl-${field.key}`;
  inputs[field.key] = input;

  input.addEventListener('input', () => {
    let v;
    if (field.type === 'bool') v = input.checked;
    else if (field.type === 'select') v = input.value;
    else v = field.type === 'int' ? Math.round(Number(input.value)) : Number(input.value);
    config[field.key] = v;
    if (valueOut) valueOut.textContent = v;
    writeUrl(config);
    onChange(field, v);
  });

  row.appendChild(name);
  if (valueOut) name.appendChild(valueOut);
  row.appendChild(input);
  return row;
}

function buildPanel() {
  const groups = ['global', ...MODES];
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'ctl-group';
    section.dataset.group = group;
    const h = document.createElement('h2');
    h.textContent = group === 'global' ? 'Global' : MODE_LABEL[group];
    section.appendChild(h);
    for (const f of SCHEMA.filter((f) => f.group === group)) {
      section.appendChild(buildField(f));
    }
    groupEls[group] = section;
    panel.appendChild(section);
  }
  updateGroupVisibility();
}

function updateGroupVisibility() {
  for (const m of MODES) {
    groupEls[m].hidden = m !== config.mode;
  }
}

function onChange(field, value) {
  if (field.key === 'mode') {
    engine.setMode(value);
    updateGroupVisibility();
  } else if (field.key === 'seed') {
    engine.reseed();
  } else if (field.group !== 'global') {
    engine.refresh();
  }
  // global tuning (speed, ai, density, difficulty, theme, pause, motion,
  // autocycle, cycleInterval) is read live by the engine — nothing to do.
}

// Keep the mode selector in sync when auto-cycle advances it.
let lastMode = config.mode;
setInterval(() => {
  if (engine.mode && engine.mode !== lastMode) {
    lastMode = engine.mode;
    config.mode = engine.mode;
    if (inputs.mode) inputs.mode.value = engine.mode;
    updateGroupVisibility();
    writeUrl(config);
  }
}, 250);

// --- Panel hide/show --------------------------------------------------------
const panelHide = document.getElementById('panelHide');
const panelShow = document.getElementById('panelShow');
function setPanelHidden(hidden) {
  document.body.classList.toggle('panel-hidden', hidden);
  panelHide.setAttribute('aria-expanded', String(!hidden));
  panelShow.hidden = !hidden;
  // Canvas client size changed; re-fit the backing store on the next frame.
  requestAnimationFrame(fit);
}
panelHide.addEventListener('click', () => setPanelHidden(true));
panelShow.addEventListener('click', () => setPanelHidden(false));

// --- Stats (HUD) hide/show --------------------------------------------------
const hudHide = document.querySelector('#hud [data-hud-hide]');
const hudShow = document.getElementById('hudShow');
function setHudHidden(hidden) {
  document.body.classList.toggle('hud-hidden', hidden);
  hudShow.hidden = !hidden;
}
if (hudHide) hudHide.addEventListener('click', () => setHudHidden(true));
hudShow.addEventListener('click', () => setHudHidden(false));

buildPanel();
fit();
document.documentElement.style.setProperty('--sky', resolveTheme(config).sky);
engine.start();
