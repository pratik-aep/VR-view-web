import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Integration point for heritage_guide.glb (supplied separately).
 *
 * The guide lives in its own group, never inside the panorama sphere, and a
 * missing or broken file only logs a notice. Public API:
 *   load()                         -> Promise<boolean> (false when absent)
 *   setTransform({ position, rotationY, scale })
 *   playAnimation(name?) / stopAnimation()
 *   playNarration() / stopNarration()
 *   update(dt)                     call once per frame
 */
export class HeritageGuide {
  constructor(scene, camera, config) {
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = 'MIRAS_GUIDE';
    scene.add(this.group);

    this.model = null;
    this.mixer = null;
    this.clips = [];
    this.action = null;
    this.audio = null;
    this.subtitles = new SubtitlePanel(camera);
    this.setTransform(config);
  }

  async load() {
    const { url, showPlaceholder } = this.config;
    try {
      const res = await fetch(url);
      const type = res.headers.get('content-type') || '';
      // Dev servers answer unknown paths with index.html; treat that as "not there".
      if (!res.ok || type.includes('text/html')) throw new Error('not present');
      const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), url.replace(/[^/]*$/, ''));
      this.model = gltf.scene;
      this.group.add(this.model);
      if (this.config.contactShadow) this.group.add(makeContactShadow());
      this.clips = gltf.animations;
      if (this.clips.length) {
        this.mixer = new THREE.AnimationMixer(this.model);
        this.playAnimation(this.config.animation);
      }
      console.info(`[MIRAS] Guide loaded: ${url} (${this.clips.length} animation clip(s))`);
      return true;
    } catch (err) {
      console.info(`[MIRAS] Guide not loaded (${err.message}): ${url}. The environment works without it.`);
      if (showPlaceholder) this.group.add(makePlaceholder());
      return false;
    }
  }

  setTransform({ position, rotationY, scale }) {
    if (position) this.group.position.fromArray(position);
    if (rotationY !== undefined) this.group.rotation.y = THREE.MathUtils.degToRad(rotationY);
    if (scale !== undefined) this.group.scale.setScalar(scale);
  }

  /**
   * Stand the guide `distance` metres from the viewer at heading `yaw`
   * (degrees clockwise from the panorama centre, as in LookControls), feet at
   * `floorY`, turned to face the viewer.
   */
  placeAt({ yaw, distance, floorY, scale = 1 }) {
    const a = THREE.MathUtils.degToRad(yaw);
    this.setTransform({
      position: [Math.sin(a) * distance, floorY, -Math.cos(a) * distance],
      rotationY: -yaw, // the model faces +Z; turn it back towards the origin
      scale,
    });
  }

  playAnimation(name = null) {
    if (!this.mixer) return false;
    const clip = name ? THREE.AnimationClip.findByName(this.clips, name) : this.clips[0];
    if (!clip) {
      console.warn(`[MIRAS] Guide has no animation named "${name}"`);
      return false;
    }
    this.action?.fadeOut(0.3);
    this.action = this.mixer.clipAction(clip).reset().fadeIn(0.3).play();
    return true;
  }

  stopAnimation() {
    this.action?.stop();
    this.action = null;
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  async playNarration() {
    const { narration } = this.config;
    if (!narration) return false;
    this.audio ??= new Audio(narration);
    this.audio.currentTime = 0;
    await this.audio.play();
    return true;
  }

  stopNarration() {
    this.audio?.pause();
    this.subtitles.show('');
  }

  update(dt) {
    this.mixer?.update(dt);
    if (this.audio && !this.audio.paused) {
      const t = this.audio.currentTime;
      const cue = this.config.subtitles.find((c) => t >= c.start && t < c.end);
      this.subtitles.show(cue ? cue.text : '');
    }
  }
}

/** Head-locked subtitle strip drawn to a canvas, so it also shows inside a headset. */
class SubtitlePanel {
  constructor(camera) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.15),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false }),
    );
    this.mesh.position.set(0, -0.45, -1.2);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    camera.add(this.mesh);
    this.text = '';
  }

  show(text) {
    if (text === this.text) return;
    this.text = text;
    this.mesh.visible = Boolean(text);
    if (!text) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20, 12, 6, 0.72)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 28);
    ctx.fill();
    ctx.fillStyle = '#fff6ea';
    ctx.font = '500 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 60);
    this.texture.needsUpdate = true;
  }
}

/** Soft dark disc under the feet: grounds the figure against a flat panorama. */
function makeContactShadow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.8),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  shadow.name = 'MIRAS_Guide_Shadow';
  return shadow;
}

function makePlaceholder() {
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 1.7, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb35c, wireframe: true, transparent: true, opacity: 0.6 }),
  );
  marker.position.y = 0.85;
  marker.name = 'MIRAS_Guide_Placeholder';
  return marker;
}
