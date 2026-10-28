import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ACCENT = '#e0893a';
const IN_MS = 550;
const OUT_MS = 450;
const CHEST_Y = 1.18; // metres up the 1.9 m model where the portrait is cut
const PORTRAIT = 0.3; // fraction of the card width given to the guide, on the right (when shown)

/**
 * The contextual guide card: caption text on the left, the guide as a chest-up
 * portrait on the right. The guide faces straight out and rises into the card
 * from its bottom edge; clipping planes cut him at the card's edges, so he never
 * covers the panorama outside it.
 *
 * Desktop: snapped to the camera and laid out in screen pixels (bottom-right).
 * VR: ~1.5 m away below-right of the gaze, following the head lazily so it does
 * not judder. show(hotspot, now) opens it; it closes itself after
 * hotspot.duration ms or on dismiss(), then calls onFinished(hotspot, now).
 */
export class GuideOverlay {
  constructor(scene, camera, renderer, { url, character = true, onFinished }) {
    this.camera = camera;
    this.renderer = renderer;
    this.url = url;
    this.character = character; // false: caption-only card, the model is never loaded
    this.portrait = character ? PORTRAIT : 0;
    this.onFinished = onFinished;
    renderer.localClippingEnabled = true;

    this.root = new THREE.Group();
    this.root.name = 'MIRAS_GUIDE_OVERLAY';
    this.root.visible = false;
    scene.add(this.root);

    this.card = new THREE.Group();
    this.root.add(this.card);

    this.panel = new CaptionPanel(this.portrait);
    this.card.add(this.panel.mesh);

    this.bust = new THREE.Group(); // positioned so the chest sits on the card's bottom edge
    this.card.add(this.bust);
    this.model = null;
    this.materials = [];
    this.planes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];

    // Portrait lighting that travels with the card: warm key upper-left, cool rim behind-right.
    const key = new THREE.DirectionalLight(0xfff0dc, 1.5);
    key.position.set(-1.2, 1.4, 2);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 1.2);
    rim.position.set(1.5, 1, -1.5);
    key.target.position.set(0, 0, -1.5);
    rim.target.position.set(0, 0, -1.5);
    this.root.add(key, key.target, rim, rim.target);

    this.hotspot = null;
    this.state = 'hidden'; // hidden | in | shown | out
    this.t = 0; // 0..1 open amount
    this.shownAt = 0;
    this.bustH = 0;
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._first = true;
  }

  async load() {
    if (!this.character) return false;
    try {
      const gltf = await new GLTFLoader().loadAsync(this.url);
      this.model = gltf.scene;
      this.model.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        // three draws opaque objects before transparent ones whatever their renderOrder, so the
        // bust joins the transparent pass (still fully opaque) to be drawn after the card behind it.
        o.material.transparent = true;
        o.material.depthWrite = true;
        o.renderOrder = 5;
        o.material.clippingPlanes = this.planes;
        this.materials.push(o.material);
      });
      this.bust.add(this.model); // the exported model already faces +Z: straight at the viewer
      return true;
    } catch (err) {
      console.info(`[MIRAS] Guide model not loaded (${err.message}); captions will show without him.`);
      return false;
    }
  }

  get active() {
    return this.state !== 'hidden';
  }

  show(hotspot, now) {
    this.hotspot = hotspot;
    this.panel.draw(hotspot);
    this.state = 'in';
    this.shownAt = now;
    this.root.visible = true;
    this._first = true;
  }

  dismiss() {
    if (this.state === 'in' || this.state === 'shown') this.state = 'out';
  }

  update(dt, now) {
    if (this.state === 'hidden') return;

    if (this.state === 'shown' && now - this.shownAt >= this.hotspot.duration) this.state = 'out';
    if (this.state === 'in') {
      this.t = Math.min(1, this.t + (dt * 1000) / IN_MS);
      if (this.t === 1) this.state = 'shown';
    } else if (this.state === 'out') {
      this.t = Math.max(0, this.t - (dt * 1000) / OUT_MS);
      if (this.t === 0) {
        this.state = 'hidden';
        this.root.visible = false;
        const finished = this.hotspot;
        this.hotspot = null;
        this.onFinished?.(finished, now);
        return;
      }
    }

    const vr = this.renderer.xr.isPresenting;
    this.followHead(dt, vr);
    this.layout(vr);

    // Card fades and lifts a little; the guide rises from below its bottom edge, slightly later.
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const cardT = ease(Math.min(1, this.t * 1.6));
    const riseT = ease(THREE.MathUtils.clamp((this.t - 0.15) / 0.85, 0, 1));
    this.panel.setOpacity(cardT);
    this.card.position.y += (1 - cardT) * -this.panel.height * 0.15;
    if (!this.model) return;
    this.bust.position.y += (1 - riseT) * -this.bustH;
    // Turn (about the vertical only) to face the viewer square on wherever the card sits,
    // so only his front is seen. Tilting would pivot about the feet and swing the head away.
    const x = this.card.position.x + this.bust.position.x;
    this.bust.rotation.set(0, Math.atan2(-x, -this.card.position.z), 0);
    this.updateClipping();
  }

  followHead(dt, vr) {
    const head = vr ? this.renderer.xr.getCamera() : this.camera;
    head.getWorldPosition(this._pos);
    head.getWorldQuaternion(this._quat);
    if (!vr || this._first) {
      this.root.position.copy(this._pos);
      this.root.quaternion.copy(this._quat);
      this._first = false;
      return;
    }
    const k = 1 - Math.exp(-dt * 5); // lazy follow, ~0.4 s to catch up
    this.root.position.lerp(this._pos, k);
    this.root.quaternion.slerp(this._quat, k);
  }

  /** Size the card, then fit the chest-up portrait into its right-hand part. */
  layout(vr) {
    let d, cardW, cx, cy;
    const withGuide = this.portrait > 0;
    if (vr) {
      d = 1.5;
      cardW = withGuide ? 0.8 : 0.62;
      this.panel.setWidth(cardW);
      cx = withGuide ? 0.2 : 0.16;
      cy = -0.42;
    } else {
      d = 1.2;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const halfW = halfH * this.camera.aspect;
      const px = (2 * halfH) / vh; // world units per CSS pixel
      const BOTTOM = 92; // clear of the control bar
      const RIGHT = 20;
      const cardWpx = withGuide ? THREE.MathUtils.clamp(vw * 0.5, 340, 620) : THREE.MathUtils.clamp(vw * 0.4, 320, 480);
      cardW = Math.min(cardWpx, vw - 2 * RIGHT) * px;
      this.panel.setWidth(cardW);
      cx = halfW - RIGHT * px - cardW / 2;
      cy = -halfH + BOTTOM * px + this.panel.height / 2;
    }
    this.card.position.set(cx, cy, -d);
    if (!withGuide) return;

    const h = this.panel.height;
    const portraitW = cardW * this.portrait;
    // Head pops a little above the card; capped so the head stays well inside the portrait width.
    this.bustH = Math.min(h * 1.18, portraitW * 1.35);
    const s = this.bustH / (1.9 - CHEST_Y);
    this.bust.scale.setScalar(s);
    this.bust.position.set(cardW / 2 - portraitW / 2, -h / 2 - CHEST_Y * s, 0.02);
  }

  /**
   * World-space clip planes through the eye and each card edge (bottom, portrait
   * left, card right). Planes through the eye line up with the edges on screen
   * at every depth; planes perpendicular to the card would let the parts of the
   * guide nearer the camera slip past the edge through perspective.
   */
  updateClipping() {
    const m = this.panel.mesh;
    m.updateWorldMatrix(true, false);
    const eye = this._pos; // head position from followHead()
    const at = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld);
    const P = this.portrait;
    const inside = at(0.5 - P / 2, 0);
    const edges = [
      [at(-0.5, -0.5), at(0.5, -0.5)], // bottom
      [at(0.5 - P, -0.5), at(0.5 - P, 0.5)], // left of the portrait (keeps the text clear)
      [at(0.5, -0.5), at(0.5, 0.5)], // card right edge
    ];
    edges.forEach(([a, b], i) => {
      const p = this.planes[i].setFromCoplanarPoints(eye, a, b);
      if (p.distanceToPoint(inside) < 0) p.negate(); // keep the side the portrait is on
    });
  }
}

