import * as THREE from 'three';

const SHOW_PITCH = -22; // look this far down (degrees) to bring the menu up
const HIDE_PITCH = -8; // and back above this to put it away (hysteresis)
const MENU_PITCH = -34; // where it sits, below the horizon
const MENU_DISTANCE = 1.3; // metres from the head
const BUTTON_W = 0.24;
const BUTTON_H = 0.085;
const GAP = 0.02;
const DWELL_MS = 1000; // gaze selection, for visitors without controllers

/**
 * In-headset location switcher. Looking down brings up a row of buttons, one per
 * view, anchored where the visitor was facing (it does not chase the head).
 * Pick with a controller ray + trigger, or by looking at a button for 1 s.
 *
 * Only shown during a WebXR session, unless `forceDesktop` is set (testing).
 */
export class VrViewMenu {
  constructor(scene, renderer, camera, views, { onSelect, forceDesktop = false }) {
    this.renderer = renderer;
    this.camera = camera;
    this.onSelect = onSelect;
    this.forceDesktop = forceDesktop;
    this.activeId = null;
    this.open = false;
    this.hovered = null;
    this.dwellStart = null;
    this.hoverSource = null; // 'ray' | 'gaze'

    this.group = new THREE.Group();
    this.group.name = 'MIRAS_VR_VIEW_MENU';
    this.group.visible = false;
    scene.add(this.group);

    const totalW = views.length * BUTTON_W + (views.length - 1) * GAP;
    this.title = makeTitle('Choose a location');
    this.title.position.set(0, BUTTON_H / 2 + 0.05, 0);
    this.group.add(this.title);

    this.buttons = views.map((view, i) => {
      const b = new MenuButton(view);
      b.mesh.position.x = -totalW / 2 + BUTTON_W / 2 + i * (BUTTON_W + GAP);
      this.group.add(b.mesh);
      return b;
    });

    this.raycaster = new THREE.Raycaster();
    this._pos = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._m = new THREE.Matrix4();

    // Controllers: a thin ray each while the menu is open; the trigger picks.
    this.controllers = [0, 1].map((i) => {
      const c = renderer.xr.getController(i);
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, toneMapped: false }),
      );
      ray.scale.z = 3;
      ray.visible = false;
      c.add(ray);
      c.userData.ray = ray;
      c.userData.hit = null;
      scene.add(c);
      return c;
    });
  }

  setActive(id) {
    this.activeId = id;
    for (const b of this.buttons) b.setState({ active: b.view.id === id });
  }

  /** Called from a controller 'select'. Returns true if it picked a button (so the caller can ignore it). */
  handleSelect(controller) {
    if (!this.open) return false;
    const hit = controller.userData.hit;
    if (!hit) return false;
    this.choose(hit);
    return true;
  }

  choose(button) {
    this.dwellStart = null;
    if (button.view.id !== this.activeId) this.onSelect?.(button.view);
  }

  get enabled() {
    return this.renderer.xr.isPresenting || this.forceDesktop;
  }

  update(dt, now) {
    if (!this.enabled) {
      if (this.open) this.close();
      return;
    }
    const xr = this.renderer.xr.isPresenting;
    const head = xr ? this.renderer.xr.getCamera() : this.camera;
    head.getWorldPosition(this._pos);
    head.getWorldDirection(this._dir);
    const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(this._dir.y, -1, 1)));

    if (!this.open && pitch < SHOW_PITCH) this.openAt(this._pos, this._dir);
    else if (this.open && pitch > HIDE_PITCH) this.close();
    if (!this.open) return;

    // Hover: a controller ray wins over gaze.
    let hovered = null;
    let source = null;
    for (const c of this.controllers) {
      c.userData.hit = null;
      c.userData.ray.visible = xr;
      if (!xr) continue;
      this._m.identity().extractRotation(c.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._m);
      const hit = this.pick();
      c.userData.hit = hit;
      c.userData.ray.scale.z = hit ? hit.distance : 3;
      if (hit && !hovered) {
        hovered = hit.button;
        source = 'ray';
      }
    }
    for (const c of this.controllers) if (c.userData.hit) c.userData.hit = c.userData.hit.button;
    if (!hovered) {
      this.raycaster.ray.origin.copy(this._pos);
      this.raycaster.ray.direction.copy(this._dir);
      const hit = this.pick();
      if (hit) {
        hovered = hit.button;
        source = 'gaze';
      }
    }

    if (hovered !== this.hovered || source !== this.hoverSource) {
      this.hovered = hovered;
      this.hoverSource = source;
      this.dwellStart = source === 'gaze' && hovered && hovered.view.id !== this.activeId ? now : null;
    }
    let progress = 0;
    if (this.dwellStart !== null) {
      progress = Math.min(1, (now - this.dwellStart) / DWELL_MS);
      if (progress >= 1) this.choose(this.hovered);
    }
    for (const b of this.buttons) b.setState({ hover: b === hovered, progress: b === hovered ? progress : 0 });
  }

  pick() {
    const hits = this.raycaster.intersectObjects(this.buttons.map((b) => b.mesh), false);
    if (!hits.length) return null;
    return { button: hits[0].object.userData.button, distance: hits[0].distance };
  }

  /** Place the menu below where the visitor is facing, turned towards them. */
  openAt(pos, dir) {
    const yaw = Math.atan2(dir.x, -dir.z);
    const p = THREE.MathUtils.degToRad(MENU_PITCH);
    this.group.position.set(
      pos.x + Math.sin(yaw) * Math.cos(p) * MENU_DISTANCE,
      pos.y + Math.sin(p) * MENU_DISTANCE,
      pos.z - Math.cos(yaw) * Math.cos(p) * MENU_DISTANCE,
    );
    this.group.lookAt(pos);
    this.group.visible = true;
    this.open = true;
  }

  close() {
    this.group.visible = false;
    this.open = false;
    this.hovered = null;
    this.dwellStart = null;
    for (const c of this.controllers) {
      c.userData.ray.visible = false;
      c.userData.hit = null;
    }
    for (const b of this.buttons) b.setState({ hover: false, progress: 0 });
  }
}

