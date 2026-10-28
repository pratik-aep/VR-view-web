import * as THREE from 'three';

const DEG = THREE.MathUtils.RAD2DEG;

/** Unit vector for a panorama heading (yaw clockwise from the centre, pitch up), as in LookControls. */
export function directionFromYawPitch(yaw, pitch, target = new THREE.Vector3()) {
  const y = THREE.MathUtils.degToRad(yaw);
  const p = THREE.MathUtils.degToRad(pitch);
  return target.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}

/** Inverse of directionFromYawPitch: { yaw 0..360, pitch -90..90 } in degrees. */
export function yawPitchFromDirection(v) {
  const yaw = (Math.atan2(v.x, -v.z) * DEG + 360) % 360;
  const pitch = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * DEG;
  return { yaw, pitch };
}

/**
 * Dwell-based triggering for panorama hotspots.
 *
 * A hotspot is "looked at" when the centre of the view is within `triggerAngle`
 * of it, or (desktop) when the mouse rests within `hoverAngle` of its dot. After
 * `dwellTime` ms of steady looking it fires. It stays focused until both leave
 * their exit cones (`exitAngle`, `hoverExitAngle`), so the boundary does not
 * flicker. A fired hotspot is disarmed until the visitor looks away and its
 * `cooldown` has passed. Nothing starts while `busy` (a caption is showing).
 */
export class GazeHotspots {
  constructor({ defaults, hotspots }, { onActivate, maxGazeSpeed = 45 } = {}) {
    this.onActivate = onActivate;
    this.maxGazeSpeed = maxGazeSpeed; // deg/s; turning faster restarts the dwell
    this.hotspots = hotspots.map((h) => {
      const spot = { ...defaults, ...h };
      return {
        ...spot,
        dir: directionFromYawPitch(spot.yaw, spot.pitch),
        armed: true,
        cooldownUntil: 0,
        angle: 180, // from the centre of view
        pointerAngle: 180, // from the mouse ray
        active: true, // belongs to the panorama on screen (see setView)
      };
    });
    this.busy = false;
    this.focused = null;
    this.dwellStart = null;
    this._prev = new THREE.Vector3(0, 0, -1);
    this._now = 0;
    this.speed = 0;
  }

  /** Only hotspots whose `view` matches (or that name no view) can be seen and triggered. */
  setView(viewId) {
    for (const h of this.hotspots) h.active = !h.view || h.view === viewId;
    this.focused = null;
    this.dwellStart = null;
  }

  /** Call when a hotspot's caption has finished, to start its cooldown. */
  release(id, now) {
    const h = this.hotspots.find((s) => s.id === id);
    if (h) h.cooldownUntil = now + h.cooldown;
  }

  get dwellProgress() {
    if (!this.focused || this.dwellStart === null) return 0;
    return Math.min(1, (this._now - this.dwellStart) / this.focused.dwellTime);
  }

  /** How far inside its trigger zone a hotspot is (0 = dead centre, >1 = outside). */
  static closeness(h) {
    return Math.min(h.angle / h.triggerAngle, h.pointerAngle / h.hoverAngle);
  }

  static stillFocused(h) {
    return h.angle <= h.exitAngle || h.pointerAngle <= h.hoverExitAngle;
  }

  /**
   * @param forward  view direction (centre of the screen / headset)
   * @param pointer  mouse ray direction, or null (VR, touch, mouse outside)
   */
  update(forward, dt, now, pointer = null) {
    this._now = now;
    this.speed = dt > 0 ? (this._prev.angleTo(forward) * DEG) / dt : 0;
    this._prev.copy(forward);

    for (const h of this.hotspots) {
      h.angle = h.active ? h.dir.angleTo(forward) * DEG : 180;
      h.pointerAngle = h.active && pointer ? h.dir.angleTo(pointer) * DEG : 180;
      if (!h.armed && !GazeHotspots.stillFocused(h)) h.armed = true; // looked away: may fire again
    }

    if (!this.focused || !GazeHotspots.stillFocused(this.focused)) {
      let best = null;
      for (const h of this.hotspots) {
        const c = GazeHotspots.closeness(h);
        if (c <= 1 && (!best || c < GazeHotspots.closeness(best))) best = h;
      }
      if (best !== this.focused) this.dwellStart = null;
      this.focused = best;
    }

    const h = this.focused;
    if (this.busy || !h || !h.armed || now < h.cooldownUntil) {
      this.dwellStart = null;
      return;
    }
    if (this.speed > this.maxGazeSpeed || this.dwellStart === null) {
      this.dwellStart = now; // the view is still turning: sweeping past is not looking
      return;
    }
    if (now - this.dwellStart >= h.dwellTime) {
      h.armed = false;
      this.dwellStart = null;
      this.onActivate?.(h, now);
    }
  }
}
