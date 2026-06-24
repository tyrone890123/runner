// Config schema + URL query (de)serialization. The URL is the canonical store
// (SPEC §6) so a setup is shareable and survives a sandboxed iframe where
// localStorage is blocked. Nothing core depends on localStorage.

export const MODES = ['bridge', 'army', 'runner'];

export const THEMES = {
  plastic: {
    label: 'Plastic',
    sky: '#36B6F0', track: '#C9CDD2', gateGood: '#19D26B', gateBad: '#F5333F',
    gold: '#FFC02E', unit: '#2F6BFF', enemy: '#F5333F', crowd: '#E8533A',
    ink: '#10202b',
  },
  sunset: {
    label: 'Sunset',
    sky: '#FF8A5B', track: '#E7D8C9', gateGood: '#2BD4A8', gateBad: '#E23E57',
    gold: '#FFD23F', unit: '#5B5BFF', enemy: '#E23E57', crowd: '#7A3B69',
    ink: '#2a1320',
  },
  mono: {
    label: 'Mono',
    sky: '#9AA7B0', track: '#D7DCE0', gateGood: '#3BA776', gateBad: '#C2433F',
    gold: '#C9A24B', unit: '#3A4756', enemy: '#C2433F', crowd: '#4A5563',
    ink: '#1a1f24',
  },
};

// Each field: key (config name), url (short query key), type, range, default,
// group ('global' or a mode id), and a human label for the panel.
export const SCHEMA = [
  // --- global ---
  { key: 'mode', url: 'm', type: 'select', options: MODES, def: 'bridge', group: 'global', label: 'Mode' },
  { key: 'autocycle', url: 'ac', type: 'bool', def: false, group: 'global', label: 'Auto-cycle modes' },
  { key: 'cycleInterval', url: 'ci', type: 'range', min: 5, max: 60, step: 1, def: 20, group: 'global', label: 'Cycle interval (s)' },
  { key: 'speed', url: 'spd', type: 'range', min: 0.25, max: 3, step: 0.05, def: 1, group: 'global', label: 'Game speed' },
  { key: 'ai', url: 'ai', type: 'range', min: 0, max: 100, step: 1, def: 65, group: 'global', label: 'AI skill' },
  { key: 'density', url: 'den', type: 'range', min: 0.3, max: 3, step: 0.05, def: 1, group: 'global', label: 'Spawn density' },
  { key: 'difficulty', url: 'dif', type: 'range', min: 0, max: 2, step: 0.05, def: 0.6, group: 'global', label: 'Difficulty ramp' },
  { key: 'theme', url: 'th', type: 'select', options: Object.keys(THEMES), def: 'plastic', group: 'global', label: 'Palette' },
  { key: 'reduceMotion', url: 'rm', type: 'bool', def: false, group: 'global', label: 'Reduced motion' },
  { key: 'paused', url: 'ps', type: 'bool', def: false, group: 'global', label: 'Pause' },
  { key: 'seed', url: 'sd', type: 'int', min: 1, max: 999999, def: 1337, group: 'global', label: 'Seed' },

  // --- bridge ---
  { key: 'startCrowd', url: 'sc', type: 'range', min: 1, max: 80, step: 1, def: 20, group: 'bridge', label: 'Start crowd' },
  { key: 'maxSprites', url: 'ms', type: 'range', min: 10, max: 120, step: 1, def: 80, group: 'bridge', label: 'Max sprites' },
  { key: 'gateStrength', url: 'gs', type: 'range', min: 1, max: 3, step: 0.1, def: 1.6, group: 'bridge', label: 'Gate strength' },
  { key: 'gateSpacing', url: 'gsp', type: 'range', min: 0.6, max: 2, step: 0.1, def: 1, group: 'bridge', label: 'Gate spacing' },

  // --- army ---
  { key: 'startSquad', url: 'sq', type: 'range', min: 1, max: 60, step: 1, def: 12, group: 'army', label: 'Start squad' },
  { key: 'enemyDensity', url: 'ed', type: 'range', min: 0.3, max: 3, step: 0.05, def: 1, group: 'army', label: 'Enemy frequency' },
  { key: 'allyFreq', url: 'al', type: 'range', min: 0, max: 2, step: 0.05, def: 0.8, group: 'army', label: 'Ally frequency' },
  { key: 'armyGateStrength', url: 'ags', type: 'range', min: 1, max: 3, step: 0.1, def: 1.6, group: 'army', label: 'Gate strength' },

  // --- runner ---
  { key: 'laneCount', url: 'lc', type: 'range', min: 2, max: 5, step: 1, def: 3, group: 'runner', label: 'Lane count' },
  { key: 'obstacleFreq', url: 'of', type: 'range', min: 0.4, max: 3, step: 0.05, def: 1, group: 'runner', label: 'Obstacle frequency' },
  { key: 'jumpSlide', url: 'js', type: 'bool', def: true, group: 'runner', label: 'Jump / slide enabled' },
  { key: 'lives', url: 'lv', type: 'bool', def: false, group: 'runner', label: 'Use lives (3)' },
];

const BY_URL = Object.fromEntries(SCHEMA.map((f) => [f.url, f]));

function coerce(field, raw) {
  switch (field.type) {
    case 'bool': return raw === '1' || raw === 'true';
    case 'int': return Math.round(Number(raw));
    case 'range': return Number(raw);
    case 'select': return field.options.includes(raw) ? raw : field.def;
    default: return raw;
  }
}

function clampField(field, val) {
  if (field.type === 'range' || field.type === 'int') {
    if (Number.isNaN(val)) return field.def;
    if (field.min != null) val = Math.max(field.min, val);
    if (field.max != null) val = Math.min(field.max, val);
  }
  return val;
}

export function defaultConfig() {
  const cfg = {};
  for (const f of SCHEMA) cfg[f.key] = f.def;
  return cfg;
}

export function loadConfig(search = location.search) {
  const cfg = defaultConfig();
  const params = new URLSearchParams(search);
  for (const [url, raw] of params) {
    const field = BY_URL[url];
    if (!field) continue;
    cfg[field.key] = clampField(field, coerce(field, raw));
  }
  // Reduced motion honors the OS preference unless overridden in the URL.
  if (!params.has('rm') && typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cfg.reduceMotion = true;
  }
  return cfg;
}

// Serialize only values that differ from defaults to keep links short.
export function toQuery(cfg) {
  const params = new URLSearchParams();
  for (const f of SCHEMA) {
    const v = cfg[f.key];
    if (v === f.def) continue;
    params.set(f.url, f.type === 'bool' ? (v ? '1' : '0') : String(v));
  }
  return params.toString();
}

let writeTimer = 0;
export function writeUrl(cfg) {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const q = toQuery(cfg);
    const url = q ? `${location.pathname}?${q}` : location.pathname;
    history.replaceState(null, '', url);
  }, 150);
}

export function resolveTheme(cfg) {
  return THEMES[cfg.theme] || THEMES.plastic;
}
