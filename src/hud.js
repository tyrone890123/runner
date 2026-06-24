// Operator telemetry strip — the signature element (SPEC §7). Surfaces *what
// the AI is deciding right now* plus distance, agent count and FPS. Rendered as
// DOM (not on the canvas) so the numeric readouts stay crisp; the one-canvas
// constraint is about world objects, not chrome.

export function createHud(root) {
  root.innerHTML = `
    <div class="hud-cell hud-decision">
      <span class="hud-label">AI ▸</span>
      <span class="hud-value" data-f="decision">idle</span>
      <span class="hud-conf" data-f="conf"></span>
    </div>
    <div class="hud-cell"><span class="hud-label">AGENT</span><span class="hud-value" data-f="agent">—</span></div>
    <div class="hud-cell"><span class="hud-label">DIST</span><span class="hud-value" data-f="dist">0</span></div>
    <div class="hud-cell"><span class="hud-label">OBJ</span><span class="hud-value" data-f="obj">0</span></div>
    <div class="hud-cell"><span class="hud-label">RESP</span><span class="hud-value" data-f="resp">0</span></div>
    <div class="hud-cell"><span class="hud-label">FPS</span><span class="hud-value" data-f="fps">—</span></div>
    <button class="hud-hide icon-btn" type="button" data-hud-hide aria-label="Hide stats" title="Hide stats">✕</button>
  `;
  const els = {};
  root.querySelectorAll('[data-f]').forEach((el) => { els[el.dataset.f] = el; });

  let lastDecision = '';
  function flash(el) {
    el.classList.remove('hud-flash');
    // force reflow so the animation restarts
    void el.offsetWidth;
    el.classList.add('hud-flash');
  }

  return {
    update(t, reduceMotion) {
      const decision = t.decision || 'idle';
      if (decision !== lastDecision) {
        els.decision.textContent = decision;
        lastDecision = decision;
        if (!reduceMotion) flash(els.decision);
      }
      els.conf.textContent = t.confidence != null ? `conf ${t.confidence.toFixed(2)}` : '';
      els.agent.textContent = t.agent != null ? t.agent : '—';
      els.dist.textContent = `${Math.floor(t.dist || 0)}m`;
      els.obj.textContent = t.objects != null ? t.objects : 0;
      els.resp.textContent = t.respawns != null ? t.respawns : 0;
      els.fps.textContent = t.fps != null ? Math.round(t.fps) : '—';
    },
  };
}
