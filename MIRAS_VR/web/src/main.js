import * as THREE from 'three';
import './style.css';
import { CONFIG } from './config.js';
import { createPanorama, isVideoUrl, loadPanoramaTexture, loadPanoramaVideo } from './panorama.js';
import { LookControls } from './look-controls.js';
import { detectImmersiveVR, XRSessionController } from './xr.js';
import { GuideOverlay } from './guide-overlay.js';
import { GazeHotspots } from './gaze.js';
import { DevHud } from './dev-hud.js';
import { HotspotMarkers } from './hotspot-markers.js';
import { VrViewMenu } from './vr-view-menu.js';
import HOTSPOTS from './data/hotspots.json';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const loader = $('loader');
const loaderText = $('loader-text');
const errorBox = $('error');
const vrButton = $('btn-vr');
const playButton = $('btn-play');
const soundButton = $('btn-sound');
const xrStatus = $('xr-status');

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Tone mapping is for the lit guide only; the panorama, caption and markers opt out (toneMapped: false).
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.xr.enabled = true;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120c08);

const camera = new THREE.PerspectiveCamera(CONFIG.view.fov, window.innerWidth / window.innerHeight, 0.05, 100);
camera.name = 'MIRAS_VR_Camera';
scene.add(camera);

const panorama = createPanorama(CONFIG.panorama);
scene.add(panorama);

const controls = new LookControls(camera, renderer.domElement, CONFIG.view);

// Soft fill for the guide only: the panorama material is unlit, so lights never change the photo.
scene.add(new THREE.HemisphereLight(0xfff1e0, 0x5a4636, 0.9));

// ---------------------------------------------------------------- contextual guide

// The guide is hidden until the visitor dwells on a hotspot, then appears bottom-right
// with a caption and fades away. Gaze = centre of the view (desktop) or the headset.
const guide = new GuideOverlay(scene, camera, renderer, {
  url: CONFIG.guide.url,
  character: CONFIG.guide.character,
  onFinished: (hotspot, now) => {
    gaze.busy = false;
    gaze.release(hotspot.id, now);
  },
});
const gaze = new GazeHotspots(HOTSPOTS, {
  onActivate: (hotspot, now) => {
    gaze.busy = true;
    guide.show(hotspot, now);
  },
});
const markers = new HotspotMarkers(scene, gaze);
const devHud = new URLSearchParams(location.search).has('dev') ? new DevHud(gaze) : null;

// Desktop: a mouse resting on a dot counts as looking at it (VR uses the headset only).
const pointerNdc = new THREE.Vector2();
const pointerDir = new THREE.Vector3();
let pointerInside = false;
renderer.domElement.addEventListener('pointermove', (e) => {
  pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  pointerInside = e.pointerType === 'mouse';
});
renderer.domElement.addEventListener('pointerleave', () => (pointerInside = false));

// Gaze reticle: a small white dot at the centre of the view. CSS on desktop, a sprite in VR.
const reticle = document.createElement('div');
reticle.className = 'reticle';
document.body.appendChild(reticle);
const vrReticle = new THREE.Sprite(new THREE.SpriteMaterial({
  color: 0xffffff, opacity: 0.8, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false,
}));
vrReticle.scale.set(0.008, 0.008, 1);
vrReticle.renderOrder = 20;
vrReticle.visible = false;
scene.add(vrReticle);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') guide.dismiss();
});
// In VR, a controller trigger picks a location button if the ray is on one (see vrMenu below),
// otherwise it dismisses the caption early.
for (const i of [0, 1]) {
  const c = renderer.xr.getController(i);
  c.addEventListener('select', () => vrMenu.handleSelect(c) || guide.dismiss());
}

// ?view=moti_magri opens a view directly; ?pano=assets/... tries any other source from web/public/.
const params = new URLSearchParams(location.search);
const VIEWS = params.get('pano')
  ? [{ id: 'custom', name: 'Custom view', url: params.get('pano') }]
  : CONFIG.views;
let currentView = VIEWS.find((v) => v.id === params.get('view')) || VIEWS[0];
let video = null;

// ---------------------------------------------------------------- views

