import * as THREE from 'three';

/**
 * Rotation-only look controls. The camera never translates: drag, trackpad
 * swipe and arrow keys change yaw/pitch, pinch or ctrl+wheel changes FOV.
 *
 * Yaw is degrees clockwise from the panorama centre (0 = front, 90 = right),
 * the same convention as the Blender previews.
 */
export class LookControls {
  constructor(camera, element, { pitchLimit, dragSensitivity, minFov, maxFov, startYaw = 0, startPitch = 0 }) {
    this.camera = camera;
    this.element = element;
    this.pitchLimit = pitchLimit;
    this.sensitivity = dragSensitivity;
    this.minFov = minFov;
    this.maxFov = maxFov;
    this.defaultFov = camera.fov;
    this.startYaw = startYaw; // where the visitor starts and where Reset view returns
    this.startPitch = startPitch;
    this.yaw = startYaw;
    this.pitch = startPitch;
    this.enabled = true;
    this._drag = null;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this._onDown);
    element.addEventListener('pointermove', this._onMove);
    element.addEventListener('pointerup', this._onUp);
    element.addEventListener('pointercancel', this._onUp);
    element.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKey);
    this.apply();
  }

  set(yaw, pitch) {
    this.yaw = ((yaw % 360) + 360) % 360;
    this.pitch = THREE.MathUtils.clamp(pitch, -this.pitchLimit, this.pitchLimit);
    this.apply();
  }

  reset() {
    this.camera.fov = this.defaultFov;
    this.camera.updateProjectionMatrix();
    this.set(this.startYaw, this.startPitch);
  }

  apply() {
    this.camera.position.set(0, 0, 0); // the visitor stays at the centre
    this._euler.set(THREE.MathUtils.degToRad(this.pitch), THREE.MathUtils.degToRad(-this.yaw), 0);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  _zoom(delta) {
    this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + delta, this.minFov, this.maxFov);
    this.camera.updateProjectionMatrix();
  }

  _onDown = (e) => {
    if (!this.enabled) return;
    this.element.setPointerCapture(e.pointerId);
    this._drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
    this.element.classList.add('dragging');
  };

  _onMove = (e) => {
    if (!this._drag) return;
    // Scale with FOV so the image tracks the pointer at any zoom level.
    const k = this.sensitivity * (this.camera.fov / this.defaultFov);
    // "Grab the world": dragging left turns the view right.
    this.set(this._drag.yaw - (e.clientX - this._drag.x) * k, this._drag.pitch + (e.clientY - this._drag.y) * k);
  };

  _onUp = (e) => {
    if (!this._drag) return;
    this.element.releasePointerCapture?.(e.pointerId);
    this._drag = null;
    this.element.classList.remove('dragging');
  };

  _onWheel = (e) => {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.ctrlKey) {
      this._zoom(e.deltaY * 0.2); // trackpad pinch arrives as ctrl+wheel
    } else {
      // Two-finger trackpad swipe looks around, like a native panorama viewer.
      const k = this.sensitivity * 0.5 * (this.camera.fov / this.defaultFov);
      this.set(this.yaw + e.deltaX * k, this.pitch - e.deltaY * k);
    }
  };

  _onKey = (e) => {
    if (!this.enabled || e.target.closest?.('input, textarea')) return;
    const step = 5;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      this.set(this.yaw + moves[e.key][0], this.pitch + moves[e.key][1]);
    } else if (e.key === '+' || e.key === '=') this._zoom(-5);
    else if (e.key === '-') this._zoom(5);
  };
}
