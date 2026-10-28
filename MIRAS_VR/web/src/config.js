// Central configuration for the MIRAS 360° viewer.
// Paths are relative to the served site root (web/public/ in development).

export const CONFIG = {
  // The 360° locations, shown as tabs in this order; the first opens by default (or ?view=<id>).
  // Each matches a Blender project in MIRAS_VR/views/<id>/<id>.blend.
  // A still image (.png/.jpg) works as well as a video.
  views: [
    { id: 'city_palace', name: 'City Palace', url: 'assets/videos/city_palace_360_loop.mp4', credit: 'Elysian Studios' },
    { id: 'moti_magri', name: 'Moti Magri', url: 'assets/videos/moti_magri_360_loop.mp4', credit: 'Elysian Studios' },
    { id: 'karni_mata', name: 'Karni Mata', url: 'assets/videos/karni_mata_360_loop.mp4', credit: 'Elysian Studios' },
    { id: 'pichola_lake', name: 'Pichola Lake', url: 'assets/videos/pichola_lake_360_loop.mp4', credit: 'GoPro VR Travel' },
  ],

  panorama: {
    radius: 20, // matches the Blender sphere
    widthSegments: 128,
    heightSegments: 64,
  },

  view: {
    fov: 90, // vertical degrees on desktop; the headset supplies its own in VR
    minFov: 40,
    maxFov: 100,
    pitchLimit: 85, // degrees up/down, keeps the view from flipping over the poles
    dragSensitivity: 0.12, // degrees per pixel
  },

  // Contextual guide (blender/build_heritage_guide.py -> heritage_guide.glb). Hidden until a
  // hotspot in src/data/hotspots.json is looked at; a missing file just leaves the caption.
  guide: {
    url: 'assets/models/heritage_guide.glb',
    // Off while the character model is reworked: the card shows the caption alone and the
    // GLB is not downloaded. Set to true to bring back the chest-up portrait beside the caption.
    character: false,
  },
};