/** One location button: a canvas-textured plane, redrawn only when its state changes. */
class MenuButton {
  constructor(view) {
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 480;
    this.canvas.height = 170;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(BUTTON_W, BUTTON_H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 30;
    this.mesh.userData.button = this;
    this.state = { active: false, hover: false, progress: 0 };
    this.key = '';
    this.draw();
  }

  setState(s) {
    Object.assign(this.state, s);
    const key = `${this.state.active}|${this.state.hover}|${Math.round(this.state.progress * 20)}`;
    if (key !== this.key) this.draw();
  }

  draw() {
    const { ctx, canvas, state } = this;
    const W = canvas.width;
    const H = canvas.height;
    this.key = `${state.active}|${state.hover}|${Math.round(state.progress * 20)}`;
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, H / 2 - 4);
    ctx.fillStyle = state.active ? '#e0893a' : state.hover ? 'rgba(60, 36, 18, 0.95)' : 'rgba(20, 12, 6, 0.85)';
    ctx.fill();
    ctx.lineWidth = state.hover ? 6 : 3;
    ctx.strokeStyle = state.hover ? '#ffffff' : 'rgba(255, 236, 210, 0.3)';
    ctx.stroke();
    if (state.progress > 0) {
      // Gaze dwell: a bar fills along the bottom of the pill.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(0, H - 22, W * state.progress, 22);
      ctx.restore();
    }
    ctx.fillStyle = state.active ? '#1d0f04' : '#fff6ea';
    ctx.font = '600 54px "Helvetica Neue", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.view.name, W / 2, H / 2 + 2, W - 60);
    this.texture.needsUpdate = true;
  }
}

function makeTitle(text) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 80;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255, 246, 234, 0.85)';
  ctx.font = '600 40px "Helvetica Neue", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 320, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.05),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  mesh.renderOrder = 30;
  return mesh;
}
