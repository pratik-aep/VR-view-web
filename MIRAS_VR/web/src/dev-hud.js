import { yawPitchFromDirection } from './gaze.js';

/**
 * Developer mode (?dev): live yaw/pitch of the view centre (the white reticle),
 * the nearest hotspot and the dwell state. Press C to copy a ready-to-paste
 * hotspot entry for the current view.
 */
export class DevHud {
  constructor(gaze) {
    this.gaze = gaze;
    this.view = { yaw: 0, pitch: 0 };

    this.el = document.createElement('div');
    this.el.className = 'dev-panel';
    this.el.innerHTML = `
      <strong>DEV · gaze</strong>
      <div>yaw <b data-k="yaw">0</b>° · pitch <b data-k="pitch">0</b>°</div>
      <div>nearest <b data-k="near">–</b></div>
      <div>state <b data-k="state">–</b></div>
      <div class="dev-hint">C copies a hotspot entry for the centre dot</div>
      <div data-k="toast" class="dev-toast"></div>`;
    document.body.appendChild(this.el);
    this.k = Object.fromEntries([...this.el.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n]));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'c' || e.key === 'C') this.copy();
    });
  }

  update(forward) {
    this.view = yawPitchFromDirection(forward);
    const g = this.gaze;
    const near = g.hotspots.reduce((a, b) => (b.angle < a.angle ? b : a), g.hotspots[0]);
    this.k.yaw.textContent = this.view.yaw.toFixed(1);
    this.k.pitch.textContent = this.view.pitch.toFixed(1);
    this.k.near.textContent = near ? `${near.id} (${near.angle.toFixed(1)}°)` : '–';
    const f = g.focused;
    this.k.state.textContent = g.busy
      ? 'caption showing'
      : !f ? 'idle'
      : !f.armed ? 'look away to re-arm'
      : g._now < f.cooldownUntil ? 'cooling down'
      : g.speed > g.maxGazeSpeed ? 'moving too fast'
      : `dwelling ${Math.round(g.dwellProgress * 100)}%`;
  }

  copy() {
    const entry = {
      id: 'new-feature',
      title: 'New Feature',
      yaw: Math.round(this.view.yaw),
      pitch: Math.round(this.view.pitch),
      caption: 'Placeholder: verified history will appear here.',
      placeholder: true,
    };
    const text = JSON.stringify(entry, null, 2);
    navigator.clipboard?.writeText(text).then(
      () => this.toast(`Copied yaw ${entry.yaw}, pitch ${entry.pitch}`),
      () => this.toast(`yaw ${entry.yaw}, pitch ${entry.pitch} (clipboard blocked)`),
    );
    console.info('[MIRAS dev] hotspot entry:\n' + text);
  }

  toast(msg) {
    this.k.toast.textContent = msg;
    clearTimeout(this._t);
    this._t = setTimeout(() => (this.k.toast.textContent = ''), 2500);
  }
}
