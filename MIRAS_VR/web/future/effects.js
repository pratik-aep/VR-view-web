import * as THREE from 'three';

/**
 * Registry for ambient layers (birds, flags, particles...). Each effect is a
 * separate object in front of the panorama with an optional update(dt, t);
 * the photograph itself is never modified.
 */
export class EffectsLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'MIRAS_EFFECTS';
    scene.add(this.group);
    this.effects = new Map();
    this.time = 0;
  }

  add(name, effect) {
    this.remove(name);
    this.effects.set(name, effect);
    this.group.add(effect.object);
    return effect;
  }

  remove(name) {
    const effect = this.effects.get(name);
    if (!effect) return;
    this.group.remove(effect.object);
    effect.dispose?.();
    this.effects.delete(name);
  }

  update(dt) {
    this.time += dt;
    for (const effect of this.effects.values()) effect.update?.(dt, this.time);
  }
}

/** Sunlit dust motes drifting around the viewer. Cheap enough for Quest 2. */
export function createDust({ count = 300, radius = 6 } = {}) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = 1.5 + Math.random() * (radius - 1.5);
    const a = Math.random() * Math.PI * 2;
    positions.set([Math.cos(a) * r, -1.5 + Math.random() * 3.5, Math.sin(a) * r], i * 3);
    seeds[i] = Math.random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const base = positions.slice();
  const material = new THREE.PointsMaterial({
    color: 0xffe2b0, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const object = new THREE.Points(geometry, material);
  object.name = 'dust';

  return {
    object,
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const s = seeds[i];
        positions[i * 3] = base[i * 3] + Math.sin(t * 0.15 + s) * 0.3;
        positions[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.1 + s * 2) * 0.2;
        positions[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.12 + s) * 0.3;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
