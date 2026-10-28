// Gaze-hotspot test for the MIRAS web viewer.
// Open http://localhost:5173, wait for the panorama, paste into the console.
// It steps the same per-frame calls as main.js (gaze, markers, guide) on a
// virtual 60 fps clock, so results don't depend on the tab being visible.
(() => {
  const m = window.__miras, T = m.THREE, out = [];
  const check = (n, ok, d = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  let now = performance.now() + 100000;
  let pointer = null;
  const dt = 1 / 60, fwd = new T.Vector3();
  const frame = () => {
    now += dt * 1000;
    m.camera.getWorldDirection(fwd);
    m.gaze.update(fwd, dt, now, pointer);
    m.markers.update(dt, now);
    m.guide.update(dt, now);
  };
  const run = (ms, each) => { for (let i = 0, n = Math.round(ms / (dt * 1000)); i < n; i++) { each?.(i); frame(); } };
  const until = (fn, maxMs) => { const t0 = now; while (!fn() && now - t0 < maxMs) frame(); return now - t0; };
  const reset = () => { m.gaze.hotspots.forEach((s) => { s.armed = true; s.cooldownUntil = 0; }); m.gaze.busy = false; };
  const h = m.gaze.hotspots[0];
  const marker = m.markers.markers.find((k) => k.h === h);

  reset();
  m.controls.set(0, 0); run(300);
  check('1. normal view: guide + caption hidden, dots shown', !m.guide.root.visible && marker.dot.material.opacity > 0.9);
  m.controls.set(h.yaw, h.pitch); run(400); m.controls.set(0, 0); run(300);
  check('2. looking away before the dwell ends cancels', !m.guide.active);
  let y = h.yaw - 60; run(1200, () => { y += 100 * dt; m.controls.set(y, h.pitch); }); m.controls.set(0, 0); run(200);
  check('3. sweeping past at 100°/s does not trigger', !m.guide.active);

  m.controls.set(h.yaw + 4, h.pitch + 2);
  run(300);
  check('4. progress ring fills around the dot while dwelling', marker.ring.sprite.visible && marker.ring.value > 0.2, `${Math.round(marker.ring.value * 100)}%`);
  const fired = until(() => m.guide.active, 4000) + 300;
  check('5. centre-of-view dwell fires at ~0.7 s', m.guide.active && Math.abs(fired - h.dwellTime) < 60, `${fired.toFixed(0)} ms at ${h.angle.toFixed(1)}° off centre`);
  const opened = until(() => m.guide.state === 'shown', 2000);
  check('6. card opens and guide rises in ~0.55 s', Math.abs(opened - 550) < 40, `${opened.toFixed(0)} ms`);
  const shown = until(() => m.guide.state === 'out', 12000);
  check('7. stays ~8 s', Math.abs(shown + opened - h.duration) < 60, `${((shown + opened) / 1000).toFixed(2)} s from trigger`);
  const closed = until(() => !m.guide.active, 2000);
  check('8. closes in ~0.45 s, then hidden', !m.guide.root.visible && Math.abs(closed - 450) < 40, `${closed.toFixed(0)} ms`);
  run(3000);
  check('9. no retrigger while still looking', !m.guide.active);
  m.controls.set(0, 0); run(200);
  check('10. looking away re-arms', h.armed);

  // Desktop hover: view pointed elsewhere, mouse resting on the dot.
  reset();
  m.controls.set(h.yaw + 30, h.pitch); // dot well outside the centre cone
  pointer = h.dir.clone().applyAxisAngle(new T.Vector3(0, 1, 0), THREE_DEG(1.5)); // 1.5° off the dot
  const hovered = until(() => m.guide.active, 3000);
  check('11. mouse resting on a dot triggers at ~0.7 s', m.guide.active && Math.abs(hovered - h.dwellTime) < 60, `${hovered.toFixed(0)} ms, pointer ${h.pointerAngle.toFixed(1)}° from dot`);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  until(() => !m.guide.active, 2000);
  pointer = h.dir.clone().applyAxisAngle(new T.Vector3(0, 1, 0), THREE_DEG(8));
  reset(); run(1500);
  check('12. mouse 8° away from the dot does not trigger', !m.guide.active);
  pointer = null;

  // Nearest wins when two are in range.
  reset();
  const [a, b] = [m.gaze.hotspots[2], m.gaze.hotspots[3]]; // gateway 154°, facade 182°
  m.controls.set(b.yaw - 3, b.pitch - 2);
  until(() => m.guide.active, 3000);
  check('13. the hotspot nearest the centre is chosen', m.guide.hotspot?.id === b.id, m.guide.hotspot?.id);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  until(() => !m.guide.active, 2000);
  check('14. Esc dismisses and unblocks gaze', !m.guide.active && m.gaze.busy === false);
  reset();
  m.controls.reset();
  return out;

  function THREE_DEG(d) { return (d * Math.PI) / 180; }
})();
