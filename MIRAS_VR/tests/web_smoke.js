// In-page smoke test for the MIRAS web viewer.
// Open http://localhost:5173, wait for the panorama, paste this into the
// browser console (or run it through a test driver); it returns a results list.
(async () => {
  const m = window.__miras;
  const out = [];
  const check = (name, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Average colour of the centre of the rendered view.
  const gl = m.renderer.getContext();
  function sample() {
    m.renderer.render(m.scene, m.camera);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, s = 64;
    const px = new Uint8Array(s * s * 4);
    gl.readPixels((w - s) >> 1, (h - s) >> 1, s, s, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) { c[0] += px[i]; c[1] += px[i + 1]; c[2] += px[i + 2]; }
    return c.map((v) => v / (s * s));
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  check('panorama texture loaded', Boolean(m.panorama.material.map?.image), `${m.panorama.material.map?.image?.width}x${m.panorama.material.map?.image?.height}`);
  check('loader hidden, no error card', document.getElementById('loader').hidden && document.getElementById('error').hidden);

  // Full horizontal turn: every 45° shows image content; 0° and 360° agree.
  const samples = [];
  for (let yaw = 0; yaw <= 360; yaw += 45) {
    m.controls.set(yaw, 0);
    samples.push(sample());
  }
  check('all 8 headings show image content', samples.slice(0, 8).every((c) => c[0] + c[1] + c[2] > 60), samples.slice(0, 8).map((c) => c.map(Math.round).join('/')).join(' '));
  const distinct = new Set(samples.slice(0, 8).map((c) => c.map((v) => Math.round(v / 8)).join())).size;
  check('headings differ (view actually turns)', distinct >= 6, `${distinct}/8 distinct`);
  check('360° returns to the start view', dist(samples[0], samples[8]) < 2, `Δ ${dist(samples[0], samples[8]).toFixed(2)}`);

  // Vertical look and its limits.
  m.controls.set(0, 60); const up = sample();
  m.controls.set(0, -60); const down = sample();
  check('looking up shows sky (blue dominant)', up[2] > up[0], up.map(Math.round).join('/'));
  check('looking down shows floor (warm dominant)', down[0] > down[2], down.map(Math.round).join('/'));
  m.controls.set(0, 200);
  check('pitch clamped at +85°', m.controls.pitch === 85);
  m.controls.set(0, -200);
  check('pitch clamped at -85°', m.controls.pitch === -85);

  // Input paths.
  const canvas = m.renderer.domElement;
  m.controls.set(0, 0);
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaY: 0, bubbles: true, cancelable: true }));
  check('trackpad swipe (wheel deltaX) turns view', m.controls.yaw > 1, `yaw ${m.controls.yaw.toFixed(1)}`);
  const fov0 = m.camera.fov;
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, bubbles: true, cancelable: true }));
  check('pinch (ctrl+wheel) zooms', m.camera.fov < fov0, `fov ${fov0} → ${m.camera.fov}`);
  m.controls.set(0, 0);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  check('arrow key turns view', m.controls.yaw === 5);

  // Reset.
  m.controls.set(123, 40);
  document.getElementById('btn-reset').click();
  check('Reset view restores front, level, default FOV', m.controls.yaw === 0 && m.controls.pitch === 0 && m.camera.fov === 90);

  // The visitor never leaves the centre.
  for (let i = 0; i < 20; i++) m.controls.set(Math.random() * 720 - 360, Math.random() * 200 - 100);
  check('camera stays at origin through rotations', m.camera.position.length() === 0 && m.panorama.position.length() === 0);
  m.controls.reset();

  // WebXR detection against simulated runtimes.
  const fake = (supported) => ({ isSessionSupported: async (mode) => mode === 'immersive-vr' && supported });
  check('XR detect: headset runtime → supported', (await m.detectImmersiveVR(fake(true), true)) === 'supported');
  check('XR detect: runtime without VR → unsupported', (await m.detectImmersiveVR(fake(false), true)) === 'unsupported');
  check('XR detect: no navigator.xr → unavailable', (await m.detectImmersiveVR(null, true)) === 'unavailable');
  check('XR detect: insecure origin → insecure', (await m.detectImmersiveVR(null, false)) === 'insecure');
  check('XR detect: throwing runtime → unsupported', (await m.detectImmersiveVR({ isSessionSupported: async () => { throw new Error('policy'); } }, true)) === 'unsupported');
  const real = await m.detectImmersiveVR();
  check('Enter VR button visibility matches real detection', document.getElementById('btn-vr').hidden === (real !== 'supported'), `this browser: ${real}`);
  check('renderer XR enabled, animation loop running', m.renderer.xr.enabled === true);


  await frame();
  return out;
})();