// Each view's texture (and video element) is loaded once and kept, so switching back is instant.
const viewCache = new Map();
const FADE_MS = 350;
let fade = 0; // panorama brightness 0..1 (also dims to black in VR, so no jarring cut)
let switching = null;

async function loadViewTexture(view, progress) {
  if (viewCache.has(view.id)) return viewCache.get(view.id);
  const entry = isVideoUrl(view.url)
    ? await loadPanoramaVideo(view.url, progress)
    : { texture: await loadPanoramaTexture(view.url, renderer, progress), video: null };
  viewCache.set(view.id, entry);
  return entry;
}

// Timer-driven (not rAF) so a transition always completes, even in a background tab.
function fadeTo(target) {
  return new Promise((resolve) => {
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const d = (now - last) / FADE_MS;
      last = now;
      fade = target > fade ? Math.min(target, fade + d) : Math.max(target, fade - d);
      panorama.material.color.setScalar(fade);
      if (fade === target) resolve();
      else setTimeout(step, 16);
    };
    step();
  });
}

/** Fade to black, swap the panorama (and its hotspots), fade back in. */
async function showView(view) {
  if (switching) return switching;
  switching = (async () => {
    const wasPlaying = video ? !video.paused : true;
    const wasMuted = video ? video.muted : true;
    guide.dismiss();
    gaze.busy = true; // no hotspot triggers mid-transition
    await fadeTo(0);
    loader.hidden = viewCache.has(view.id);
    errorBox.hidden = true;
    try {
      const entry = await loadViewTexture(view, (p) => {
        loaderText.textContent = `Loading ${view.name}… ${Math.round(p * 100)}%`;
      });
      video?.pause();
      video = entry.video;
      panorama.material.map = entry.texture;
      panorama.material.needsUpdate = true;
      if (video) {
        video.muted = wasMuted;
        video.currentTime = 0;
        if (wasPlaying) video.play().catch(() => {});
        setupVideoControls();
      } else {
        playButton.hidden = soundButton.hidden = true;
      }
      currentView = view;
      gaze.setView(view.id);
      markers.update(0, performance.now());
      updateViewUi();
      const q = new URLSearchParams(location.search);
      q.set('view', view.id); // keep other flags (dev, vrmenu) as they are
      history.replaceState(null, '', `?${q.toString().replace(/=(?=&|$)/g, '')}`);
      document.body.classList.add('ready');
      await fadeTo(1);
    } catch (err) {
      console.error('[MIRAS]', err);
      $('error-detail').textContent = err.message;
      errorBox.hidden = false;
    } finally {
      loader.hidden = true;
      gaze.busy = guide.active;
      switching = null;
    }
  })();
  return switching;
}

$('btn-retry').addEventListener('click', () => showView(currentView));

// View tabs: one button per view, in config order.
const tabs = $('view-tabs');
for (const view of VIEWS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.view = view.id;
  b.setAttribute('role', 'tab');
  b.textContent = view.name;
  b.addEventListener('click', () => view !== currentView && showView(view));
  tabs.appendChild(b);
}
tabs.hidden = VIEWS.length < 2;

// The same switcher inside the headset: look down for a row of location buttons.
// ?vrmenu shows it on desktop too (drag to look down), for testing without a headset.
const vrMenu = new VrViewMenu(scene, renderer, camera, VIEWS, {
  onSelect: (view) => showView(view),
  forceDesktop: params.has('vrmenu'),
});
if (VIEWS.length < 2) vrMenu.forceDesktop = false;