/** Card background and text, drawn once per hotspot into a canvas texture. */
class CaptionPanel {
  constructor(portrait) {
    this.portrait = portrait; // fraction of the width kept free for the guide (0 = text only)
    this.canvas = document.createElement('canvas');
    // ~2x the largest on-screen card width, so text stays crisp and reads at the same size.
    this.canvas.width = portrait > 0 ? 1200 : 960;
    this.canvas.height = 360;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'MIRAS_Caption';
    this.aspect = this.canvas.height / this.canvas.width;
    this.height = 0;
  }

  setWidth(w) {
    this.mesh.scale.set(w, w * this.aspect, 1);
    this.height = w * this.aspect;
  }

  setOpacity(o) {
    this.material.opacity = o;
  }

  draw({ title, caption, placeholder }) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const pad = 56;
    const P = this.portrait;
    const textW = W * (1 - P) - pad * (P > 0 ? 1.5 : 2);
    const bodyFont = '400 34px "Helvetica Neue", system-ui, sans-serif';
    const lineH = 48;

    ctx.font = bodyFont;
    const lines = wrap(ctx, caption, textW);
    const textH = pad + (placeholder ? 38 : 0) + 60 + 26 + lines.length * lineH + pad - 10;
    const H = P > 0 ? Math.max(300, textH) : textH; // the portrait needs some height to stand in
    if (canvas.height !== H) {
      canvas.height = H;
      this.aspect = H / W;
      this.texture.dispose(); // size changed: let three re-allocate the GPU texture
    }

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    roundRect(ctx, 0, 0, W, H, 28);
    ctx.clip();
    ctx.fillStyle = 'rgba(16, 10, 6, 0.84)';
    ctx.fillRect(0, 0, W, H);
    if (P > 0) {
      // Warm glow behind the portrait, so the guide sits in a lit niche rather than on flat black.
      const px = W * (1 - P / 2);
      const glow = ctx.createRadialGradient(px, H * 0.55, 10, px, H * 0.55, W * P * 0.75);
      glow.addColorStop(0, 'rgba(224, 137, 58, 0.30)');
      glow.addColorStop(1, 'rgba(224, 137, 58, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(W * (1 - P), 0, W * P, H);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 236, 210, 0.16)';
    ctx.lineWidth = 3;
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 27);
    ctx.stroke();

    ctx.textBaseline = 'top';
    let y = pad;
    if (placeholder) {
      ctx.font = '600 21px "Helvetica Neue", system-ui, sans-serif';
      ctx.fillStyle = ACCENT;
      ctx.fillText('PLACEHOLDER · VERIFIED HISTORY PENDING', pad, y);
      y += 38;
    }
    ctx.font = '600 46px Georgia, "Times New Roman", serif';
    ctx.fillStyle = '#fff6ea';
    ctx.fillText(title, pad, y, textW);
    y += 60;
    ctx.fillStyle = ACCENT;
    ctx.fillRect(pad, y, 72, 4);
    y += 26;

    ctx.font = bodyFont;
    ctx.fillStyle = 'rgba(255, 246, 234, 0.92)';
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += lineH;
    }
    this.texture.needsUpdate = true;
  }
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
