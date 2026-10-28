/**
 * WebXR entry. Nothing here assumes a headset: the Enter VR button stays hidden
 * unless the browser reports immersive-vr support, and the desktop view keeps
 * working either way.
 */

/** Resolves to 'supported' | 'unsupported' | 'insecure' | 'unavailable'. */
export async function detectImmersiveVR(xr = navigator.xr, secure = window.isSecureContext) {
  if (!xr) return secure ? 'unavailable' : 'insecure';
  try {
    return (await xr.isSessionSupported('immersive-vr')) ? 'supported' : 'unsupported';
  } catch {
    return 'unsupported'; // e.g. blocked by permissions policy
  }
}

export class XRSessionController {
  constructor(renderer, { onStart, onEnd } = {}) {
    this.renderer = renderer;
    this.session = null;
    this.onStart = onStart;
    this.onEnd = onEnd;
    // 'local' puts the origin at the head's starting pose: eye height is y = 0,
    // matching the Blender camera at the sphere centre.
    renderer.xr.setReferenceSpaceType('local');
  }

  get active() {
    return this.session !== null;
  }

  async toggle() {
    if (this.session) return this.session.end();
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking'],
    });
    session.addEventListener('end', this._onEnd);
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.onStart?.(session);
  }

  _onEnd = () => {
    this.session = null;
    this.onEnd?.();
  };
}