function updateViewUi() {
  vrMenu.setActive(currentView.id);
  for (const b of tabs.children) {
    const on = b.dataset.view === currentView.id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  $('view-name').textContent = `${currentView.name} · Udaipur · 360°`;
  $('credit').textContent = `Prototype preview${currentView.credit ? ` · 360° source video: ${currentView.credit}` : ''}`;
  document.title = `MIRAS — ${currentView.name}, Udaipur 360°`;
}

// ---------------------------------------------------------------- video controls

function setLabel(button, text) {
  button.querySelector('span').textContent = text;
  button.title = text;
}

function syncVideoButtons() {
  setLabel(playButton, video.paused ? 'Play' : 'Pause');
  playButton.classList.toggle('is-paused', video.paused);
  setLabel(soundButton, video.muted ? 'Sound on' : 'Mute');
  soundButton.classList.toggle('is-muted', video.muted);
}

const wiredVideos = new WeakSet();
function setupVideoControls() {
  playButton.hidden = false;
  soundButton.hidden = false;
  if (!wiredVideos.has(video)) {
    wiredVideos.add(video);
    const v = video;
    for (const ev of ['play', 'pause', 'volumechange']) v.addEventListener(ev, () => v === video && syncVideoButtons());
  }
  syncVideoButtons();
}

playButton.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
soundButton.addEventListener('click', () => {
  video.muted = !video.muted;
  if (!video.muted && video.paused) video.play(); // unmuting is a user gesture: playback is allowed
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && video) {
    e.preventDefault();
    playButton.click();
  }
});

// ---------------------------------------------------------------- UI

$('btn-reset').addEventListener('click', () => controls.reset());

const fsButton = $('btn-fullscreen');
if (!document.fullscreenEnabled) fsButton.hidden = true;
fsButton.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch((e) => console.warn('[MIRAS] Fullscreen refused:', e));
});
document.addEventListener('fullscreenchange', () => {
  fsButton.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  setLabel(fsButton, document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
});

// ---------------------------------------------------------------- WebXR

const xr = new XRSessionController(renderer, {
  onStart: () => {
    controls.enabled = false;
    camera.quaternion.identity(); // the headset now owns orientation
    video?.play(); // entering VR is a user gesture; there are no in-headset buttons yet
    setLabel(vrButton, 'Exit VR');
    document.body.classList.add('in-xr');
  },
  onEnd: () => {
    controls.enabled = true;
    panorama.position.set(0, 0, 0);
    controls.apply();
    setLabel(vrButton, 'Enter VR');
    document.body.classList.remove('in-xr');
  },
});

const XR_MESSAGES = {
  supported: 'VR headset available',
  unsupported: 'Desktop mode — no VR headset detected',
  unavailable: 'Desktop mode — this browser has no WebXR',
  insecure: 'Desktop mode — WebXR needs HTTPS',
};

async function setupXR() {
  const status = await detectImmersiveVR();
  vrButton.hidden = status !== 'supported';
  xrStatus.textContent = XR_MESSAGES[status];
  xrStatus.dataset.status = status;
  return status;
}

vrButton.addEventListener('click', () =>
  xr.toggle().catch((e) => {
    console.error('[MIRAS] Could not start VR session:', e);
    xrStatus.textContent = `VR failed to start: ${e.message}`;
  }),
);
navigator.xr?.addEventListener('devicechange', setupXR);

// ---------------------------------------------------------------- loop

const xrCamPos = new THREE.Vector3();
const forward = new THREE.Vector3();
let lastTime = performance.now();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const head = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  if (renderer.xr.isPresenting) {
    // A monoscopic panorama has no parallax: keep the sphere centred on the head
    // so leaning or stepping never reveals the edge or distorts the image.
    head.getWorldPosition(xrCamPos);
    panorama.position.copy(xrCamPos);
  }

  head.getWorldDirection(forward);
  const vr = renderer.xr.isPresenting;
  let pointer = null;
  if (!vr && pointerInside) {
    pointerDir.set(pointerNdc.x, pointerNdc.y, 0.5).unproject(camera).normalize();
    pointer = pointerDir;
  }
  vrReticle.visible = vr;
  if (vr) vrReticle.position.copy(xrCamPos).addScaledVector(forward, 2);
  vrMenu.update(dt, now);
  if (!vrMenu.open) gaze.update(forward, dt, now, pointer); // menu up: no hotspot triggers
  markers.update(dt, now);
  guide.update(dt, now);
  devHud?.update(forward);

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- start

updateViewUi();
showView(currentView);
setupXR();
guide.load(); // once, up front, so it appears instantly when a hotspot fires

// Inspection hooks for automated tests and the browser console.
window.__miras = {
  THREE, renderer, scene, camera, panorama, controls, guide, gaze, markers, devHud, vrMenu, xr, detectImmersiveVR, setupXR,
  get video() { return video; },
  get view() { return currentView; },
};
