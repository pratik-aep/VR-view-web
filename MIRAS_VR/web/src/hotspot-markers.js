import * as THREE from 'three';

const MARKER_DISTANCE = 15; // metres, inside the 20 m panorama sphere
const DOT_SIZE = 0.06; // sprite size at 1 m (constant on screen); the white core is ~40% of it

/**
 * Small white dots on each hotspot, so visitors can see what is worth looking at.
 * A ring fills around the dot while the dwell timer runs; the dot dims while its
 * caption is showing or it is cooling down.
 */
export class HotspotMarkers {
  constructor(scene, gaze) {
    this.gaze = gaze;
    this.group = new THREE.Group();
    this.group.name = 'MIRAS_HOTSPOT_MARKERS';
    scene.add(this.group);

    const dotTex = makeDotTexture();
    this.markers = gaze.hotspots.map((h) => {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      }));
      dot.position.copy(h.dir).multiplyScalar(MARKER_DISTANCE);
      dot.renderOrder = 3;
      dot.userData.hotspotId = h.id;

      const ring = new ProgressRing();
      ring.sprite.position.copy(dot.position);
      this.group.add(dot, ring.sprite);
      return { h, dot, ring, phase: Math.random() * Math.PI * 2 };
    });
  }

  update(dt, now) {
    const g = this.gaze;
    for (const m of this.markers) {
      m.dot.visible = m.h.active;
      if (!m.h.active) {
        m.ring.set(0);
        continue;
      }
      const idle = !g.busy && m.h.armed && now >= m.h.cooldownUntil;
      const focused = g.focused === m.h && g.dwellStart !== null;
      // Gentle breathing pulse so the dots read as interactive without shouting.
      const pulse = idle ? 1 + 0.12 * Math.sin(now / 450 + m.phase) : 1;
      const s = DOT_SIZE * pulse * (focused ? 1.25 : 1);
      m.dot.scale.set(s, s, 1);
      m.dot.material.opacity = g.busy ? (g.focused === m.h ? 0 : 0.35) : idle ? 0.95 : 0.4;
      m.ring.set(focused ? g.dwellProgress : 0);
    }
  }
}

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  // Soft dark halo keeps the dot visible on bright sky and pale stone alike.
  const halo = ctx.createRadialGradient(32, 32, 10, 32, 32, 32);
  halo.addColorStop(0, 'rgba(0,0,0,0.45)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 13, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Thin white arc that fills clockwise; redrawn only when its value changes noticeably. */
class ProgressRing {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 96;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.texture, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.sprite.scale.set(DOT_SIZE * 1.1, DOT_SIZE * 1.1, 1);
    this.sprite.renderOrder = 3;
    this.sprite.visible = false;
    this.value = -1;
  }

  set(p) {
    const q = Math.round(p * 40) / 40; // 2.5% steps: at most ~40 small texture uploads per dwell
    if (q === this.value) return;
    this.value = q;
    this.sprite.visible = q > 0;
    if (!this.sprite.visible) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, 96, 96);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(48, 48, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(48, 48, 40, -Math.PI / 2, -Math.PI / 2 + q * Math.PI * 2);
    ctx.stroke();
    this.texture.needsUpdate = true;
  }
}
