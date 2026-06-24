// Generic autonomous policy. The mode supplies *what is legal* and *what is
// seen* (with a value per action); ai.js decides *how well* it plays. Skill
// (0-100) maps to three knobs (SPEC §5):
//   - reaction latency: how long before it adopts a new best action
//   - optimal-choice probability: best action vs. a random legal one
//   - precision error: steering/aim jitter
// The AI never inspects world state directly; it only sees `inputs` and `legal`.

export function createAI() {
  let reactTimer = 0;
  let committed = null;

  function knobs(skill) {
    const n = Math.max(0, Math.min(100, skill)) / 100;
    return {
      latency: 0.6 - 0.55 * n,      // 0.60s (sluggish) -> 0.05s (sharp)
      optimalProb: 0.40 + 0.58 * n, // 0.40 (coin-floppy) -> 0.98 (decisive)
      precision: 0.45 - 0.43 * n,   // 0.45 (shaky) -> 0.02 (steady)
    };
  }

  return {
    reset() { reactTimer = 0; committed = null; },

    decide(inputs, legal, skill, dt, rng) {
      if (!legal || legal.length === 0) return { key: null, jitter: 0, confidence: 0 };
      const { latency, optimalProb, precision } = knobs(skill);
      const values = (inputs && inputs.values) || {};
      reactTimer -= dt;

      const stillLegal = committed && legal.some((a) => a.key === committed.key);
      const reactNow = !stillLegal || reactTimer <= 0;

      if (reactNow) {
        reactTimer = latency;

        let best = legal[0], bestV = -Infinity, second = -Infinity;
        for (const a of legal) {
          const v = values[a.key] != null ? values[a.key] : 0;
          if (v > bestV) { second = bestV; bestV = v; best = a; }
          else if (v > second) { second = v; }
        }

        const chosen = rng.chance(optimalProb)
          ? best
          : legal[rng.int(0, legal.length - 1)];

        // Confidence rises with skill and with how decisively the best option
        // beats the runner-up — surfaced on the HUD, not used by the sim.
        const spread = bestV > second && isFinite(second)
          ? Math.min(1, (bestV - second) / (Math.abs(bestV) + 1))
          : 0.3;
        const confidence = Math.max(0.05, Math.min(0.99, optimalProb * (0.6 + 0.4 * spread)));

        committed = {
          ...chosen,
          jitter: (rng.float() * 2 - 1) * precision,
          confidence,
        };
      }

      return committed;
    },
  };
}
