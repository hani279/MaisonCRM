// Minimal analytic spring animator — damping ratio + response, no external deps.
// Mirrors Apple's damping/response spring model (see WWDC "Designing Fluid Interfaces").
window.Spring = (function () {
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // animate({ from, to, velocity, damping, response, precision, onUpdate, onComplete })
  // damping: 1.0 = critically damped (no overshoot). < 1.0 = bouncier.
  // response: seconds to settle — not a fixed duration, just the spring's time constant.
  function animate({
    from,
    to,
    velocity = 0,
    damping = 1,
    response = 0.4,
    precision = 0.005,
    onUpdate,
    onComplete,
  }) {
    if (prefersReducedMotion()) {
      // Reduced motion: jump the logical value immediately; styles.css adds a short
      // CSS cross-fade under @media (prefers-reduced-motion) so it isn't a hard cut.
      onUpdate(to);
      if (onComplete) onComplete();
      return { cancel() {}, get value() { return to; } };
    }

    let x = from;
    let v = velocity;
    let cancelled = false;
    let rafId = null;
    let last = null;

    const omega = (2 * Math.PI) / response;
    const k = omega * omega; // stiffness, mass = 1
    const c = 2 * damping * omega; // damping coefficient, mass = 1

    function frame(now) {
      if (cancelled) return;
      if (last === null) last = now;
      const dt = Math.min((now - last) / 1000, 0.032);
      last = now;

      const steps = 4;
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) {
        const accel = -k * (x - to) - c * v;
        v += accel * sub;
        x += v * sub;
      }

      onUpdate(x);

      if (Math.abs(x - to) < precision && Math.abs(v) < precision * 8) {
        onUpdate(to);
        if (onComplete) onComplete();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    return {
      cancel() {
        cancelled = true;
        if (rafId) cancelAnimationFrame(rafId);
      },
      get value() {
        return x;
      },
    };
  }

  // Apple's momentum-projection function (Designing Fluid Interfaces sample code).
  function project(initialVelocity, decelerationRate = 0.998) {
    return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate);
  }

  // Progressive resistance past a boundary — used for anything draggable near an edge.
  function rubberband(overshoot, dimension, constant = 0.55) {
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
  }

  return { animate, prefersReducedMotion, project, rubberband };
})();
