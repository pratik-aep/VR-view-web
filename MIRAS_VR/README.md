# MIRAS VR — 360° Heritage Courtyard Prototype

A monoscopic 360° viewer for MIRAS, the Udaipur heritage tourism platform. One equirectangular panorama
is wrapped on the inside of a sphere, with a stationary visitor at its centre, in two places:

- **Blender** (`blender/MIRAS_VR_Prototype.blend`), an editable scene for layout and future character work.
- **Web** (`web/`), a Three.js desktop viewer with WebXR support for Meta Quest Browser.

> The panorama is an **AI-generated, fictional** Rajasthani-style courtyard used for prototyping.
> It is not a record of any real monument.
>
> A monoscopic panorama lets you look around but has no stereoscopic depth or positional parallax.

## Layout

```
MIRAS_VR/
├── assets/
│   ├── panoramas/MIRAS_VR_Test_Panorama.png   original texture (1774×887, 2:1)
│   ├── models/                                 drop heritage_guide.glb here (source copy)
│   └── audio/                                  narration source files
├── blender/
│   ├── MIRAS_VR_Prototype.blend                texture packed inside, relative link kept
│   └── setup_miras_vr.py                       rebuilds the .blend and previews
├── previews/  front.png right.png back.png left.png hero.png
├── tests/
│   ├── test_blender.py                         41 headless checks on the saved .blend
│   ├── test_rerun.py                           rerun creates no duplicates
│   └── web_smoke.js                            in-page viewer test (paste in console)
└── web/
    ├── index.html, src/*.js, src/style.css
    ├── public/assets/…                         files served to the browser
    └── vite.config.js, package.json
```

### Shared orientation

Blender and the web viewer use the same orientation:

| Heading     | Blender | Three.js | Panorama u |
|-------------|---------|----------|------------|
| Front 0°    | +Y      | −Z       | 0.5 (fountain and gate) |
| Right 90°   | +X      | +X       | 0.75 (tree) |
| Back 180°   | −Y      | +Z       | 0 / 1 (seam) |
| Left 270°   | −X      | −X       | 0.25 (tower) |

The eye is at the origin. The floor plane for characters is 1.6 m below it.

## Blender

Rebuild everything, including the scene, previews and saved file:

```bash
cd MIRAS_VR
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python blender/setup_miras_vr.py
```

Options go after a `--`:
- `--image PATH`: use a different panorama
- `--blend PATH`: save somewhere else
- `--previews DIR`: write previews somewhere else
- `--radius 20`: sphere radius
- `--no-previews`: skip the preview renders
- `--no-pack`: don't pack the texture into the .blend

The script exits non-zero with an `[MIRAS] ERROR:` line on bad input (missing file, wrong aspect ratio).

**360° video.** Pass a video file to `--image` (`.mp4`, `.mov`, …). The script then:
- plays the video on the sphere and fits the timeline to its length and frame rate
- adds its soundtrack as an audio strip, synced to the timeline
- links the video rather than packing it (Blender can't pack video)

`--frame N` picks the video frame the previews are rendered from. For example, the Royal Lake build:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python blender/setup_miras_vr.py -- \
  --image assets/videos/Royal_Lake_Udaipur_360.mp4 --blend blender/MIRAS_VR_RoyalLake.blend \
  --previews previews/royal_lake --frame 600
```

That source video is 1920×1080 (16:9), not 2:1. Its edges join up and its poles are complete, so it does cover the full 360°×180° and is mapped that way. It just has less vertical detail than a native 2:1 video.

What the scene contains:
- **Collections:** `MIRAS_ENVIRONMENT`, `MIRAS_CAMERAS`, `MIRAS_GUIDE`, `MIRAS_EFFECTS`, `MIRAS_DEBUG`.
- **`MIRAS_360_Sphere`:**
  - radius 20, 128×64 segments, normals facing inward
  - UVs computed per loop, so the back seam and the poles don't smear
  - doesn't cast shadows, and can't be selected (so you can't move it by accident)
- **`MIRAS_360_Environment` material:** Image Texture (sRGB) → Emission (strength 1) → Material Output.
  - There is no BSDF, so lights can't darken it and it shows no reflections.
  - Backface culling is off.
- **`MIRAS_VR_Camera`:** at (0,0,0), 90° horizontal FOV, clipping 0.05–1000.
  - Translation is locked, rotation is free.
  - There is no animation.
- **`MIRAS_Guide_Anchor`:** an empty 3 m in front of the camera on the floor, facing the viewer, where `heritage_guide.glb` will go.
- **Render:** EEVEE with the *Standard* view transform, so the photo's colours are reproduced as-is (AgX would wash them out). World strength is 0.

To work inside Blender, open the `.blend` and switch to camera view (`Numpad 0`). To rebuild the MIRAS objects in the open file without wiping it, run this in the Text Editor:

```python
import importlib.util, bpy
spec = importlib.util.spec_from_file_location("m", bpy.path.abspath("//setup_miras_vr.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.build(fresh=False, previews=False)
```

## Web viewer (macOS)

The viewer plays the same 360° video as `blender/MIRAS_VR_RoyalLake.blend`, which is `web/public/assets/videos/Royal_Lake_Udaipur_360_loop.mp4`, a copy of `assets/videos/`.

That loop was cut from the original video (kept unchanged as `assets/videos/Royal_Lake_Udaipur_360.mp4`):
- **Removed:** the logos and the "Lake Pichola" title (0–17 s), and the fade to black and credits (72.5 s to the end).
- **Loop:** the last 2 seconds are crossfaded into the first 2, picture and sound, so it repeats without a jump. The result is a 53.5 s loop.

To recut, for example with different in and out points:

```bash
tools/make_seamless_loop.sh assets/videos/Royal_Lake_Udaipur_360.mp4 assets/videos/Royal_Lake_Udaipur_360_loop.mp4 17.0 72.5 2
``` To show a still panorama instead, set `CONFIG.panorama.url` in `src/config.js` to a `.png` or `.jpg`.

The video starts muted, because browsers block autoplay with sound. Use **Play/Pause** (or Space) and **Sound on**. Entering VR also starts playback.

The guide and ambient-effects modules have been moved to `web/future/` and are not loaded, so the README sections on them below don't apply to the current build.

Requires Node 20+. Node 26 was used here.

```bash
cd MIRAS_VR/web
npm install
npm run dev
```

Then open http://localhost:5173.

| Input | Action |
|---|---|
| Drag (mouse or trackpad click-drag) | look around |
| Two-finger trackpad swipe | look around |
| Pinch / ctrl + scroll, `+` / `-` | zoom (FOV 40–100°) |
| Arrow keys | look around in 5° steps |
| **Reset view** | face the fountain, level, default zoom |
| **Fullscreen** | toggle fullscreen |
| **Enter VR** | only appears when the browser reports `immersive-vr` support |

URL options:
- `?pano=assets/panoramas/other.png` loads another panorama from `web/public/`.
- `?dust` turns on the ambient dust layer.

Production build: `npm run build` writes `web/dist/`, a static folder with relative paths. It can be hosted on any HTTPS static host. **It has not been deployed anywhere.**

### Code map

| File | Purpose |
|---|---|
| `src/config.js` | panorama path, view limits, guide and effects settings |
| `src/panorama.js` | inward sphere and texture loading with progress and error handling |
| `src/look-controls.js` | rotation-only controls; the camera is pinned to the origin |
| `src/xr.js` | `immersive-vr` detection and session start/end (`local` reference space) |
| `src/guide.js` | `HeritageGuide`: optional .glb, transform, animation, narration, subtitles |
| `src/effects.js` | `EffectsLayer` registry, plus a sample dust layer |
| `src/main.js` | wiring, UI, and the `renderer.setAnimationLoop` loop (also used in XR) |

In VR the sphere follows the headset's position every frame. Leaning or stepping therefore never reveals the sphere's edge or warps the image, which is the correct behaviour for a monoscopic panorama.

## Adding the heritage guide

1. Put the model at `web/public/assets/models/heritage_guide.glb`, and optionally a source copy in `assets/models/`.
2. Edit `CONFIG.guide` in `web/src/config.js`:
   - `position` (metres; front is −Z, floor is y = −1.6)
   - `rotationY` (degrees)
   - `scale`
   - `animation` (clip name, or `null` for the first clip)
   - `narration` (an audio path under `public/`)
   - `subtitles` (`[{start, end, text}]` in seconds of narration)
3. Start narration from a click: call `guide.playNarration()`. Browsers block audio that wasn't started by a user action.

If the file is missing or broken, the viewer logs one info line and carries on. `showPlaceholder: true` draws a wireframe marker where the guide will stand. In Blender, line the model up with `MIRAS_Guide_Anchor`. Its position, (0, 3, −1.6), is the same point as the web viewer's (0, −1.6, −3).

## Ambient effects

New effects go in `src/effects.js` as `{ object, update(dt, t), dispose() }` and are registered with `effects.add(name, effect)`. Each one is a separate object drawn in front of the panorama. The photo itself is never repainted. Birds, flags and particles should follow this pattern, and their Blender sources go in `MIRAS_EFFECTS`.

## Test results

All of these tests were actually run on this Mac (Blender 5.2.3 LTS; the Claude desktop app's built-in Chromium-based browser).

**Blender (`tests/test_blender.py`): 41/41 passed**
- The saved .blend reopens. All five collections are present, and no default objects remain.
- The sphere is centred at the origin with radius 20.000. All 8192 faces have inward normals, and it has a UV map.
- The material chain is Image → Emission → Output, with no BSDF and backface culling off.
- The image is packed, sRGB, 1774×887, and loads. The external copy is still on disk, and no files are missing.
- The camera is at (0,0,0) with translation locked, 90° FOV, clipping that covers the sphere, and no animation.
- All five previews exist, contain image content, and the four directions differ from each other.
- **Round trip:** the sphere was rendered back out to an equirectangular image with a Cycles panoramic camera and compared with the source:
  - mean error 0.014 (the mirrored image scores 0.163)
  - 0 px horizontal offset
  - no seam at the back

**Other Blender tests**
- Rerunning the build three times leaves identical datablock counts (`tests/test_rerun.py`).
- The build works when run from another folder.
- A missing image gives a clear error and exit code 1.
- The `.blend` opens in the live Blender session through MCP, and the camera view shows the courtyard.

**Web (`tests/web_smoke.js` plus manual checks in the built-in browser)**
- The dev server starts and the panorama loads (1774×887). The loader hides and no JavaScript errors appear.
- Mouse drag rotates the view.
- Eight headings around 360° all show content, and 360° lands back on the exact starting view.
- Up shows sky and down shows floor. Pitch stops at ±85°.
- Trackpad swipe, pinch zoom and arrow keys work.
- Reset view restores front, level and FOV 90.
- The camera and sphere stay at the origin through random rotations.
- Orientation matches Blender: front shows the gate and fountain, right shows the tree.
- A missing panorama shows the error card ("Panorama not found") with a Retry button.
- **XR detection:** five simulated cases return the right status (supported, unsupported, no WebXR, insecure origin, throwing runtime). In this browser, Enter VR stays hidden. With a simulated `navigator.xr` the button appears, and it hides again when the simulation is removed.
- **Guide pipeline:** a throwaway animated GLB exported from Blender loads, plays its clip, accepts position/rotation/scale changes, shows subtitles, and rejects unknown animation names. The test file was deleted afterwards. With no model present, the viewer skips the guide cleanly.
- The production build serves `index.html`, the JS and the panorama. HTTPS dev mode serves over TLS.

**Not verified**
- **Fullscreen:** the click handler runs, but the built-in preview pane ignores fullscreen requests. Check it in Safari or Chrome.
- **Real WebXR sessions:** no headset or WebXR emulator was available. Session entry, the head-locked subtitle position, and keeping the sphere centred on the headset are written to the Three.js WebXR API but haven't run.
- **Quest performance and comfort:** not measured.

## Known limitations

- The panorama is only 1774 px wide. That's about 4.9 px per degree, so it will look soft in a Quest 3 (about 25 px per degree). Use a 6K–8K source for production.
- The source image's left and right edges match closely but not perfectly. The edge difference is 0.040, against a typical column-to-column difference of 0.025. A faint seam may show directly behind the start view.
- The top rows aren't perfectly collapsed to a single point (a common trait of AI panoramas), so the zenith can show a slight swirl.
- The panorama is monoscopic: there is no depth, and objects added later won't have matching parallax with the photo.
- three.js is about 200 kB gzipped and bundled locally. No CDN or backend is used.

## When a Meta Quest is available

1. Run `npm run dev:https` on the Mac. On the Quest (same Wi-Fi), open `https://<mac-LAN-ip>:5173` in Meta Quest Browser and accept the self-signed certificate.
   - Alternative: connect over USB with `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173`.
2. Check:
   - Enter VR appears and opens a session.
   - The initial heading faces the fountain.
   - The horizon is level, and the scale feels right with an eye height of 1.6 m.
   - There's no visible seam behind you.
   - Leaning doesn't reveal the sphere's edge.
   - Exit VR returns to the desktop view.
3. Profile with the Meta Quest Developer Hub / OVR Metrics Tool. Target 72 fps on Quest 2 and 90 fps on Quest 3.
4. Swap in a high-resolution panorama. Above about 4096 px wide, consider KTX2 compression or a cubemap so it fits Quest 2's memory.
5. Add controller or hand input (for example a "play narration" button on the controller) and test subtitle readability in the headset.
6. Deploy `web/dist/` to an HTTPS host, once you choose one.

## Heritage guide (milestone 1: static)

Source: `models /Stylized Trump Tour Guide.stl` (962k triangles; one watertight piece; 1.90 m tall; A-pose; faces −Y).

```bash
cd MIRAS_VR
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python blender/build_heritage_guide.py -- --tris 80000
cp assets/models/heritage_guide.glb web/public/assets/models/
```

`build_heritage_guide.py` does the following:
1. Welds the mesh and decimates it to 80,000 triangles.
2. Paints clothing and skin regions as vertex colours, in one material for one draw call. The regions are kurta, scarf (found by flood fill), trousers, shoes, skin and hair.
3. Darkens creases for depth.
4. Puts the origin at the feet.
5. Saves `blender/heritage_guide.blend` and exports `assets/models/heritage_guide.glb` (2 MB).
6. Re-imports the GLB to verify it.

The region colours are set by rules, so a little red bleeds onto the waistcoat. Retouch it in Vertex Paint in the `.blend` if needed.

**Placement:** `CONFIG.guide` in `web/src/config.js` (`yaw`, `distance`, `floorY`). Straight ahead in the video is open lake, so the guide stands on the stone walkway behind the camera: `yaw: 183`, 2.4 m away, feet 1.4 m below eye level. Lighting is a hemisphere light plus a warm key light from the sun's direction. It affects only the guide, never the panorama.

**Rigging assessment:** the A-pose, separated limbs and closed mesh suit auto-rigging (Mixamo, or Rigify in Blender) for body gestures. There is no separate jaw, eyes or mouth, so real lip-sync isn't feasible without extra modelling. The fallback is a subtle jaw or head movement driven by the audio level, and it must be documented as such.

## Contextual guide and gaze hotspots

This replaces the walkway placement above. The guide is now hidden until the visitor looks at a heritage feature. He then appears small in the bottom-right with a caption for about 8 seconds and fades out. There is no voice or animation yet.

| File | Purpose |
|---|---|
| `web/src/data/hotspots.json` | **hotspot coordinates and caption text** |
| `web/src/gaze.js` | gaze detection: angle to each hotspot, 1.2 s dwell, hysteresis, look-away re-arm, cooldown, fast-turn filter |
| `web/src/guide-overlay.js` | character and caption card in 3D; fade and slide; desktop and VR layouts |
| `web/src/dev-hud.js` | developer mode (`?dev`) |
| `web/src/main.js` | wiring; the single render loop calls gaze → guide → HUD each frame |

**Finding coordinates:** open `http://localhost:5173/?dev`. A crosshair marks the gaze point and a panel shows the live yaw and pitch. Look at a feature and press **C** to copy a ready-made hotspot entry to the clipboard (it's also logged to the console). Orange rings show each hotspot's trigger cone.

**Adding a hotspot:** paste a new object into the `hotspots` array:

```json
{ "id": "palace-window", "title": "Palace Window", "yaw": 112, "pitch": 6,
  "caption": "Placeholder: verified history will appear here.", "placeholder": true }
```

- `yaw` is degrees clockwise from the start view (0 = sun over the lake, 90 = right, 180 = behind). `pitch` is degrees up (+) or down (−).
- Any value in `defaults` can be overridden per hotspot: `triggerAngle` 12°, `exitAngle` 16°, `dwellTime` 1200 ms, `duration` 8000 ms, `cooldown` 5000 ms.
- When two cones overlap, the hotspot closest to the centre of view wins.

**Editing captions:** change `title` and `caption` in the same file. `"placeholder": true` adds an orange "PLACEHOLDER · VERIFIED HISTORY PENDING" tag; remove it once the text is verified. The card wraps text automatically, but keep captions to two or three sentences.

**Rules the gaze system follows:**
- Mouse hover never triggers; only the centre of the view counts.
- Turning faster than 45°/s restarts the dwell, so sweeping past does nothing.
- Once a hotspot fires, it stays disarmed until the visitor looks more than 16° away, and its 5 s cooldown has passed after the caption hides.
- **Esc** dismisses the caption early. In VR, either controller's trigger does the same.

**In VR**, the card and guide float 1.5 m away: the guide about 20° right and 15° down, the card just below the line of sight. They follow the head with a short lag rather than being locked to it, which avoids judder.

**Desktop test checklist** (automated version: paste `tests/gaze_test.js` into the console on `?dev`):
1. The panorama loads and no guide is visible.
2. Look at the ornate tower building (drag about 110° left, slightly up). After about 1.2 s, the guide slides in bottom-right with the caption.
3. A glance shorter than 1.2 s, or a fast sweep across it, does nothing.
4. The caption stays about 8 s, then the guide and caption fade out together.
5. Keep looking: it does not come back. Look away, wait 5 s, look back: it triggers again.
6. Esc closes it early.
7. Drag, Reset view, Play/Pause, Sound and Fullscreen still work.

**Needs a real Quest:**
- WebXR gaze (headset direction feeding the same detector)
- the comfort of the floating guide and card at 1.5 m
- caption legibility in the headset
- controller-trigger dismissal
- the frame rate with the guide shown

### Update: dots, faster triggering, guide off for now

- **White dots** mark every hotspot (`web/src/hotspot-markers.js`). A thin ring fills around a dot while it is being looked at, and dots dim while a caption is showing.
- **Faster triggering:** it fires after 0.7 s, either when the dot is within 8° of the centre of view (a small white centre dot replaces the crosshair) or when the mouse rests within 3° of the dot (desktop only). The large yellow rings are gone.
- **Four hotspots,** all with placeholder text: ornate tower (250°, 12°), buildings across the lake (355°, 6°), arched gateway (154°, 10°), lakeside facade (182°, 18°).
- **The character is switched off** (`CONFIG.guide.character: false` in `web/src/config.js`) while the model is reworked. The card shows the caption alone and the GLB is not downloaded. Setting it to `true` brings back the chest-up, front-facing portrait that rises into the right side of the card.
- `tests/gaze_test.js` covers the new timing and hover behaviour.

## Udaipur views: City Palace, Moti Magri, Karni Mata

Source: `Udaipur Rajasthan Virtual Reality Experience 360° video Elysian Studios.mp4` (67.8 s, 1920×1080, 360°). Each view has its own folder:

```
views/<view>/<view>_360_loop.mp4   clean, seamlessly looping clip
views/<view>/<view>.blend          Blender sphere project (video linked, timeline matched)
views/<view>/previews/             front/right/back/left/hero renders
```

| View | Scene in source | Burned-in text | Clip used |
|---|---|---|---|
| City Palace | 24.9–43.0 s | "CITY PALACE" title, 25.4–35.4 s | 36.2–42.6 s → 5.4 s loop |
| Moti Magri | 43.0–59.0 s | title and description, 43.5–51.5 s | 52.2–58.7 s → 5.5 s loop |
| Karni Mata | 59.0–66 s | ELYSIAN logo from 63.5 s | 59.6–65.0 s, logo covered with a clean sky patch → 4.4 s loop |

The City Palace and Moti Magri titles sit over the monuments, so only the text-free part after each title is used; blurring them out would leave a visible smudge. On Karni Mata, the logo was covered with the same patch of night sky taken from a frame before it appeared (it's a tripod shot). Each loop has a 1 s crossfade.

Re-cutting, e.g. City Palace:

```bash
tools/make_seamless_loop.sh "../Udaipur   Rajasthan   Virtual Reality Experience   360° video   Elysian Studios.mp4" views/city_palace/city_palace_360_loop.mp4 36.2 42.6 1
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/setup_miras_vr.py -- --image views/city_palace/city_palace_360_loop.mp4 --blend views/city_palace/city_palace.blend --previews views/city_palace/previews --frame 60
```

**In the web viewer**, tabs at the top switch between City Palace, Moti Magri, Karni Mata and Royal Lake.
- Switching fades to black and back (0.35 s each way), which also keeps VR comfortable.
- Each view loads once and is cached, so returning to it is instant.
- Only the current view plays.
- `?view=moti_magri` opens a view directly.
- Views are listed in `CONFIG.views` (`web/src/config.js`). Hotspots carry a `"view"` id in `hotspots.json`; the existing four belong to `royal_lake`, and the three new views have none yet.
- The tabs are HTML, so they're desktop-only for now. Switching inside a headset needs in-VR buttons (not built yet).

### Switching views inside VR

`web/src/vr-view-menu.js`: in a headset, **look down** (more than about 22° below the horizon) and a row of location buttons appears 1.3 m away, about 34° down, wherever you were facing. It stays put rather than following your head. The current location is highlighted in orange.

- **With controllers:** each controller shows a thin ray while the menu is open. Point at a button and pull the trigger.
- **Without controllers:** look at a button for 1 second. A white bar fills along it, then the view switches. A shorter glance does nothing.
- Look back up to put the menu away. Hotspot triggering pauses while the menu is open.
- Switching uses the same fade to black as the desktop tabs.
- **Testing on desktop:** open `http://localhost:5173/?vrmenu` and drag the view downwards.

Desktop checks done: the menu opens on looking down and closes on looking up; a 1 s gaze switches the view (Karni Mata) and a 0.4 s glance doesn't; a controller ray hits a button and the trigger switches (Royal Lake); the active highlight follows; the menu never appears on the normal desktop page.

**Not yet tested on a Quest:** real controller rays and trigger events, button size and comfort, and the gaze dwell with real head motion.

### Hotspots for every view (researched)

`web/src/data/hotspots.json` now has 34 hotspots: City Palace 10, Moti Magri 8, Pichola Lake 8, Karni Mata 8. Each one sits on a feature visible in its clip. I checked placement by pointing the view at each dot.

- Every caption comes from cited sources (Wikipedia, Incredible India, Lonely Planet and travel guides). The URLs are in each entry's `sources` field, which isn't shown on screen.
- Where something can't be seen from the camera (Mor Chowk, Amar Vilas, the Sheesh Mahal inside City Palace), the caption says "Inside:".
- Where sources disagree, the captions stay general: City Palace's start date (1553 or 1559), and the Moti Magri statue's date and patron.
- Left out because they couldn't be verified: Maharana Pratap's exact reign years, and the century Karni Mata lived in.
- **Pichola Lake:** the camera is at Gangaur Ghat beside Bagore ki Haveli. I identified this by comparing the scene with descriptions, and the team confirmed it.
- **Karni Mata** is a night shot, so its captions describe the view in general terms rather than naming specific buildings.

**Royal Lake renamed to Pichola Lake:** view id `pichola_lake`, Blender project `views/pichola_lake/pichola_lake.blend`, web video `pichola_lake_360_loop.mp4`. The original `blender/MIRAS_VR_RoyalLake.blend` is untouched.
